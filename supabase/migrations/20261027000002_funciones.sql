-- =====================================================================
-- Inventario de Eventos v2 · 2/3 · Funciones del servidor
--
-- Todas las operaciones que modifican datos siguen el patrón:
--   fn(p_idem uuid, p_args jsonb) returns jsonb
--   1. Verifica permisos (si no, registra el intento rechazado)
--   2. Idempotencia: si p_idem ya se procesó, devuelve el mismo resultado
--   3. Valida todo ANTES de escribir
--   4. Escribe movimiento + existencias + bitácora en una sola transacción
-- Respuesta: {"ok": true, ...} | {"ok": false, "error": "...", "codigo": "..."}
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public._tiene(p_roles text[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.perfiles
                 where id = auth.uid() and activo and roles && (p_roles || array['admin']::text[]))
$$;
create or replace function public._es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public._tiene(array['admin']::text[])
$$;
create or replace function public._es_activo() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and activo and cardinality(roles) > 0)
$$;
create or replace function public._txt(p_args jsonb, p_key text) returns text
language sql immutable as $$ select nullif(trim(p_args->>p_key), '') $$;

create or replace function public._lugar(p_tipo text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.lugares where tipo = p_tipo and tipo <> 'evento'
$$;

create or replace function public._auditar(
  p_accion text, p_exito boolean default true, p_entidad text default null, p_entidad_id uuid default null,
  p_lugar uuid default null, p_articulo uuid default null, p_antes jsonb default null, p_despues jsonb default null,
  p_motivo text default null, p_detalle text default null, p_args jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.auditoria (usuario_id, usuario_nombre, accion, exito, entidad, entidad_id, lugar_id, articulo_id,
                                antes, despues, motivo, detalle, dispositivo)
  values (auth.uid(), (select nombre from public.perfiles where id = auth.uid()), p_accion, p_exito, p_entidad, p_entidad_id,
          p_lugar, p_articulo, p_antes, p_despues, nullif(trim(p_motivo), ''), p_detalle, left(p_args->>'dispositivo', 200));
end $$;

create or replace function public._negado(p_accion text, p_args jsonb, p_msg text default 'No tienes permiso para esta operación')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._auditar(p_accion => p_accion, p_exito => false, p_detalle => 'Permiso denegado: ' || p_msg, p_args => p_args);
  return jsonb_build_object('ok', false, 'error', p_msg, 'codigo', 'sin_permiso');
end $$;

create or replace function public._idem_inicio(p_idem uuid, p_funcion text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.operaciones;
begin
  if p_idem is null then raise exception 'Falta la clave de operación'; end if;
  insert into public.operaciones (id, funcion, usuario_id) values (p_idem, p_funcion, auth.uid())
  on conflict (id) do nothing;
  if found then return null; end if;
  select * into r from public.operaciones where id = p_idem;
  if r.usuario_id <> auth.uid() or r.funcion <> p_funcion then
    return jsonb_build_object('ok', false, 'codigo', 'idem_conflicto', 'error', 'Clave de operación ya usada');
  end if;
  return coalesce(r.resultado, '{}'::jsonb) || jsonb_build_object('repetida', true);
end $$;

create or replace function public._idem_fin(p_idem uuid, p_res jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.operaciones set resultado = p_res where id = p_idem;
  return p_res;
end $$;

create or replace function public._fallar(p_idem uuid, p_accion text, p_args jsonb, p_msg text, p_codigo text,
  p_extra jsonb default null, p_lugar uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.operaciones where id = p_idem;
  perform public._auditar(p_accion => p_accion, p_exito => false, p_lugar => p_lugar, p_detalle => p_msg,
                          p_despues => p_extra, p_args => p_args);
  return jsonb_build_object('ok', false, 'error', p_msg, 'codigo', p_codigo) || coalesce(p_extra, '{}'::jsonb);
end $$;

-- Cantidad registrada de un artículo en un lugar
create or replace function public._disponible(p_lugar uuid, p_articulo uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select cantidad from public.existencias where lugar_id = p_lugar and articulo_id = p_articulo), 0)
$$;

-- Cambia la existencia de un artículo en un lugar y deja asiento
create or replace function public._mover(p_mov uuid, p_lugar uuid, p_articulo uuid, p_delta integer, p_sin_escanear boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_delta = 0 then return; end if;
  insert into public.existencias (lugar_id, articulo_id) values (p_lugar, p_articulo) on conflict do nothing;
  if p_delta > 0 then
    update public.existencias
       set cantidad = cantidad + p_delta,
           sin_escanear = sin_escanear + case when p_sin_escanear then p_delta else 0 end,
           updated_at = now()
     where lugar_id = p_lugar and articulo_id = p_articulo;
  else
    if public._disponible(p_lugar, p_articulo) + p_delta < 0 then
      raise exception 'Existencia insuficiente' using errcode = 'check_violation';
    end if;
    update public.existencias
       set cantidad = cantidad + p_delta,
           sin_escanear = least(sin_escanear, cantidad + p_delta),
           updated_at = now()
     where lugar_id = p_lugar and articulo_id = p_articulo;
  end if;
  insert into public.asientos (movimiento_id, lugar_id, articulo_id, delta) values (p_mov, p_lugar, p_articulo, p_delta);
end $$;

-- Aplica a las existencias un movimiento con sus renglones
create or replace function public._aplicar(p_mov uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m public.movimientos;
  it public.movimiento_items;
  v_rep uuid := public._lugar('reparacion');
  v_sin boolean;
begin
  select * into m from public.movimientos where id = p_mov;
  v_sin := coalesce(m.escaneo_entrada = 'sin_escaneo', false);
  for it in select * from public.movimiento_items where movimiento_id = p_mov order by articulo_id loop
    if m.origen_id is not null then
      perform public._mover(m.id, m.origen_id, it.articulo_id, -(it.cantidad - it.sobrante), false);
    end if;
    if m.destino_id is not null and it.cantidad - it.danadas > 0 then
      perform public._mover(m.id, m.destino_id, it.articulo_id, it.cantidad - it.danadas, v_sin);
    end if;
    if it.danadas > 0 then
      perform public._mover(m.id, v_rep, it.articulo_id, it.danadas, v_sin);
    end if;
  end loop;
end $$;

-- Bloquea los artículos en orden fijo (evita que dos celulares tomen las mismas piezas)
create or replace function public._bloquear_articulos(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.articulos where id = any(p_ids) order by id for update;
end $$;

create or replace function public._perfil_activo(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.perfiles where id = p_id and activo)
$$;

-- =====================================================================
-- USUARIOS
-- =====================================================================
create or replace function public.registrar_acceso(p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_activo boolean;
begin
  select activo into v_activo from public.perfiles where id = auth.uid();
  perform public._auditar(p_accion => 'inicio_sesion', p_exito => coalesce(v_activo, false),
    p_detalle => case when coalesce(v_activo, false) then null else 'Usuario pendiente de aprobación o desactivado' end,
    p_args => p_args);
  return jsonb_build_object('ok', true, 'activo', coalesce(v_activo, false));
end $$;

create or replace function public.actualizar_usuario(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_id uuid := (p_args->>'usuario_id')::uuid;
  v_antes public.perfiles;
  v_roles text[];
  v_activo boolean;
begin
  if not public._es_admin() then return public._negado('actualizar_usuario', p_args); end if;
  v_res := public._idem_inicio(p_idem, 'actualizar_usuario');
  if v_res is not null then return v_res; end if;

  select * into v_antes from public.perfiles where id = v_id for update;
  if not found then return public._fallar(p_idem, 'actualizar_usuario', p_args, 'Usuario no encontrado', 'no_encontrado'); end if;
  v_roles := case when jsonb_typeof(p_args->'roles') = 'array'
                  then array(select distinct jsonb_array_elements_text(p_args->'roles')) else v_antes.roles end;
  v_activo := coalesce((p_args->>'activo')::boolean, v_antes.activo);
  if not (v_roles <@ array['admin','salidas','recogidas','lectura']::text[]) then
    return public._fallar(p_idem, 'actualizar_usuario', p_args, 'Rol no válido', 'rol_invalido');
  end if;
  if v_activo and cardinality(v_roles) = 0 then
    return public._fallar(p_idem, 'actualizar_usuario', p_args, 'Asigna al menos un rol para activar al usuario', 'sin_rol');
  end if;
  if 'admin' = any(v_antes.roles) and v_antes.activo and (not ('admin' = any(v_roles)) or not v_activo)
     and (select count(*) from public.perfiles where activo and 'admin' = any(roles)) <= 1 then
    return public._fallar(p_idem, 'actualizar_usuario', p_args, 'Debe quedar al menos un administrador activo', 'ultimo_admin');
  end if;

  update public.perfiles set roles = v_roles, activo = v_activo,
         nombre = coalesce(public._txt(p_args, 'nombre'), nombre), updated_at = now()
   where id = v_id;
  perform public._auditar(p_accion => 'actualizar_usuario', p_entidad => 'perfil', p_entidad_id => v_id,
    p_antes => jsonb_build_object('nombre', v_antes.nombre, 'roles', v_antes.roles, 'activo', v_antes.activo),
    p_despues => jsonb_build_object('nombre', coalesce(public._txt(p_args, 'nombre'), v_antes.nombre), 'roles', v_roles, 'activo', v_activo),
    p_detalle => v_antes.usuario, p_args => p_args);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true));
end $$;

-- =====================================================================
-- ARTÍCULOS
-- =====================================================================
create or replace function public.guardar_articulo(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_id uuid := nullif(p_args->>'id', '')::uuid;
  v_antes public.articulos;
  v_desp public.articulos;
  v_inicial integer := coalesce(nullif(p_args->>'cantidad_inicial', '')::integer, 0);
  v_esc text := coalesce(public._txt(p_args, 'escaneo_inicial'), 'sin_escaneo');
  v_mov uuid;
  v_codigo text := upper(public._txt(p_args, 'codigo'));
begin
  if not public._es_admin() then return public._negado('guardar_articulo', p_args); end if;
  v_res := public._idem_inicio(p_idem, 'guardar_articulo');
  if v_res is not null then return v_res; end if;

  if public._txt(p_args, 'nombre') is null or v_codigo is null then
    return public._fallar(p_idem, 'guardar_articulo', p_args, 'Código y nombre son obligatorios', 'dato_invalido');
  end if;
  if exists (select 1 from public.articulos where codigo = v_codigo and id is distinct from v_id) then
    return public._fallar(p_idem, 'guardar_articulo', p_args, 'Ya existe un artículo con ese código', 'codigo_duplicado');
  end if;
  if public._txt(p_args, 'color_hex') is not null and public._txt(p_args, 'color_hex') !~ '^#[0-9A-Fa-f]{6}$' then
    return public._fallar(p_idem, 'guardar_articulo', p_args, 'Color no válido (ej. #8B4513)', 'dato_invalido');
  end if;
  if v_inicial < 0 or v_esc not in ('escaneado', 'sin_escaneo') then
    return public._fallar(p_idem, 'guardar_articulo', p_args, 'Cantidad inicial no válida', 'dato_invalido');
  end if;

  if v_id is null then
    insert into public.articulos (codigo, nombre, categoria, unidad, color_nombre, color_hex, medida, unidad_medida,
                                  tamano, marca_modelo, notas, created_by)
    values (v_codigo, public._txt(p_args, 'nombre'), public._txt(p_args, 'categoria'),
            coalesce(public._txt(p_args, 'unidad'), 'pieza'), public._txt(p_args, 'color_nombre'),
            upper(public._txt(p_args, 'color_hex')), nullif(p_args->>'medida', '')::numeric,
            public._txt(p_args, 'unidad_medida'), public._txt(p_args, 'tamano'), public._txt(p_args, 'marca_modelo'),
            public._txt(p_args, 'notas'), auth.uid())
    returning * into v_desp;
    if v_inicial > 0 then
      insert into public.movimientos (operacion_id, tipo, destino_id, escaneo_entrada, escaneo_entrada_por, motivo,
                                      registrado_por, dispositivo)
      values (p_idem, 'alta', public._lugar('almacen'), v_esc, case when v_esc = 'escaneado' then auth.uid() end,
              'Existencia inicial', auth.uid(), p_args->>'dispositivo')
      returning id into v_mov;
      insert into public.movimiento_items (movimiento_id, articulo_id, cantidad) values (v_mov, v_desp.id, v_inicial);
      perform public._aplicar(v_mov);
    end if;
    perform public._auditar(p_accion => 'alta_articulo', p_entidad => 'articulo', p_entidad_id => v_desp.id,
      p_articulo => v_desp.id, p_despues => to_jsonb(v_desp) || jsonb_build_object('cantidad_inicial', v_inicial), p_args => p_args);
  else
    select * into v_antes from public.articulos where id = v_id for update;
    if not found then return public._fallar(p_idem, 'guardar_articulo', p_args, 'Artículo no encontrado', 'no_encontrado'); end if;
    update public.articulos set
      codigo = v_codigo, nombre = public._txt(p_args, 'nombre'), categoria = public._txt(p_args, 'categoria'),
      unidad = coalesce(public._txt(p_args, 'unidad'), unidad), color_nombre = public._txt(p_args, 'color_nombre'),
      color_hex = upper(public._txt(p_args, 'color_hex')), medida = nullif(p_args->>'medida', '')::numeric,
      unidad_medida = public._txt(p_args, 'unidad_medida'), tamano = public._txt(p_args, 'tamano'),
      marca_modelo = public._txt(p_args, 'marca_modelo'), notas = public._txt(p_args, 'notas'),
      activo = coalesce((p_args->>'activo')::boolean, activo), updated_at = now()
    where id = v_id returning * into v_desp;
    perform public._auditar(p_accion => case when v_antes.activo and not v_desp.activo then 'desactivar_articulo' else 'editar_articulo' end,
      p_entidad => 'articulo', p_entidad_id => v_id, p_articulo => v_id,
      p_antes => to_jsonb(v_antes) - 'updated_at', p_despues => to_jsonb(v_desp) - 'updated_at', p_args => p_args);
  end if;
  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'id', v_desp.id));
end $$;

-- Entrada de material nuevo al Almacén (alta) o ajuste de existencia en un lugar
create or replace function public.ajustar_existencia(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_lugar public.lugares;
  v_art uuid := (p_args->>'articulo_id')::uuid;
  v_cant integer := (p_args->>'cantidad')::integer;
  v_tipo text := coalesce(p_args->>'tipo', 'ajuste');
  v_motivo text := public._txt(p_args, 'motivo');
  v_esc text := coalesce(public._txt(p_args, 'escaneo'), 'sin_escaneo');
  v_mov uuid;
  v_antes integer;
begin
  if not public._es_admin() then return public._negado('ajustar_existencia', p_args); end if;
  v_res := public._idem_inicio(p_idem, 'ajustar_existencia');
  if v_res is not null then return v_res; end if;

  select * into v_lugar from public.lugares where id = coalesce(nullif(p_args->>'lugar_id', '')::uuid, public._lugar('almacen'));
  if v_lugar.id is null or v_lugar.tipo not in ('almacen', 'reparacion', 'evento') or v_lugar.estado <> 'abierto' then
    return public._fallar(p_idem, 'ajustar_existencia', p_args, 'Lugar no válido o cerrado', 'dato_invalido');
  end if;
  if v_tipo not in ('alta', 'ajuste') or v_cant is null or v_cant = 0 or (v_tipo = 'alta' and (v_cant < 0 or v_lugar.tipo <> 'almacen')) then
    return public._fallar(p_idem, 'ajustar_existencia', p_args, 'Cantidad o tipo no válido', 'dato_invalido');
  end if;
  if v_motivo is null then return public._fallar(p_idem, 'ajustar_existencia', p_args, 'El motivo es obligatorio', 'falta_motivo'); end if;
  if not exists (select 1 from public.articulos where id = v_art) then
    return public._fallar(p_idem, 'ajustar_existencia', p_args, 'Artículo no encontrado', 'no_encontrado');
  end if;

  perform public._bloquear_articulos(array[v_art]);
  v_antes := public._disponible(v_lugar.id, v_art);
  if v_antes + v_cant < 0 then
    return public._fallar(p_idem, 'ajustar_existencia', p_args,
      format('Solo hay %s en %s', v_antes, v_lugar.nombre), 'existencia_insuficiente', p_lugar => v_lugar.id);
  end if;

  insert into public.movimientos (operacion_id, tipo, origen_id, destino_id, escaneo_entrada, escaneo_entrada_por,
                                  motivo, registrado_por, dispositivo)
  values (p_idem, v_tipo, case when v_cant < 0 then v_lugar.id end, case when v_cant > 0 then v_lugar.id end,
          case when v_cant > 0 and v_tipo = 'alta' then v_esc end,
          case when v_cant > 0 and v_tipo = 'alta' and v_esc = 'escaneado' then auth.uid() end,
          v_motivo, auth.uid(), p_args->>'dispositivo')
  returning id into v_mov;
  insert into public.movimiento_items (movimiento_id, articulo_id, cantidad) values (v_mov, v_art, abs(v_cant));
  perform public._aplicar(v_mov);

  perform public._auditar(p_accion => case v_tipo when 'alta' then 'alta_existencia' else 'ajuste_existencia' end,
    p_entidad => 'movimiento', p_entidad_id => v_mov, p_lugar => v_lugar.id, p_articulo => v_art,
    p_antes => jsonb_build_object('cantidad', v_antes), p_despues => jsonb_build_object('cantidad', v_antes + v_cant),
    p_motivo => v_motivo, p_args => p_args);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'id', v_mov, 'cantidad', v_antes + v_cant));
end $$;

-- =====================================================================
-- EVENTOS (cada evento es un lugar)
-- =====================================================================
create or replace function public.guardar_evento(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_id uuid := nullif(p_args->>'id', '')::uuid;
  v_antes public.lugares;
  v_desp public.lugares;
begin
  if not public._es_admin() then return public._negado('guardar_evento', p_args); end if;
  v_res := public._idem_inicio(p_idem, 'guardar_evento');
  if v_res is not null then return v_res; end if;
  if public._txt(p_args, 'nombre') is null or public._txt(p_args, 'fecha') is null then
    return public._fallar(p_idem, 'guardar_evento', p_args, 'Nombre y fecha son obligatorios', 'dato_invalido');
  end if;
  if public._txt(p_args, 'fecha_fin') is not null and (p_args->>'fecha_fin')::date < (p_args->>'fecha')::date then
    return public._fallar(p_idem, 'guardar_evento', p_args, 'La fecha de fin es anterior al inicio', 'dato_invalido');
  end if;

  if v_id is null then
    insert into public.lugares (tipo, nombre, fecha, fecha_fin, ubicacion, notas, created_by)
    values ('evento', public._txt(p_args, 'nombre'), (p_args->>'fecha')::date, nullif(p_args->>'fecha_fin', '')::date,
            public._txt(p_args, 'ubicacion'), public._txt(p_args, 'notas'), auth.uid())
    returning * into v_desp;
    perform public._auditar(p_accion => 'crear_evento', p_entidad => 'lugar', p_entidad_id => v_desp.id, p_lugar => v_desp.id,
                            p_despues => to_jsonb(v_desp), p_args => p_args);
  else
    select * into v_antes from public.lugares where id = v_id and tipo = 'evento' for update;
    if not found then return public._fallar(p_idem, 'guardar_evento', p_args, 'Evento no encontrado', 'no_encontrado'); end if;
    if v_antes.estado = 'cerrado' then return public._fallar(p_idem, 'guardar_evento', p_args, 'El evento está cerrado', 'evento_cerrado'); end if;
    update public.lugares set nombre = public._txt(p_args, 'nombre'), fecha = (p_args->>'fecha')::date,
           fecha_fin = nullif(p_args->>'fecha_fin', '')::date, ubicacion = public._txt(p_args, 'ubicacion'),
           notas = public._txt(p_args, 'notas'), updated_at = now()
     where id = v_id returning * into v_desp;
    perform public._auditar(p_accion => 'editar_evento', p_entidad => 'lugar', p_entidad_id => v_id, p_lugar => v_id,
      p_antes => to_jsonb(v_antes) - 'updated_at', p_despues => to_jsonb(v_desp) - 'updated_at', p_args => p_args);
  end if;
  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'id', v_desp.id));
end $$;

-- Cierra un evento: lo que siga registrado ahí se confirma como pérdida de ese evento.
create or replace function public.cerrar_evento(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_ev public.lugares;
  v_mov uuid;
  v_perdidas jsonb;
  v_pend integer;
begin
  if not public._es_admin() then return public._negado('cerrar_evento', p_args); end if;
  v_res := public._idem_inicio(p_idem, 'cerrar_evento');
  if v_res is not null then return v_res; end if;

  select * into v_ev from public.lugares where id = (p_args->>'evento_id')::uuid and tipo = 'evento' for update;
  if not found or v_ev.estado <> 'abierto' then
    return public._fallar(p_idem, 'cerrar_evento', p_args, 'El evento no existe o ya está cerrado', 'estado_invalido');
  end if;
  select count(*) into v_pend from public.movimientos
   where estado = 'por_autorizar' and (origen_id = v_ev.id or destino_id = v_ev.id);
  if v_pend > 0 then
    return public._fallar(p_idem, 'cerrar_evento', p_args,
      format('Hay %s traslado(s) por autorizar de este evento. Autorízalos o recházalos antes de cerrar.', v_pend),
      'traslados_pendientes', p_lugar => v_ev.id);
  end if;

  perform public._bloquear_articulos(array(select articulo_id from public.existencias where lugar_id = v_ev.id and cantidad > 0));
  select coalesce(jsonb_agg(jsonb_build_object('articulo_id', e.articulo_id, 'codigo', a.codigo, 'nombre', a.nombre,
                                               'cantidad', e.cantidad) order by a.nombre), '[]'::jsonb)
    into v_perdidas
    from public.existencias e join public.articulos a on a.id = e.articulo_id
   where e.lugar_id = v_ev.id and e.cantidad > 0;

  if jsonb_array_length(v_perdidas) > 0 then
    insert into public.movimientos (operacion_id, tipo, origen_id, destino_id, motivo, notas, registrado_por, dispositivo)
    values (p_idem, 'perdida', v_ev.id, public._lugar('perdida'), 'Cierre de evento', public._txt(p_args, 'notas'),
            auth.uid(), p_args->>'dispositivo')
    returning id into v_mov;
    insert into public.movimiento_items (movimiento_id, articulo_id, cantidad)
    select v_mov, articulo_id, cantidad from public.existencias where lugar_id = v_ev.id and cantidad > 0;
    perform public._aplicar(v_mov);
  end if;

  update public.lugares set estado = 'cerrado', cerrado_por = auth.uid(), cerrado_at = now(), updated_at = now()
   where id = v_ev.id;
  perform public._auditar(p_accion => 'cerrar_evento', p_entidad => 'lugar', p_entidad_id => v_ev.id, p_lugar => v_ev.id,
    p_despues => jsonb_build_object('perdidas', v_perdidas), p_motivo => public._txt(p_args, 'notas'), p_args => p_args);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'perdidas', v_perdidas));
end $$;

create or replace function public.reabrir_evento(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_ev public.lugares;
begin
  if not public._es_admin() then return public._negado('reabrir_evento', p_args); end if;
  v_res := public._idem_inicio(p_idem, 'reabrir_evento');
  if v_res is not null then return v_res; end if;
  select * into v_ev from public.lugares where id = (p_args->>'evento_id')::uuid and tipo = 'evento' for update;
  if not found or v_ev.estado <> 'cerrado' then
    return public._fallar(p_idem, 'reabrir_evento', p_args, 'El evento no está cerrado', 'estado_invalido');
  end if;
  if public._txt(p_args, 'motivo') is null then
    return public._fallar(p_idem, 'reabrir_evento', p_args, 'El motivo es obligatorio', 'falta_motivo');
  end if;
  update public.lugares set estado = 'abierto', cerrado_por = null, cerrado_at = null, updated_at = now() where id = v_ev.id;
  perform public._auditar(p_accion => 'reabrir_evento', p_entidad => 'lugar', p_entidad_id => v_ev.id, p_lugar => v_ev.id,
                          p_motivo => public._txt(p_args, 'motivo'), p_args => p_args);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true));
end $$;

-- =====================================================================
-- MOVIMIENTOS
-- args: {origen_id, destino_id, items:[{articulo_id, cantidad, danadas}],
--        escaneo_salida: 'escaneado'|'sin_escaneo', escaneo_salida_por: uuid,
--        escaneo_entrada: 'escaneado'|'sin_escaneo', escaneo_entrada_por: uuid, notas}
-- Rutas permitidas:
--   salidas:   Almacén → Evento
--   recogidas: Evento → Almacén | Evento → Reparación | Almacén → Reparación | Reparación → Almacén
--   salidas/recogidas: Evento → Evento  (queda POR AUTORIZAR hasta que el administrador lo apruebe)
--   admin:     cualquier ruta (incluye → Dados de baja y recuperar desde Pérdidas)
-- =====================================================================
create or replace function public.registrar_movimiento(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  o public.lugares;
  d public.lugares;
  v_ruta text;
  v_admin boolean := public._es_admin();
  v_permitido boolean;
  v_pendiente boolean;
  v_lote jsonb;
  v_problemas jsonb := '[]'::jsonb;
  v_sobrantes jsonb := '[]'::jsonb;
  v_mov uuid;
  r record;
  v_disp integer;
  v_es text := public._txt(p_args, 'escaneo_salida');
  v_ee text := public._txt(p_args, 'escaneo_entrada');
  v_esp uuid := nullif(p_args->>'escaneo_salida_por', '')::uuid;
  v_eep uuid := nullif(p_args->>'escaneo_entrada_por', '')::uuid;
  v_total integer;
begin
  select * into o from public.lugares where id = nullif(p_args->>'origen_id', '')::uuid;
  select * into d from public.lugares where id = nullif(p_args->>'destino_id', '')::uuid;
  if o.id is null or d.id is null or o.id = d.id then
    return public._negado('registrar_movimiento', p_args, 'Elige un origen y un destino distintos');
  end if;
  v_ruta := o.tipo || '>' || d.tipo;
  v_permitido := case
    when d.tipo = 'perdida' then false                       -- solo al cerrar un evento
    when v_admin then o.tipo <> 'baja'
    when v_ruta = 'almacen>evento' then public._tiene(array['salidas'])
    when v_ruta in ('evento>almacen', 'evento>reparacion', 'almacen>reparacion', 'reparacion>almacen') then public._tiene(array['recogidas'])
    when v_ruta = 'evento>evento' then public._tiene(array['salidas', 'recogidas'])
    else false end;
  if not v_permitido then
    return public._negado('registrar_movimiento', p_args,
      format('Tu rol no permite mover material de %s a %s', o.nombre, d.nombre));
  end if;
  v_pendiente := v_ruta = 'evento>evento' and not v_admin;

  v_res := public._idem_inicio(p_idem, 'registrar_movimiento');
  if v_res is not null then return v_res; end if;

  if (o.tipo = 'evento' and o.estado <> 'abierto') or (d.tipo = 'evento' and d.estado <> 'abierto') then
    return public._fallar(p_idem, 'registrar_movimiento', p_args, 'Uno de los eventos está cerrado', 'evento_cerrado');
  end if;

  -- Escaneo
  if o.tipo in ('almacen', 'evento', 'reparacion') then
    if v_es is null or v_es not in ('escaneado', 'sin_escaneo') then
      return public._fallar(p_idem, 'registrar_movimiento', p_args, 'Indica si la salida se escaneó o no', 'falta_escaneo');
    end if;
  else v_es := null; end if;
  if d.tipo in ('almacen', 'evento', 'reparacion') then
    if v_ee is null or v_ee not in ('escaneado', 'sin_escaneo') then
      return public._fallar(p_idem, 'registrar_movimiento', p_args, 'Indica si la entrada se escaneó o no', 'falta_escaneo');
    end if;
  else v_ee := null; end if;
  v_esp := case when v_es = 'escaneado' then coalesce(v_esp, auth.uid()) end;
  v_eep := case when v_ee = 'escaneado' then coalesce(v_eep, auth.uid()) end;
  if (v_esp is not null and not public._perfil_activo(v_esp)) or (v_eep is not null and not public._perfil_activo(v_eep)) then
    return public._fallar(p_idem, 'registrar_movimiento', p_args, 'La persona que escaneó no es un usuario activo', 'dato_invalido');
  end if;

  -- Renglones (se suman los repetidos)
  select coalesce(jsonb_agg(jsonb_build_object('articulo_id', aid, 'cantidad', cant, 'danadas', dan)), '[]'::jsonb) into v_lote
  from (select (x->>'articulo_id')::uuid aid, sum((x->>'cantidad')::integer)::integer cant,
               sum(coalesce(nullif(x->>'danadas', '')::integer, 0))::integer dan
        from jsonb_array_elements(coalesce(p_args->'items', '[]'::jsonb)) x group by 1) q;
  if jsonb_array_length(v_lote) = 0 or exists (
      select 1 from jsonb_to_recordset(v_lote) l(articulo_id uuid, cantidad integer, danadas integer)
      where articulo_id is null or cantidad is null or cantidad <= 0 or danadas < 0 or danadas > cantidad) then
    return public._fallar(p_idem, 'registrar_movimiento', p_args, 'Cantidades no válidas', 'dato_invalido');
  end if;
  if d.tipo <> 'almacen' and exists (select 1 from jsonb_to_recordset(v_lote) l(articulo_id uuid, cantidad integer, danadas integer) where danadas > 0) then
    return public._fallar(p_idem, 'registrar_movimiento', p_args, 'Las piezas dañadas solo se registran al llegar al Almacén', 'dato_invalido');
  end if;
  if exists (select 1 from jsonb_to_recordset(v_lote) l(articulo_id uuid, cantidad integer, danadas integer)
             left join public.articulos a on a.id = l.articulo_id where a.id is null) then
    return public._fallar(p_idem, 'registrar_movimiento', p_args, 'Artículo no encontrado', 'no_encontrado');
  end if;

  perform public._bloquear_articulos(array(select (x->>'articulo_id')::uuid from jsonb_array_elements(v_lote) x));

  -- Disponibilidad en el origen
  for r in select l.*, a.nombre, a.codigo from jsonb_to_recordset(v_lote) l(articulo_id uuid, cantidad integer, danadas integer)
           join public.articulos a on a.id = l.articulo_id order by l.articulo_id loop
    v_disp := public._disponible(o.id, r.articulo_id);
    if r.cantidad > v_disp then
      if o.tipo = 'evento' and d.tipo in ('almacen', 'reparacion') then
        v_sobrantes := v_sobrantes || jsonb_build_object('articulo_id', r.articulo_id, 'codigo', r.codigo, 'nombre', r.nombre,
                                                         'registradas', v_disp, 'contadas', r.cantidad, 'sobrante', r.cantidad - v_disp);
      else
        v_problemas := v_problemas || jsonb_build_object('articulo_id', r.articulo_id, 'codigo', r.codigo, 'nombre', r.nombre,
                                                         'solicitado', r.cantidad, 'disponible', v_disp);
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_problemas) > 0 then
    return public._fallar(p_idem, 'registrar_movimiento', p_args,
      format('No hay suficientes piezas registradas en %s', o.nombre), 'sin_existencia',
      jsonb_build_object('articulos', v_problemas), o.id);
  end if;

  insert into public.movimientos (operacion_id, tipo, estado, origen_id, destino_id, escaneo_salida, escaneo_salida_por,
                                  escaneo_entrada, escaneo_entrada_por, notas, registrado_por, dispositivo)
  values (p_idem, case when d.tipo = 'baja' then 'baja' else 'traslado' end,
          case when v_pendiente then 'por_autorizar' else 'aplicado' end,
          o.id, d.id, v_es, v_esp, v_ee, v_eep, public._txt(p_args, 'notas'), auth.uid(), p_args->>'dispositivo')
  returning id into v_mov;

  insert into public.movimiento_items (movimiento_id, articulo_id, cantidad, danadas, sobrante)
  select v_mov, l.articulo_id, l.cantidad, l.danadas,
         coalesce((select (s->>'sobrante')::integer from jsonb_array_elements(v_sobrantes) s
                   where (s->>'articulo_id')::uuid = l.articulo_id), 0)
  from jsonb_to_recordset(v_lote) l(articulo_id uuid, cantidad integer, danadas integer);

  if not v_pendiente then perform public._aplicar(v_mov); end if;

  select sum((x->>'cantidad')::integer) into v_total from jsonb_array_elements(v_lote) x;
  perform public._auditar(p_accion => case when v_pendiente then 'solicitar_traslado' else 'registrar_movimiento' end,
    p_entidad => 'movimiento', p_entidad_id => v_mov, p_lugar => o.id,
    p_despues => jsonb_build_object('origen', o.nombre, 'destino', d.nombre, 'articulos', jsonb_array_length(v_lote),
      'piezas', v_total, 'escaneo_salida', v_es, 'escaneo_entrada', v_ee, 'sobrantes', v_sobrantes,
      'danadas', (select coalesce(sum((x->>'danadas')::integer), 0) from jsonb_array_elements(v_lote) x)),
    p_motivo => public._txt(p_args, 'notas'), p_args => p_args);

  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'id', v_mov,
    'estado', case when v_pendiente then 'por_autorizar' else 'aplicado' end, 'sobrantes', v_sobrantes));
end $$;

-- Autorizar o rechazar un traslado entre eventos (administrador).
-- Quien lo solicitó puede cancelarlo (aprobar = false).
create or replace function public.autorizar_movimiento(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  m public.movimientos;
  o public.lugares;
  d public.lugares;
  v_aprobar boolean := coalesce((p_args->>'aprobar')::boolean, false);
  v_problemas jsonb := '[]'::jsonb;
  r record;
  v_disp integer;
begin
  select * into m from public.movimientos where id = (p_args->>'movimiento_id')::uuid;
  if not found then return public._negado('autorizar_movimiento', p_args, 'Movimiento no encontrado'); end if;
  if not (public._es_admin() or (not v_aprobar and m.registrado_por = auth.uid() and public._es_activo())) then
    return public._negado('autorizar_movimiento', p_args, 'Solo el administrador autoriza traslados entre eventos');
  end if;
  v_res := public._idem_inicio(p_idem, 'autorizar_movimiento');
  if v_res is not null then return v_res; end if;

  select * into m from public.movimientos where id = m.id for update;
  if m.estado <> 'por_autorizar' then
    return public._fallar(p_idem, 'autorizar_movimiento', p_args, 'Este traslado ya fue resuelto', 'ya_resuelto');
  end if;
  select * into o from public.lugares where id = m.origen_id;
  select * into d from public.lugares where id = m.destino_id;

  if v_aprobar then
    if o.estado <> 'abierto' or d.estado <> 'abierto' then
      return public._fallar(p_idem, 'autorizar_movimiento', p_args, 'Uno de los eventos está cerrado', 'evento_cerrado');
    end if;
    perform public._bloquear_articulos(array(select articulo_id from public.movimiento_items where movimiento_id = m.id));
    for r in select i.*, a.nombre, a.codigo from public.movimiento_items i join public.articulos a on a.id = i.articulo_id
             where i.movimiento_id = m.id loop
      v_disp := public._disponible(o.id, r.articulo_id);
      if r.cantidad > v_disp then
        v_problemas := v_problemas || jsonb_build_object('codigo', r.codigo, 'nombre', r.nombre, 'solicitado', r.cantidad, 'disponible', v_disp);
      end if;
    end loop;
    if jsonb_array_length(v_problemas) > 0 then
      return public._fallar(p_idem, 'autorizar_movimiento', p_args,
        format('%s ya no tiene esas piezas registradas', o.nombre), 'sin_existencia', jsonb_build_object('articulos', v_problemas), o.id);
    end if;
    update public.movimientos set estado = 'aplicado', autorizado_por = auth.uid(), autorizado_at = now() where id = m.id;
    perform public._aplicar(m.id);
  else
    if public._txt(p_args, 'motivo') is null then
      return public._fallar(p_idem, 'autorizar_movimiento', p_args, 'Escribe el motivo', 'falta_motivo');
    end if;
    update public.movimientos set estado = 'rechazado', autorizado_por = auth.uid(), autorizado_at = now(),
           rechazo_motivo = public._txt(p_args, 'motivo')
     where id = m.id;
  end if;

  perform public._auditar(p_accion => case when v_aprobar then 'autorizar_traslado'
                                           when m.registrado_por = auth.uid() and not public._es_admin() then 'cancelar_traslado'
                                           else 'rechazar_traslado' end,
    p_entidad => 'movimiento', p_entidad_id => m.id, p_lugar => o.id,
    p_despues => jsonb_build_object('origen', o.nombre, 'destino', d.nombre), p_motivo => public._txt(p_args, 'motivo'), p_args => p_args);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true));
end $$;

-- Corrige un movimiento registrado por error: crea un movimiento inverso.
create or replace function public.revertir_movimiento(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  m public.movimientos;
  v_motivo text := public._txt(p_args, 'motivo');
  v_rep uuid := public._lugar('reparacion');
  v_corr uuid;
  it public.movimiento_items;
  v_falta jsonb := '[]'::jsonb;
begin
  select * into m from public.movimientos where id = (p_args->>'movimiento_id')::uuid;
  if not found then return public._negado('revertir_movimiento', p_args, 'Movimiento no encontrado'); end if;
  if not (public._es_admin() or (m.registrado_por = auth.uid() and public._tiene(array['salidas', 'recogidas']))) then
    return public._negado('revertir_movimiento', p_args, 'Solo quien lo registró o un administrador puede corregirlo');
  end if;
  v_res := public._idem_inicio(p_idem, 'revertir_movimiento');
  if v_res is not null then return v_res; end if;

  select * into m from public.movimientos where id = m.id for update;
  if m.estado <> 'aplicado' or m.tipo not in ('traslado', 'alta', 'ajuste', 'baja') then
    return public._fallar(p_idem, 'revertir_movimiento', p_args, 'Este movimiento no se puede corregir', 'no_reversible');
  end if;
  if v_motivo is null then return public._fallar(p_idem, 'revertir_movimiento', p_args, 'El motivo es obligatorio', 'falta_motivo'); end if;
  if exists (select 1 from public.lugares where id in (m.origen_id, m.destino_id) and tipo = 'evento' and estado = 'cerrado') then
    return public._fallar(p_idem, 'revertir_movimiento', p_args, 'Uno de los eventos está cerrado', 'evento_cerrado');
  end if;

  perform public._bloquear_articulos(array(select articulo_id from public.movimiento_items where movimiento_id = m.id));
  for it in select * from public.movimiento_items where movimiento_id = m.id loop
    if m.destino_id is not null and public._disponible(m.destino_id, it.articulo_id) < it.cantidad - it.danadas then
      v_falta := v_falta || jsonb_build_object('articulo_id', it.articulo_id, 'lugar', 'destino');
    end if;
    if it.danadas > 0 and public._disponible(v_rep, it.articulo_id) < it.danadas then
      v_falta := v_falta || jsonb_build_object('articulo_id', it.articulo_id, 'lugar', 'reparacion');
    end if;
  end loop;
  if jsonb_array_length(v_falta) > 0 then
    return public._fallar(p_idem, 'revertir_movimiento', p_args,
      'Las piezas ya se movieron a otro lugar; corrige primero los movimientos posteriores', 'no_reversible');
  end if;

  insert into public.movimientos (operacion_id, tipo, origen_id, destino_id, motivo, registrado_por, dispositivo, revierte_a)
  values (p_idem, 'correccion', m.destino_id, m.origen_id, v_motivo, auth.uid(), p_args->>'dispositivo', m.id)
  returning id into v_corr;
  insert into public.movimiento_items (movimiento_id, articulo_id, cantidad, danadas, sobrante)
  select v_corr, articulo_id, cantidad, danadas, sobrante from public.movimiento_items where movimiento_id = m.id;

  for it in select * from public.movimiento_items where movimiento_id = m.id order by articulo_id loop
    if m.destino_id is not null then perform public._mover(v_corr, m.destino_id, it.articulo_id, -(it.cantidad - it.danadas), false); end if;
    if it.danadas > 0 then perform public._mover(v_corr, v_rep, it.articulo_id, -it.danadas, false); end if;
    if m.origen_id is not null then perform public._mover(v_corr, m.origen_id, it.articulo_id, it.cantidad - it.sobrante, false); end if;
  end loop;

  update public.movimientos set estado = 'revertido', revertido_por = auth.uid(), revertido_at = now() where id = m.id;
  perform public._auditar(p_accion => 'corregir_movimiento', p_entidad => 'movimiento', p_entidad_id => m.id,
    p_lugar => coalesce(m.origen_id, m.destino_id), p_motivo => v_motivo,
    p_despues => jsonb_build_object('correccion_id', v_corr, 'registrado_por', m.registrado_por, 'registrado_el', m.created_at),
    p_args => p_args);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'id', v_corr));
end $$;

-- Material del Almacén que llegó sin escanear y se escaneó después.
-- args: {items:[{articulo_id, cantidad}], escaneado_por: uuid}
create or replace function public.marcar_escaneado(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_alm uuid := public._lugar('almacen');
  v_por uuid := coalesce(nullif(p_args->>'escaneado_por', '')::uuid, auth.uid());
  v_lote jsonb;
  v_mov uuid;
  r record;
  v_sin integer;
begin
  if not public._tiene(array['recogidas']) then return public._negado('marcar_escaneado', p_args); end if;
  v_res := public._idem_inicio(p_idem, 'marcar_escaneado');
  if v_res is not null then return v_res; end if;
  if not public._perfil_activo(v_por) then
    return public._fallar(p_idem, 'marcar_escaneado', p_args, 'La persona que escaneó no es un usuario activo', 'dato_invalido');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('articulo_id', aid, 'cantidad', cant)), '[]'::jsonb) into v_lote
  from (select (x->>'articulo_id')::uuid aid, sum((x->>'cantidad')::integer)::integer cant
        from jsonb_array_elements(coalesce(p_args->'items', '[]'::jsonb)) x group by 1) q;
  if jsonb_array_length(v_lote) = 0 or exists (select 1 from jsonb_to_recordset(v_lote) l(articulo_id uuid, cantidad integer)
                                               where articulo_id is null or cantidad is null or cantidad <= 0) then
    return public._fallar(p_idem, 'marcar_escaneado', p_args, 'Cantidades no válidas', 'dato_invalido');
  end if;
  perform public._bloquear_articulos(array(select (x->>'articulo_id')::uuid from jsonb_array_elements(v_lote) x));
  for r in select * from jsonb_to_recordset(v_lote) l(articulo_id uuid, cantidad integer) loop
    select sin_escanear into v_sin from public.existencias where lugar_id = v_alm and articulo_id = r.articulo_id;
    if coalesce(v_sin, 0) < r.cantidad then
      return public._fallar(p_idem, 'marcar_escaneado', p_args,
        format('Solo hay %s pieza(s) pendientes de escanear de ese artículo', coalesce(v_sin, 0)), 'dato_invalido');
    end if;
  end loop;

  insert into public.movimientos (operacion_id, tipo, destino_id, escaneo_entrada, escaneo_entrada_por, registrado_por, dispositivo, notas)
  values (p_idem, 'escaneo', v_alm, 'escaneado', v_por, auth.uid(), p_args->>'dispositivo', public._txt(p_args, 'notas'))
  returning id into v_mov;
  insert into public.movimiento_items (movimiento_id, articulo_id, cantidad)
  select v_mov, articulo_id, cantidad from jsonb_to_recordset(v_lote) l(articulo_id uuid, cantidad integer);
  update public.existencias e set sin_escanear = e.sin_escanear - l.cantidad, updated_at = now()
    from jsonb_to_recordset(v_lote) l(articulo_id uuid, cantidad integer)
   where e.lugar_id = v_alm and e.articulo_id = l.articulo_id;

  perform public._auditar(p_accion => 'marcar_escaneado', p_entidad => 'movimiento', p_entidad_id => v_mov, p_lugar => v_alm,
    p_despues => jsonb_build_object('piezas', (select sum((x->>'cantidad')::integer) from jsonb_array_elements(v_lote) x),
                                    'escaneado_por', (select nombre from public.perfiles where id = v_por)), p_args => p_args);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'id', v_mov));
end $$;

-- =====================================================================
-- VERIFICACIÓN: existencias = suma del historial (debe devolver 0 filas)
-- =====================================================================
create or replace function public.verificar_saldos() returns table (lugar text, articulo text, guardado integer, historial integer)
language sql stable security definer set search_path = public, pg_temp as $$
  with h as (select lugar_id, articulo_id, sum(delta)::integer s from public.asientos group by 1, 2)
  select l.nombre, a.nombre, coalesce(e.cantidad, 0), coalesce(h.s, 0)
  from public.existencias e
  full join h on h.lugar_id = e.lugar_id and h.articulo_id = e.articulo_id
  join public.lugares l on l.id = coalesce(e.lugar_id, h.lugar_id)
  join public.articulos a on a.id = coalesce(e.articulo_id, h.articulo_id)
  where public._es_admin() and coalesce(e.cantidad, 0) <> coalesce(h.s, 0)
$$;

-- Restablecer la contraseña de un usuario (administrador)
create or replace function public.restablecer_contrasena(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_res jsonb;
  v_id uuid := (p_args->>'usuario_id')::uuid;
  v_pass text := p_args->>'contrasena';
  v_usuario text;
begin
  if not public._es_admin() then return public._negado('restablecer_contrasena', p_args - 'contrasena'); end if;
  v_res := public._idem_inicio(p_idem, 'restablecer_contrasena');
  if v_res is not null then return v_res; end if;
  select usuario into v_usuario from public.perfiles where id = v_id;
  if v_usuario is null then return public._fallar(p_idem, 'restablecer_contrasena', p_args - 'contrasena', 'Usuario no encontrado', 'no_encontrado'); end if;
  if v_pass is null or length(v_pass) < 8 then
    return public._fallar(p_idem, 'restablecer_contrasena', p_args - 'contrasena', 'La contraseña debe tener al menos 8 caracteres', 'dato_invalido');
  end if;
  update auth.users set encrypted_password = extensions.crypt(v_pass, extensions.gen_salt('bf')), updated_at = now() where id = v_id;
  perform public._auditar(p_accion => 'restablecer_contrasena', p_entidad => 'perfil', p_entidad_id => v_id, p_detalle => v_usuario,
                          p_args => p_args - 'contrasena');
  return public._idem_fin(p_idem, jsonb_build_object('ok', true));
end $$;
