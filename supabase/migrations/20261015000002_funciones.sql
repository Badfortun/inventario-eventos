-- =====================================================================
-- Inventario de Eventos · 2/3 · Funciones del servidor
--
-- Patrón de TODAS las operaciones que modifican datos:
--   fn(p_idem uuid, p_args jsonb) returns jsonb
--   1. Verifica permisos (si no, registra el intento rechazado).
--   2. Idempotencia: si p_idem ya se procesó, devuelve el mismo resultado.
--   3. Valida todo ANTES de escribir.
--   4. Escribe movimientos + saldos + bitácora en una sola transacción.
-- Respuesta: {"ok": true, ...} o {"ok": false, "error": "...", "codigo": "..."}
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilidades internas
-- ---------------------------------------------------------------------
create or replace function public._tiene(p_roles text[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and activo
      and roles && (p_roles || array['admin']::text[])
  )
$$;

create or replace function public._es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public._tiene(array['admin']::text[])
$$;

create or replace function public._es_activo() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.perfiles
                 where id = auth.uid() and activo and cardinality(roles) > 0)
$$;

create or replace function public._auditar(
  p_accion text, p_exito boolean default true,
  p_entidad text default null, p_entidad_id uuid default null,
  p_evento uuid default null, p_variante uuid default null,
  p_antes jsonb default null, p_despues jsonb default null,
  p_motivo text default null, p_detalle text default null,
  p_args jsonb default '{}'::jsonb, p_idem uuid default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.auditoria (usuario_id, usuario_nombre, accion, exito, entidad, entidad_id,
    evento_id, variante_id, antes, despues, motivo, detalle, dispositivo, hora_local, operacion_id)
  values (auth.uid(),
          (select nombre from public.perfiles where id = auth.uid()),
          p_accion, p_exito, p_entidad, p_entidad_id, p_evento, p_variante,
          p_antes, p_despues, nullif(trim(p_motivo),''), p_detalle,
          left(p_args->>'dispositivo', 200),
          nullif(p_args->>'hora_local','')::timestamptz,
          p_idem);
end $$;

-- Permiso denegado: se registra el intento y no se hace nada.
create or replace function public._negado(p_accion text, p_args jsonb, p_idem uuid,
  p_msg text default 'No tienes permiso para esta operación')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._auditar(p_accion => p_accion, p_exito => false, p_detalle => 'Permiso denegado: '||p_msg,
                          p_args => p_args, p_idem => p_idem);
  return jsonb_build_object('ok', false, 'error', p_msg, 'codigo', 'sin_permiso');
end $$;

-- Inicio de operación idempotente. Devuelve NULL si es nueva, o el
-- resultado guardado si ya se había procesado.
create or replace function public._idem_inicio(p_idem uuid, p_funcion text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.operaciones;
begin
  if p_idem is null then
    raise exception 'Falta la clave de operación (idempotencia)';
  end if;
  insert into public.operaciones (id, funcion, usuario_id)
  values (p_idem, p_funcion, auth.uid())
  on conflict (id) do nothing;
  if found then
    return null;
  end if;
  select * into r from public.operaciones where id = p_idem;
  if r.usuario_id <> auth.uid() or r.funcion <> p_funcion then
    return jsonb_build_object('ok', false, 'codigo', 'idem_conflicto',
      'error', 'Esta clave de operación ya se usó para otra operación');
  end if;
  return coalesce(r.resultado, '{}'::jsonb) || jsonb_build_object('repetida', true);
end $$;

create or replace function public._idem_fin(p_idem uuid, p_res jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.operaciones set resultado = p_res where id = p_idem;
  return p_res;
end $$;

-- Falla de negocio (sin disponible, estado incorrecto…). Libera la clave
-- de idempotencia para que el usuario pueda corregir y reintentar.
create or replace function public._fallar(p_idem uuid, p_accion text, p_args jsonb,
  p_msg text, p_codigo text, p_extra jsonb default null,
  p_evento uuid default null, p_variante uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.operaciones where id = p_idem;
  perform public._auditar(p_accion => p_accion, p_exito => false, p_evento => p_evento,
    p_variante => p_variante, p_detalle => p_msg, p_despues => p_extra,
    p_args => p_args, p_idem => p_idem);
  return jsonb_build_object('ok', false, 'error', p_msg, 'codigo', p_codigo)
         || coalesce(p_extra, '{}'::jsonb);
end $$;

create or replace function public._pin_ok(p_pin text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (select 1 from public.perfiles_pin
                 where usuario_id = auth.uid()
                   and p_pin is not null
                   and pin_hash = extensions.crypt(p_pin, pin_hash))
$$;

create or replace function public._txt(p_args jsonb, p_key text) returns text
language sql immutable as $$ select nullif(trim(p_args->>p_key), '') $$;

-- Unidades reservadas por eventos ACTIVOS que aún no se entregan.
create or replace function public._reservado(p_variante uuid, p_excluir_evento uuid default null)
returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(greatest(0, ei.cantidad_planeada - ei.entregada)), 0)::integer
  from public.evento_items ei
  join public.eventos e on e.id = ei.evento_id
  where ei.variante_id = p_variante
    and e.estado = 'activo'
    and e.id is distinct from p_excluir_evento
$$;

-- Mantiene una sola incidencia abierta por evento/variante/tipo con la
-- cantidad actual; si la diferencia desaparece, la marca como resuelta.
create or replace function public._ajustar_incidencia(p_evento uuid, p_variante uuid, p_tipo text,
  p_cantidad integer, p_esperada integer, p_contada integer)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from public.incidencias
  where evento_id = p_evento and variante_id = p_variante and tipo = p_tipo
    and estado in ('pendiente','investigacion')
  for update;

  if p_cantidad > 0 then
    if v_id is null then
      insert into public.incidencias (evento_id, variante_id, tipo, cantidad_esperada, cantidad_contada,
                                      diferencia, cantidad, reportado_por,
                                      motivo)
      values (p_evento, p_variante, p_tipo, p_esperada, p_contada, p_contada - p_esperada, p_cantidad,
              auth.uid(),
              case p_tipo when 'dano' then 'daño' when 'sobrante' then 'pendiente de investigar'
                          else 'pendiente de investigar' end);
    else
      update public.incidencias
         set cantidad = p_cantidad, cantidad_esperada = p_esperada, cantidad_contada = p_contada,
             diferencia = p_contada - p_esperada, updated_at = now()
       where id = v_id;
    end if;
  elsif v_id is not null then
    update public.incidencias
       set estado = 'resuelta', accion = 'Diferencia corregida en el conteo', revisado_at = now(),
           updated_at = now()
     where id = v_id;
  end if;
end $$;

create or replace function public._recalcular(p_evento uuid, p_variante uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare it public.evento_items;
begin
  if not (select conteo_terminado from public.eventos where id = p_evento) then
    return;
  end if;
  select * into it from public.evento_items where evento_id = p_evento and variante_id = p_variante;
  if not found then return; end if;
  perform public._ajustar_incidencia(p_evento, p_variante, 'faltante',
            greatest(0, it.entregada - it.regresada - it.baja), it.entregada, it.regresada);
  perform public._ajustar_incidencia(p_evento, p_variante, 'sobrante',
            greatest(0, it.regresada - it.entregada - it.sobrante_aceptado), it.entregada, it.regresada);
  perform public._ajustar_incidencia(p_evento, p_variante, 'dano',
            greatest(0, it.danada - it.danado_revisado), 0, it.danada);
end $$;

-- Diferencias sin resolver de un evento (para el cierre)
create or replace function public._pendientes_evento(p_evento uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'incidencias_abiertas', (select count(*) from public.incidencias
                             where evento_id = p_evento and estado in ('pendiente','investigacion')),
    'por_recoger', (select coalesce(sum(greatest(0, entregada - regresada - baja)),0) from public.evento_items where evento_id = p_evento),
    'sobrante_sin_revisar', (select coalesce(sum(greatest(0, regresada - entregada - sobrante_aceptado)),0) from public.evento_items where evento_id = p_evento),
    'danado_sin_revisar', (select coalesce(sum(greatest(0, danada - danado_revisado)),0) from public.evento_items where evento_id = p_evento)
  )
$$;

-- =====================================================================
-- USUARIOS
-- =====================================================================

-- Registra un inicio de sesión en la bitácora (la app lo llama al entrar).
create or replace function public.registrar_acceso(p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_activo boolean;
begin
  select activo into v_activo from public.perfiles where id = auth.uid();
  perform public._auditar(p_accion => 'inicio_sesion', p_exito => coalesce(v_activo,false),
    p_detalle => case when coalesce(v_activo,false) then null else 'Usuario pendiente de aprobación o desactivado' end,
    p_args => p_args);
  return jsonb_build_object('ok', true, 'activo', coalesce(v_activo,false));
end $$;

create or replace function public.establecer_pin(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_res jsonb;
  v_nuevo text := p_args->>'pin_nuevo';
begin
  if not public._es_activo() then
    return public._negado('establecer_pin', p_args, p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'establecer_pin');
  if v_res is not null then return v_res; end if;

  if v_nuevo is null or v_nuevo !~ '^[0-9]{4,6}$' then
    return public._fallar(p_idem, 'establecer_pin', p_args, 'El PIN debe tener de 4 a 6 dígitos', 'pin_invalido');
  end if;
  if exists (select 1 from public.perfiles_pin where usuario_id = auth.uid())
     and not public._pin_ok(p_args->>'pin_actual') then
    return public._fallar(p_idem, 'establecer_pin', p_args, 'El PIN actual no es correcto', 'pin_incorrecto');
  end if;

  insert into public.perfiles_pin (usuario_id, pin_hash, updated_at)
  values (auth.uid(), extensions.crypt(v_nuevo, extensions.gen_salt('bf')), now())
  on conflict (usuario_id) do update set pin_hash = excluded.pin_hash, updated_at = now();

  perform public._auditar(p_accion => 'establecer_pin', p_entidad => 'perfil', p_entidad_id => auth.uid(),
                          p_args => p_args, p_idem => p_idem);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true));
end $$;

create or replace function public.verificar_pin(p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ok boolean;
begin
  v_ok := public._pin_ok(p_args->>'pin');
  -- Con PIN vacío solo se consulta si el usuario ya tiene PIN (no se registra)
  if not v_ok and coalesce(p_args->>'pin', '') <> '' then
    perform public._auditar(p_accion => 'verificar_pin', p_exito => false, p_detalle => 'PIN incorrecto', p_args => p_args);
  end if;
  return jsonb_build_object('ok', v_ok,
    'tiene_pin', exists (select 1 from public.perfiles_pin where usuario_id = auth.uid()));
end $$;

-- Aprobar usuarios, cambiar roles, activar/desactivar (solo administrador)
create or replace function public.actualizar_usuario(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_id uuid := (p_args->>'usuario_id')::uuid;
  v_antes public.perfiles;
  v_despues public.perfiles;
  v_roles text[];
  v_activo boolean;
begin
  if not public._es_admin() then
    return public._negado('actualizar_usuario', p_args, p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'actualizar_usuario');
  if v_res is not null then return v_res; end if;

  select * into v_antes from public.perfiles where id = v_id for update;
  if not found then
    return public._fallar(p_idem, 'actualizar_usuario', p_args, 'Usuario no encontrado', 'no_encontrado');
  end if;

  v_roles := case when p_args ? 'roles'
                  then array(select distinct jsonb_array_elements_text(p_args->'roles'))
                  else v_antes.roles end;
  v_activo := coalesce((p_args->>'activo')::boolean, v_antes.activo);

  if not (v_roles <@ array['admin','salidas','recogidas','lectura']::text[]) then
    return public._fallar(p_idem, 'actualizar_usuario', p_args, 'Rol no válido', 'rol_invalido');
  end if;
  if v_activo and cardinality(v_roles) = 0 then
    return public._fallar(p_idem, 'actualizar_usuario', p_args, 'Asigna al menos un rol para activar al usuario', 'sin_rol');
  end if;
  -- No dejar el sistema sin administradores
  if 'admin' = any(v_antes.roles) and v_antes.activo and (not ('admin' = any(v_roles)) or not v_activo)
     and (select count(*) from public.perfiles where activo and 'admin' = any(roles)) <= 1 then
    return public._fallar(p_idem, 'actualizar_usuario', p_args,
      'Debe quedar al menos un administrador activo', 'ultimo_admin');
  end if;

  update public.perfiles
     set roles = v_roles, activo = v_activo,
         nombre = coalesce(public._txt(p_args,'nombre'), nombre),
         updated_at = now()
   where id = v_id
   returning * into v_despues;

  perform public._auditar(p_accion => 'actualizar_usuario', p_entidad => 'perfil', p_entidad_id => v_id,
    p_antes => jsonb_build_object('nombre', v_antes.nombre, 'roles', v_antes.roles, 'activo', v_antes.activo),
    p_despues => jsonb_build_object('nombre', v_despues.nombre, 'roles', v_despues.roles, 'activo', v_despues.activo),
    p_detalle => v_despues.usuario, p_args => p_args, p_idem => p_idem);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true));
end $$;

-- Restablecer contraseña y/o PIN de otro usuario (administrador + PIN)
create or replace function public.restablecer_acceso(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_res jsonb;
  v_id uuid := (p_args->>'usuario_id')::uuid;
  v_pass text := p_args->>'contrasena';
  v_usuario text;
begin
  if not public._es_admin() then
    return public._negado('restablecer_acceso', p_args, p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'restablecer_acceso');
  if v_res is not null then return v_res; end if;

  if not public._pin_ok(p_args->>'pin') then
    return public._fallar(p_idem, 'restablecer_acceso', p_args, 'PIN de administrador incorrecto', 'pin_incorrecto');
  end if;
  select usuario into v_usuario from public.perfiles where id = v_id;
  if v_usuario is null then
    return public._fallar(p_idem, 'restablecer_acceso', p_args, 'Usuario no encontrado', 'no_encontrado');
  end if;
  if v_pass is not null then
    if length(v_pass) < 8 then
      return public._fallar(p_idem, 'restablecer_acceso', p_args, 'La contraseña debe tener al menos 8 caracteres', 'contrasena_corta');
    end if;
    update auth.users set encrypted_password = extensions.crypt(v_pass, extensions.gen_salt('bf')),
                          updated_at = now()
     where id = v_id;
  end if;
  if coalesce((p_args->>'borrar_pin')::boolean, false) then
    delete from public.perfiles_pin where usuario_id = v_id;
  end if;

  perform public._auditar(p_accion => 'restablecer_acceso', p_entidad => 'perfil', p_entidad_id => v_id,
    p_detalle => v_usuario || case when v_pass is not null then ' · contraseña' else '' end
                           || case when coalesce((p_args->>'borrar_pin')::boolean,false) then ' · PIN borrado' else '' end,
    p_args => p_args - 'contrasena' - 'pin', p_idem => p_idem);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true));
end $$;

-- =====================================================================
-- CATÁLOGO
-- =====================================================================
create or replace function public.guardar_variante(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_id uuid := nullif(p_args->>'id','')::uuid;
  v_antes public.variantes;
  v_despues public.variantes;
  v_inicial integer := coalesce(nullif(p_args->>'existencia_inicial','')::integer, 0);
begin
  if not public._es_admin() then
    return public._negado('guardar_variante', p_args, p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'guardar_variante');
  if v_res is not null then return v_res; end if;

  if public._txt(p_args,'nombre') is null then
    return public._fallar(p_idem, 'guardar_variante', p_args, 'El nombre es obligatorio', 'dato_invalido');
  end if;
  if v_inicial < 0 then
    return public._fallar(p_idem, 'guardar_variante', p_args, 'La existencia inicial no puede ser negativa', 'dato_invalido');
  end if;
  if public._txt(p_args,'color_hex') is not null and public._txt(p_args,'color_hex') !~ '^#[0-9A-Fa-f]{6}$' then
    return public._fallar(p_idem, 'guardar_variante', p_args, 'Color hexadecimal no válido (ej. #8B4513)', 'dato_invalido');
  end if;
  if public._txt(p_args,'sku') is not null and exists (
       select 1 from public.variantes where sku = public._txt(p_args,'sku') and id is distinct from v_id) then
    return public._fallar(p_idem, 'guardar_variante', p_args, 'Ya existe un artículo con ese SKU', 'sku_duplicado');
  end if;

  if v_id is null then
    insert into public.variantes (nombre, sku, categoria, descripcion, color_nombre, color_hex, medida,
      unidad_medida, unidad_inventario, marca_modelo, numero_serie, ubicacion, foto_url, notas, created_by)
    values (public._txt(p_args,'nombre'), public._txt(p_args,'sku'), public._txt(p_args,'categoria'),
      public._txt(p_args,'descripcion'), public._txt(p_args,'color_nombre'), upper(public._txt(p_args,'color_hex')),
      nullif(p_args->>'medida','')::numeric, public._txt(p_args,'unidad_medida'),
      coalesce(public._txt(p_args,'unidad_inventario'), 'pieza'), public._txt(p_args,'marca_modelo'),
      public._txt(p_args,'numero_serie'), public._txt(p_args,'ubicacion'), public._txt(p_args,'foto_url'),
      public._txt(p_args,'notas'), auth.uid())
    returning * into v_despues;

    if v_inicial > 0 then
      insert into public.movimientos (operacion_id, tipo, variante_id, cantidad, efecto_existencia, motivo,
                                      usuario_id, dispositivo, hora_local)
      values (p_idem, 'entrada', v_despues.id, v_inicial, v_inicial, 'Existencia inicial',
              auth.uid(), p_args->>'dispositivo', nullif(p_args->>'hora_local','')::timestamptz);
      update public.variantes set existencia = existencia + v_inicial where id = v_despues.id
      returning * into v_despues;
    end if;

    perform public._auditar(p_accion => 'alta_articulo', p_entidad => 'variante', p_entidad_id => v_despues.id,
      p_variante => v_despues.id, p_despues => to_jsonb(v_despues), p_args => p_args, p_idem => p_idem);
  else
    select * into v_antes from public.variantes where id = v_id for update;
    if not found then
      return public._fallar(p_idem, 'guardar_variante', p_args, 'Artículo no encontrado', 'no_encontrado');
    end if;
    update public.variantes set
      nombre = public._txt(p_args,'nombre'), sku = public._txt(p_args,'sku'),
      categoria = public._txt(p_args,'categoria'), descripcion = public._txt(p_args,'descripcion'),
      color_nombre = public._txt(p_args,'color_nombre'), color_hex = upper(public._txt(p_args,'color_hex')),
      medida = nullif(p_args->>'medida','')::numeric, unidad_medida = public._txt(p_args,'unidad_medida'),
      unidad_inventario = coalesce(public._txt(p_args,'unidad_inventario'), unidad_inventario),
      marca_modelo = public._txt(p_args,'marca_modelo'), numero_serie = public._txt(p_args,'numero_serie'),
      ubicacion = public._txt(p_args,'ubicacion'), foto_url = public._txt(p_args,'foto_url'),
      notas = public._txt(p_args,'notas'),
      activo = coalesce((p_args->>'activo')::boolean, activo),
      updated_at = now()
    where id = v_id
    returning * into v_despues;

    perform public._auditar(
      p_accion => case when v_antes.activo and not v_despues.activo then 'desactivar_articulo'
                       when not v_antes.activo and v_despues.activo then 'reactivar_articulo'
                       else 'editar_articulo' end,
      p_entidad => 'variante', p_entidad_id => v_id, p_variante => v_id,
      p_antes => to_jsonb(v_antes) - 'updated_at', p_despues => to_jsonb(v_despues) - 'updated_at',
      p_args => p_args, p_idem => p_idem);
  end if;

  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'id', v_despues.id));
end $$;

-- Entradas (compras) y ajustes autorizados de existencia
create or replace function public.ajustar_existencia(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_var uuid := (p_args->>'variante_id')::uuid;
  v_cant integer := (p_args->>'cantidad')::integer;
  v_tipo text := coalesce(p_args->>'tipo', 'ajuste');
  v_motivo text := public._txt(p_args, 'motivo');
  v_antes integer;
begin
  if not public._es_admin() then
    return public._negado('ajustar_existencia', p_args, p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'ajustar_existencia');
  if v_res is not null then return v_res; end if;

  if v_tipo not in ('entrada','ajuste') or v_cant is null or v_cant = 0 or (v_tipo = 'entrada' and v_cant < 0) then
    return public._fallar(p_idem, 'ajustar_existencia', p_args, 'Cantidad o tipo no válido', 'dato_invalido', p_variante => v_var);
  end if;
  if v_motivo is null then
    return public._fallar(p_idem, 'ajustar_existencia', p_args, 'El motivo es obligatorio', 'falta_motivo', p_variante => v_var);
  end if;
  if v_tipo = 'ajuste' and not public._pin_ok(p_args->>'pin') then
    return public._fallar(p_idem, 'ajustar_existencia', p_args - 'pin', 'PIN incorrecto', 'pin_incorrecto', p_variante => v_var);
  end if;

  select existencia into v_antes from public.variantes where id = v_var for update;
  if not found then
    return public._fallar(p_idem, 'ajustar_existencia', p_args - 'pin', 'Artículo no encontrado', 'no_encontrado');
  end if;
  if v_antes + v_cant < 0 then
    return public._fallar(p_idem, 'ajustar_existencia', p_args - 'pin',
      format('La existencia quedaría negativa (actual: %s)', v_antes), 'existencia_negativa', p_variante => v_var);
  end if;

  insert into public.movimientos (operacion_id, tipo, variante_id, cantidad, efecto_existencia, motivo,
                                  usuario_id, dispositivo, hora_local)
  values (p_idem, v_tipo, v_var, v_cant, v_cant, v_motivo, auth.uid(),
          p_args->>'dispositivo', nullif(p_args->>'hora_local','')::timestamptz);
  update public.variantes set existencia = existencia + v_cant, updated_at = now() where id = v_var;

  perform public._auditar(p_accion => case v_tipo when 'entrada' then 'entrada_existencia' else 'ajuste_existencia' end,
    p_entidad => 'variante', p_entidad_id => v_var, p_variante => v_var,
    p_antes => jsonb_build_object('existencia', v_antes),
    p_despues => jsonb_build_object('existencia', v_antes + v_cant),
    p_motivo => v_motivo, p_args => p_args - 'pin', p_idem => p_idem);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'existencia', v_antes + v_cant));
end $$;

-- =====================================================================
-- EVENTOS
-- =====================================================================
create or replace function public.guardar_evento(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_id uuid := nullif(p_args->>'id','')::uuid;
  v_antes public.eventos;
  v_despues public.eventos;
begin
  if not public._es_admin() then
    return public._negado('guardar_evento', p_args, p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'guardar_evento');
  if v_res is not null then return v_res; end if;

  if public._txt(p_args,'nombre') is null or public._txt(p_args,'fecha') is null then
    return public._fallar(p_idem, 'guardar_evento', p_args, 'Nombre y fecha son obligatorios', 'dato_invalido');
  end if;

  if v_id is null then
    insert into public.eventos (nombre, fecha, ubicacion, notas, created_by)
    values (public._txt(p_args,'nombre'), (p_args->>'fecha')::date, public._txt(p_args,'ubicacion'),
            public._txt(p_args,'notas'), auth.uid())
    returning * into v_despues;
    perform public._auditar(p_accion => 'crear_evento', p_entidad => 'evento', p_entidad_id => v_despues.id,
      p_evento => v_despues.id, p_despues => to_jsonb(v_despues), p_args => p_args, p_idem => p_idem);
  else
    select * into v_antes from public.eventos where id = v_id for update;
    if not found then
      return public._fallar(p_idem, 'guardar_evento', p_args, 'Evento no encontrado', 'no_encontrado');
    end if;
    if v_antes.estado = 'cerrado' then
      return public._fallar(p_idem, 'guardar_evento', p_args, 'El evento está cerrado', 'evento_cerrado', p_evento => v_id);
    end if;
    update public.eventos set nombre = public._txt(p_args,'nombre'), fecha = (p_args->>'fecha')::date,
      ubicacion = public._txt(p_args,'ubicacion'), notas = public._txt(p_args,'notas'), updated_at = now()
    where id = v_id returning * into v_despues;
    perform public._auditar(p_accion => 'editar_evento', p_entidad => 'evento', p_entidad_id => v_id,
      p_evento => v_id, p_antes => to_jsonb(v_antes) - 'updated_at', p_despues => to_jsonb(v_despues) - 'updated_at',
      p_args => p_args, p_idem => p_idem);
  end if;
  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'id', v_despues.id));
end $$;

-- Agregar un artículo a la lista del evento o cambiar su cantidad planeada.
-- En eventos activos valida que haya disponible (o autorización con PIN).
create or replace function public.planear_item(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_ev public.eventos;
  v_var public.variantes;
  v_cant integer := (p_args->>'cantidad')::integer;
  v_forzar boolean := coalesce((p_args->>'forzar')::boolean, false);
  v_item public.evento_items;
  v_disp integer;
  v_antes integer;
begin
  if not public._es_admin() then
    return public._negado('planear_item', p_args, p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'planear_item');
  if v_res is not null then return v_res; end if;

  select * into v_ev from public.eventos where id = (p_args->>'evento_id')::uuid for update;
  if not found or v_ev.estado not in ('borrador','activo') then
    return public._fallar(p_idem, 'planear_item', p_args - 'pin',
      'Solo se puede planear en eventos en borrador o activos', 'estado_invalido', p_evento => v_ev.id);
  end if;
  if v_cant is null or v_cant < 0 then
    return public._fallar(p_idem, 'planear_item', p_args - 'pin', 'Cantidad no válida', 'dato_invalido', p_evento => v_ev.id);
  end if;

  select * into v_var from public.variantes where id = (p_args->>'variante_id')::uuid for update;
  if not found then
    return public._fallar(p_idem, 'planear_item', p_args - 'pin', 'Artículo no encontrado', 'no_encontrado', p_evento => v_ev.id);
  end if;

  select * into v_item from public.evento_items where evento_id = v_ev.id and variante_id = v_var.id for update;
  if v_item.id is null and not v_var.activo then
    return public._fallar(p_idem, 'planear_item', p_args - 'pin', 'El artículo está desactivado', 'articulo_inactivo',
      p_evento => v_ev.id, p_variante => v_var.id);
  end if;

  if v_ev.estado = 'activo' then
    v_disp := v_var.existencia - public._reservado(v_var.id, v_ev.id);
    if v_cant - coalesce(v_item.entregada, 0) > v_disp then
      if not v_forzar then
        return public._fallar(p_idem, 'planear_item', p_args - 'pin',
          format('Solo hay %s disponibles de "%s"', greatest(v_disp,0), v_var.nombre), 'sin_disponible',
          jsonb_build_object('disponible', v_disp), v_ev.id, v_var.id);
      end if;
      if public._txt(p_args,'motivo') is null or not public._pin_ok(p_args->>'pin') then
        return public._fallar(p_idem, 'planear_item', p_args - 'pin',
          'Para reservar más de lo disponible se requiere motivo y PIN', 'requiere_autorizacion', p_evento => v_ev.id, p_variante => v_var.id);
      end if;
    end if;
  end if;

  v_antes := v_item.cantidad_planeada;
  insert into public.evento_items (evento_id, variante_id, cantidad_planeada)
  values (v_ev.id, v_var.id, v_cant)
  on conflict (evento_id, variante_id) do update
    set cantidad_planeada = excluded.cantidad_planeada, updated_at = now();

  perform public._auditar(p_accion => case when v_antes is null then 'agregar_a_evento' else 'cambiar_planeado' end,
    p_entidad => 'evento_item', p_evento => v_ev.id, p_variante => v_var.id,
    p_antes => case when v_antes is null then null else jsonb_build_object('planeada', v_antes) end,
    p_despues => jsonb_build_object('planeada', v_cant, 'forzado', v_forzar and v_ev.estado = 'activo'),
    p_motivo => p_args->>'motivo', p_args => p_args - 'pin', p_idem => p_idem);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true));
end $$;

create or replace function public.cambiar_estado_evento(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_ev public.eventos;
  v_nuevo text := p_args->>'estado';
  v_forzar boolean := coalesce((p_args->>'forzar')::boolean, false);
  v_motivo text := public._txt(p_args, 'motivo');
  v_pend jsonb;
  v_faltan jsonb;
  v_hay_pend boolean;
  r record;
begin
  select * into v_ev from public.eventos where id = (p_args->>'evento_id')::uuid;
  if not found then
    return public._negado('cambiar_estado_evento', p_args - 'pin', p_idem, 'Evento no encontrado');
  end if;

  -- Permisos según la transición
  if not (public._es_admin()
          or (v_ev.estado = 'activo' and v_nuevo = 'recogida' and public._tiene(array['recogidas']))) then
    return public._negado('cambiar_estado_evento', p_args - 'pin', p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'cambiar_estado_evento');
  if v_res is not null then return v_res; end if;

  select * into v_ev from public.eventos where id = v_ev.id for update;

  if not ((v_ev.estado, v_nuevo) in (('borrador','activo'), ('activo','borrador'), ('activo','recogida'),
                                     ('recogida','activo'), ('recogida','cerrado'), ('cerrado','recogida'),
                                     ('borrador','cerrado'))) then
    return public._fallar(p_idem, 'cambiar_estado_evento', p_args - 'pin',
      format('No se puede pasar de "%s" a "%s"', v_ev.estado, v_nuevo), 'transicion_invalida', p_evento => v_ev.id);
  end if;

  if v_nuevo = 'activo' and v_ev.estado = 'borrador' then
    -- Validar reservas con bloqueo de cada artículo (orden fijo para evitar bloqueos cruzados)
    v_faltan := '[]'::jsonb;
    for r in select ei.*, v.nombre, v.existencia
             from public.evento_items ei join public.variantes v on v.id = ei.variante_id
             where ei.evento_id = v_ev.id order by ei.variante_id loop
      perform 1 from public.variantes where id = r.variante_id for update;
      if r.cantidad_planeada - r.entregada > r.existencia - public._reservado(r.variante_id, v_ev.id) then
        v_faltan := v_faltan || jsonb_build_object('variante_id', r.variante_id, 'nombre', r.nombre,
          'planeada', r.cantidad_planeada,
          'disponible', greatest(0, r.existencia - public._reservado(r.variante_id, v_ev.id)));
      end if;
    end loop;
    if jsonb_array_length(v_faltan) > 0 then
      if not v_forzar then
        return public._fallar(p_idem, 'cambiar_estado_evento', p_args - 'pin',
          'No hay suficiente disponible para algunos artículos', 'sin_disponible',
          jsonb_build_object('articulos', v_faltan), v_ev.id);
      elsif v_motivo is null or not public._pin_ok(p_args->>'pin') then
        return public._fallar(p_idem, 'cambiar_estado_evento', p_args - 'pin',
          'Para activar sin disponible suficiente se requiere motivo y PIN', 'requiere_autorizacion', p_evento => v_ev.id);
      end if;
    end if;
  end if;

  if (v_ev.estado = 'activo' and v_nuevo = 'borrador') or (v_ev.estado = 'borrador' and v_nuevo = 'cerrado') then
    if exists (select 1 from public.movimientos where evento_id = v_ev.id) then
      return public._fallar(p_idem, 'cambiar_estado_evento', p_args - 'pin',
        'El evento ya tiene movimientos registrados', 'tiene_movimientos', p_evento => v_ev.id);
    end if;
  end if;

  if v_nuevo = 'cerrado' and v_ev.estado = 'recogida' then
    v_pend := public._pendientes_evento(v_ev.id);
    v_hay_pend := not v_ev.conteo_terminado
                  or (v_pend->>'incidencias_abiertas')::int > 0 or (v_pend->>'por_recoger')::int > 0
                  or (v_pend->>'sobrante_sin_revisar')::int > 0 or (v_pend->>'danado_sin_revisar')::int > 0;
    if v_hay_pend then
      if not v_forzar then
        return public._fallar(p_idem, 'cambiar_estado_evento', p_args - 'pin',
          case when not v_ev.conteo_terminado then 'Primero hay que terminar el conteo de recogida'
               else 'El evento tiene diferencias sin resolver' end,
          'diferencias_pendientes', jsonb_build_object('pendientes', v_pend), v_ev.id);
      elsif v_motivo is null or not public._pin_ok(p_args->>'pin') then
        return public._fallar(p_idem, 'cambiar_estado_evento', p_args - 'pin',
          'Para cerrar con diferencias se requiere motivo y PIN', 'requiere_autorizacion', p_evento => v_ev.id);
      end if;
    end if;
  end if;

  if v_ev.estado = 'cerrado' and v_nuevo = 'recogida' then
    if v_motivo is null or not public._pin_ok(p_args->>'pin') then
      return public._fallar(p_idem, 'cambiar_estado_evento', p_args - 'pin',
        'Para reabrir se requiere motivo y PIN', 'requiere_autorizacion', p_evento => v_ev.id);
    end if;
  end if;

  update public.eventos set
    estado = v_nuevo,
    updated_at = now(),
    cerrado_por = case when v_nuevo = 'cerrado' then auth.uid() else null end,
    cerrado_at = case when v_nuevo = 'cerrado' then now() else null end,
    cierre_forzado = case when v_nuevo = 'cerrado' then coalesce(v_hay_pend, false) else false end
  where id = v_ev.id;

  perform public._auditar(
    p_accion => case when v_ev.estado = 'cerrado' then 'reabrir_evento'
                     when v_nuevo = 'cerrado' then 'cerrar_evento'
                     else 'cambiar_estado_evento' end,
    p_entidad => 'evento', p_entidad_id => v_ev.id, p_evento => v_ev.id,
    p_antes => jsonb_build_object('estado', v_ev.estado),
    p_despues => jsonb_build_object('estado', v_nuevo, 'forzado', coalesce(v_hay_pend, false) or
                                    (v_faltan is not null and jsonb_array_length(v_faltan) > 0),
                                    'pendientes', v_pend),
    p_motivo => v_motivo, p_args => p_args - 'pin', p_idem => p_idem);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'estado', v_nuevo));
end $$;

-- =====================================================================
-- SALIDAS
-- items: [{"variante_id": "...", "cantidad": 5}, ...]  — todo o nada
-- =====================================================================
create or replace function public.registrar_salida(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_ev public.eventos;
  v_forzar boolean := coalesce((p_args->>'forzar')::boolean, false);
  v_motivo text := public._txt(p_args, 'motivo');
  v_problemas jsonb := '[]'::jsonb;
  v_lote jsonb;
  v_n integer := 0;
  r record;
  v_disp integer;
  v_exist integer;
begin
  if not public._tiene(array['salidas']) then
    return public._negado('registrar_salida', p_args - 'pin', p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'registrar_salida');
  if v_res is not null then return v_res; end if;

  select * into v_ev from public.eventos where id = (p_args->>'evento_id')::uuid for share;
  if not found or v_ev.estado <> 'activo' then
    return public._fallar(p_idem, 'registrar_salida', p_args - 'pin',
      'Solo se registran salidas en eventos activos', 'estado_invalido', p_evento => v_ev.id);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('variante_id', vid, 'cantidad', cant)), '[]'::jsonb) into v_lote
  from (select (x->>'variante_id')::uuid vid, sum((x->>'cantidad')::integer)::integer cant
        from jsonb_array_elements(coalesce(p_args->'items','[]'::jsonb)) x group by 1) q;

  if jsonb_array_length(v_lote) = 0
     or exists (select 1 from jsonb_to_recordset(v_lote) l(variante_id uuid, cantidad integer)
                where cantidad is null or cantidad <= 0 or variante_id is null) then
    return public._fallar(p_idem, 'registrar_salida', p_args - 'pin', 'Cantidades no válidas', 'dato_invalido', p_evento => v_ev.id);
  end if;

  -- Validación con bloqueo (orden fijo de bloqueo)
  for r in select l.*, v.nombre, v.activo
           from jsonb_to_recordset(v_lote) l(variante_id uuid, cantidad integer)
           left join public.variantes v on v.id = l.variante_id
           order by l.variante_id loop
    if r.nombre is null then
      return public._fallar(p_idem, 'registrar_salida', p_args - 'pin', 'Artículo no encontrado', 'no_encontrado', p_evento => v_ev.id);
    end if;
    select existencia into v_exist from public.variantes where id = r.variante_id for update;
    v_disp := v_exist - public._reservado(r.variante_id, v_ev.id);
    if r.cantidad > v_disp then
      v_problemas := v_problemas || jsonb_build_object('variante_id', r.variante_id, 'nombre', r.nombre,
                                                       'solicitado', r.cantidad, 'disponible', greatest(v_disp, 0));
    end if;
  end loop;

  if jsonb_array_length(v_problemas) > 0 then
    if not v_forzar then
      return public._fallar(p_idem, 'registrar_salida', p_args - 'pin',
        'No hay suficiente disponible', 'sin_disponible', jsonb_build_object('articulos', v_problemas), v_ev.id);
    end if;
    if not public._es_admin() then
      return public._fallar(p_idem, 'registrar_salida', p_args - 'pin',
        'Solo un administrador puede autorizar una salida mayor a lo disponible', 'requiere_autorizacion', p_evento => v_ev.id);
    end if;
    if v_motivo is null or not public._pin_ok(p_args->>'pin') then
      return public._fallar(p_idem, 'registrar_salida', p_args - 'pin',
        'Para una salida excepcional se requiere motivo y PIN', 'requiere_autorizacion', p_evento => v_ev.id);
    end if;
  end if;

  -- Escritura
  for r in select * from jsonb_to_recordset(v_lote) l(variante_id uuid, cantidad integer) order by variante_id loop
    insert into public.evento_items (evento_id, variante_id, cantidad_planeada, entregada)
    values (v_ev.id, r.variante_id, 0, r.cantidad)
    on conflict (evento_id, variante_id) do update
      set entregada = public.evento_items.entregada + excluded.entregada, updated_at = now();

    update public.variantes set existencia = existencia - r.cantidad, updated_at = now()
     where id = r.variante_id returning existencia into v_exist;

    insert into public.movimientos (operacion_id, tipo, variante_id, evento_id, cantidad, efecto_existencia,
                                    forzado, motivo, usuario_id, dispositivo, hora_local)
    values (p_idem, 'salida', r.variante_id, v_ev.id, r.cantidad, -r.cantidad,
            v_problemas @> jsonb_build_array(jsonb_build_object('variante_id', r.variante_id)),
            v_motivo, auth.uid(), p_args->>'dispositivo', nullif(p_args->>'hora_local','')::timestamptz);

    perform public._auditar(p_accion => 'registrar_salida', p_entidad => 'movimiento',
      p_evento => v_ev.id, p_variante => r.variante_id,
      p_antes => jsonb_build_object('existencia', v_exist + r.cantidad),
      p_despues => jsonb_build_object('existencia', v_exist, 'cantidad', r.cantidad,
        'forzado', v_problemas @> jsonb_build_array(jsonb_build_object('variante_id', r.variante_id))),
      p_motivo => v_motivo, p_args => p_args - 'pin' - 'items', p_idem => p_idem);
    v_n := v_n + 1;
  end loop;

  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'articulos', v_n,
                                                     'forzado', jsonb_array_length(v_problemas) > 0));
end $$;

-- =====================================================================
-- RECOGIDAS
-- items: [{"variante_id": "...", "cantidad": 3, "condicion": "buena"|"danada"}]
-- La cantidad contada NUNCA se recorta a lo entregado.
-- =====================================================================
create or replace function public.registrar_recogida(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_ev public.eventos;
  r record;
  v_lote jsonb;
  v_n integer := 0;
  v_exist integer;
begin
  if not public._tiene(array['recogidas']) then
    return public._negado('registrar_recogida', p_args, p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'registrar_recogida');
  if v_res is not null then return v_res; end if;

  select * into v_ev from public.eventos where id = (p_args->>'evento_id')::uuid for share;
  if not found or v_ev.estado not in ('activo','recogida') then
    return public._fallar(p_idem, 'registrar_recogida', p_args,
      'Solo se registran recogidas en eventos activos o en recogida', 'estado_invalido', p_evento => v_ev.id);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('variante_id', vid, 'condicion', cond, 'cantidad', cant)), '[]'::jsonb)
    into v_lote
  from (select (x->>'variante_id')::uuid vid, coalesce(nullif(x->>'condicion',''), 'buena') cond,
               sum((x->>'cantidad')::integer)::integer cant
        from jsonb_array_elements(coalesce(p_args->'items','[]'::jsonb)) x group by 1, 2) q;

  if jsonb_array_length(v_lote) = 0
     or exists (select 1 from jsonb_to_recordset(v_lote) l(variante_id uuid, condicion text, cantidad integer)
                where variante_id is null or cantidad is null or cantidad <= 0 or condicion not in ('buena','danada')) then
    return public._fallar(p_idem, 'registrar_recogida', p_args, 'Cantidades no válidas', 'dato_invalido', p_evento => v_ev.id);
  end if;
  if exists (select 1 from jsonb_to_recordset(v_lote) l(variante_id uuid, condicion text, cantidad integer)
             left join public.variantes v on v.id = l.variante_id where v.id is null) then
    return public._fallar(p_idem, 'registrar_recogida', p_args, 'Artículo no encontrado', 'no_encontrado', p_evento => v_ev.id);
  end if;

  for r in select * from jsonb_to_recordset(v_lote) l(variante_id uuid, condicion text, cantidad integer)
           order by variante_id, condicion loop
    perform 1 from public.variantes where id = r.variante_id for update;

    insert into public.evento_items (evento_id, variante_id, cantidad_planeada, regresada, danada)
    values (v_ev.id, r.variante_id, 0, r.cantidad, case when r.condicion = 'danada' then r.cantidad else 0 end)
    on conflict (evento_id, variante_id) do update
      set regresada = public.evento_items.regresada + excluded.regresada,
          danada = public.evento_items.danada + excluded.danada,
          updated_at = now();

    update public.variantes set existencia = existencia + r.cantidad, updated_at = now()
     where id = r.variante_id returning existencia into v_exist;

    insert into public.movimientos (operacion_id, tipo, variante_id, evento_id, cantidad, efecto_existencia,
                                    condicion, usuario_id, dispositivo, hora_local, motivo)
    values (p_idem, 'devolucion', r.variante_id, v_ev.id, r.cantidad, r.cantidad, r.condicion,
            auth.uid(), p_args->>'dispositivo', nullif(p_args->>'hora_local','')::timestamptz,
            public._txt(p_args, 'notas'));

    perform public._recalcular(v_ev.id, r.variante_id);

    perform public._auditar(p_accion => 'registrar_recogida', p_entidad => 'movimiento',
      p_evento => v_ev.id, p_variante => r.variante_id,
      p_antes => jsonb_build_object('existencia', v_exist - r.cantidad),
      p_despues => jsonb_build_object('existencia', v_exist, 'cantidad', r.cantidad, 'condicion', r.condicion),
      p_args => p_args - 'items', p_idem => p_idem);
    v_n := v_n + 1;
  end loop;

  return public._idem_fin(p_idem, jsonb_build_object('ok', true, 'registros', v_n));
end $$;

-- Terminar conteo: genera las incidencias de faltantes, sobrantes y daños.
create or replace function public.terminar_conteo(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_ev public.eventos;
  r record;
begin
  if not public._tiene(array['recogidas']) then
    return public._negado('terminar_conteo', p_args, p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'terminar_conteo');
  if v_res is not null then return v_res; end if;

  select * into v_ev from public.eventos where id = (p_args->>'evento_id')::uuid for update;
  if not found or v_ev.estado <> 'recogida' then
    return public._fallar(p_idem, 'terminar_conteo', p_args,
      'El evento debe estar en recogida', 'estado_invalido', p_evento => v_ev.id);
  end if;

  update public.eventos set conteo_terminado = true, updated_at = now() where id = v_ev.id;
  for r in select variante_id from public.evento_items where evento_id = v_ev.id loop
    perform public._recalcular(v_ev.id, r.variante_id);
  end loop;

  perform public._auditar(p_accion => 'terminar_conteo', p_entidad => 'evento', p_entidad_id => v_ev.id,
    p_evento => v_ev.id, p_despues => public._pendientes_evento(v_ev.id), p_args => p_args, p_idem => p_idem);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true) || public._pendientes_evento(v_ev.id));
end $$;

-- =====================================================================
-- CORRECCIONES
-- =====================================================================
-- Revierte una salida o recogida registrada por error. No borra nada:
-- crea un movimiento compensatorio.
create or replace function public.revertir_movimiento(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  m public.movimientos;
  v_ev public.eventos;
  it public.evento_items;
  v_exist integer;
  v_motivo text := public._txt(p_args, 'motivo');
begin
  select * into m from public.movimientos where id = (p_args->>'movimiento_id')::uuid;
  if not found then
    return public._negado('revertir_movimiento', p_args, p_idem, 'Movimiento no encontrado');
  end if;
  if not (public._es_admin()
          or (m.usuario_id = auth.uid() and m.tipo = 'salida' and public._tiene(array['salidas']))
          or (m.usuario_id = auth.uid() and m.tipo = 'devolucion' and public._tiene(array['recogidas']))) then
    return public._negado('revertir_movimiento', p_args, p_idem,
      'Solo puedes corregir tus propios registros (o un administrador)');
  end if;
  v_res := public._idem_inicio(p_idem, 'revertir_movimiento');
  if v_res is not null then return v_res; end if;

  if m.tipo not in ('salida','devolucion') then
    return public._fallar(p_idem, 'revertir_movimiento', p_args, 'Solo se pueden revertir salidas y recogidas', 'tipo_invalido');
  end if;
  if v_motivo is null then
    return public._fallar(p_idem, 'revertir_movimiento', p_args, 'El motivo es obligatorio', 'falta_motivo');
  end if;
  if exists (select 1 from public.movimientos where revierte_a = m.id) then
    return public._fallar(p_idem, 'revertir_movimiento', p_args, 'Este movimiento ya fue revertido', 'ya_revertido');
  end if;
  select * into v_ev from public.eventos where id = m.evento_id for share;
  if v_ev.estado = 'cerrado' then
    return public._fallar(p_idem, 'revertir_movimiento', p_args, 'El evento está cerrado', 'evento_cerrado', p_evento => v_ev.id);
  end if;

  select existencia into v_exist from public.variantes where id = m.variante_id for update;
  select * into it from public.evento_items where evento_id = m.evento_id and variante_id = m.variante_id for update;

  if m.tipo = 'salida' then
    if it.entregada < m.cantidad then
      return public._fallar(p_idem, 'revertir_movimiento', p_args, 'Las cantidades del evento ya no permiten esta reversión', 'no_reversible', p_evento => v_ev.id);
    end if;
    update public.evento_items set entregada = entregada - m.cantidad, updated_at = now() where id = it.id;
  else
    if it.regresada < m.cantidad
       or (m.condicion = 'danada' and it.danada < m.cantidad)
       or (m.condicion = 'buena' and (it.regresada - it.danada) < m.cantidad)
       or v_exist < m.cantidad then
      return public._fallar(p_idem, 'revertir_movimiento', p_args,
        'Las cantidades actuales ya no permiten esta reversión (revisa transferencias o existencia)', 'no_reversible', p_evento => v_ev.id);
    end if;
    update public.evento_items
       set regresada = regresada - m.cantidad,
           danada = danada - case when m.condicion = 'danada' then m.cantidad else 0 end,
           updated_at = now()
     where id = it.id;
  end if;

  update public.variantes set existencia = existencia - m.efecto_existencia, updated_at = now() where id = m.variante_id;

  insert into public.movimientos (operacion_id, tipo, variante_id, evento_id, cantidad, efecto_existencia,
                                  condicion, motivo, revierte_a, usuario_id, dispositivo, hora_local)
  values (p_idem, 'reversion', m.variante_id, m.evento_id, m.cantidad, -m.efecto_existencia, m.condicion,
          v_motivo, m.id, auth.uid(), p_args->>'dispositivo', nullif(p_args->>'hora_local','')::timestamptz);

  perform public._recalcular(m.evento_id, m.variante_id);

  perform public._auditar(p_accion => 'revertir_' || m.tipo, p_entidad => 'movimiento', p_entidad_id => m.id,
    p_evento => m.evento_id, p_variante => m.variante_id,
    p_antes => jsonb_build_object('existencia', v_exist),
    p_despues => jsonb_build_object('existencia', v_exist - m.efecto_existencia, 'cantidad', m.cantidad,
                                    'registrado_por', m.usuario_id, 'registrado_el', m.created_at),
    p_motivo => v_motivo, p_args => p_args, p_idem => p_idem);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true));
end $$;

-- Material contado en un evento que en realidad pertenece a otro.
create or replace function public.transferir_entre_eventos(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  v_origen public.eventos;
  v_destino public.eventos;
  v_var uuid := (p_args->>'variante_id')::uuid;
  v_cant integer := (p_args->>'cantidad')::integer;
  v_motivo text := public._txt(p_args, 'motivo');
  it public.evento_items;
begin
  if not public._es_admin() then
    return public._negado('transferir_entre_eventos', p_args - 'pin', p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'transferir_entre_eventos');
  if v_res is not null then return v_res; end if;

  select * into v_origen from public.eventos where id = (p_args->>'origen_id')::uuid for share;
  select * into v_destino from public.eventos where id = (p_args->>'destino_id')::uuid for share;
  if v_origen.id is null or v_destino.id is null or v_origen.id = v_destino.id
     or v_origen.estado = 'cerrado' or v_destino.estado = 'cerrado' then
    return public._fallar(p_idem, 'transferir_entre_eventos', p_args - 'pin',
      'Elige dos eventos distintos que no estén cerrados', 'dato_invalido');
  end if;
  if v_cant is null or v_cant <= 0 or v_motivo is null then
    return public._fallar(p_idem, 'transferir_entre_eventos', p_args - 'pin', 'Cantidad y motivo son obligatorios', 'dato_invalido');
  end if;
  if not public._pin_ok(p_args->>'pin') then
    return public._fallar(p_idem, 'transferir_entre_eventos', p_args - 'pin', 'PIN incorrecto', 'pin_incorrecto');
  end if;

  perform 1 from public.variantes where id = v_var for update;
  select * into it from public.evento_items where evento_id = v_origen.id and variante_id = v_var for update;
  if it.id is null or (it.regresada - it.danada) < v_cant then
    return public._fallar(p_idem, 'transferir_entre_eventos', p_args - 'pin',
      format('El evento de origen solo tiene %s unidades contadas en buen estado', coalesce(it.regresada - it.danada, 0)),
      'sin_cantidad', p_evento => v_origen.id, p_variante => v_var);
  end if;

  update public.evento_items set regresada = regresada - v_cant, updated_at = now() where id = it.id;
  insert into public.evento_items (evento_id, variante_id, cantidad_planeada, regresada)
  values (v_destino.id, v_var, 0, v_cant)
  on conflict (evento_id, variante_id) do update
    set regresada = public.evento_items.regresada + excluded.regresada, updated_at = now();

  insert into public.movimientos (operacion_id, tipo, variante_id, evento_id, cantidad, efecto_existencia, motivo, usuario_id, dispositivo)
  values (p_idem, 'transferencia', v_var, v_origen.id, -v_cant, 0, v_motivo, auth.uid(), p_args->>'dispositivo'),
         (p_idem, 'transferencia', v_var, v_destino.id, v_cant, 0, v_motivo, auth.uid(), p_args->>'dispositivo');

  perform public._recalcular(v_origen.id, v_var);
  perform public._recalcular(v_destino.id, v_var);

  perform public._auditar(p_accion => 'transferir_entre_eventos', p_entidad => 'variante', p_entidad_id => v_var,
    p_evento => v_origen.id, p_variante => v_var,
    p_despues => jsonb_build_object('origen', v_origen.nombre, 'destino', v_destino.nombre,
                                    'destino_id', v_destino.id, 'cantidad', v_cant),
    p_motivo => v_motivo, p_args => p_args - 'pin', p_idem => p_idem);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true));
end $$;

-- =====================================================================
-- CONCILIACIÓN
-- estado: 'pendiente' | 'investigacion' (recogidas o admin: actualizar motivo/notas)
--         'aprobada' | 'rechazada'      (solo admin, con PIN para aprobar)
-- Al aprobar:
--   faltante → se da de baja como pérdida (no cambia existencia de almacén)
--   sobrante → se acepta (las unidades ya están en almacén)
--   daño     → se revisa; con "retirar": true se descuenta de la existencia
-- =====================================================================
create or replace function public.resolver_incidencia(p_idem uuid, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
  inc public.incidencias;
  it public.evento_items;
  v_estado text := p_args->>'estado';
  v_motivo text := coalesce(public._txt(p_args,'motivo'), 'pendiente de investigar');
  v_retirar boolean := coalesce((p_args->>'retirar')::boolean, false);
  v_actual integer;
  v_accion text;
  v_exist integer;
begin
  select * into inc from public.incidencias where id = (p_args->>'incidencia_id')::uuid;
  if not found then
    return public._negado('resolver_incidencia', p_args - 'pin', p_idem, 'Incidencia no encontrada');
  end if;
  if v_estado in ('aprobada','rechazada') and not public._es_admin() then
    return public._negado('resolver_incidencia', p_args - 'pin', p_idem, 'Solo un administrador aprueba o rechaza diferencias');
  end if;
  if v_estado in ('pendiente','investigacion') and not public._tiene(array['recogidas']) then
    return public._negado('resolver_incidencia', p_args - 'pin', p_idem);
  end if;
  v_res := public._idem_inicio(p_idem, 'resolver_incidencia');
  if v_res is not null then return v_res; end if;

  select * into inc from public.incidencias where id = inc.id for update;
  if inc.estado not in ('pendiente','investigacion') then
    return public._fallar(p_idem, 'resolver_incidencia', p_args - 'pin', 'La incidencia ya fue cerrada', 'ya_cerrada', p_evento => inc.evento_id);
  end if;
  if v_estado not in ('pendiente','investigacion','aprobada','rechazada') then
    return public._fallar(p_idem, 'resolver_incidencia', p_args - 'pin', 'Estado no válido', 'dato_invalido');
  end if;
  if v_motivo not in ('pendiente de investigar','pérdida confirmada','daño','préstamo','material de otro evento',
                      'error de captura','sobrante encontrado','otro') then
    return public._fallar(p_idem, 'resolver_incidencia', p_args - 'pin', 'Motivo no válido', 'dato_invalido');
  end if;
  if (select estado from public.eventos where id = inc.evento_id) = 'cerrado' then
    return public._fallar(p_idem, 'resolver_incidencia', p_args - 'pin', 'El evento está cerrado', 'evento_cerrado', p_evento => inc.evento_id);
  end if;

  if v_estado = 'aprobada' then
    if not public._pin_ok(p_args->>'pin') then
      return public._fallar(p_idem, 'resolver_incidencia', p_args - 'pin', 'PIN incorrecto', 'pin_incorrecto', p_evento => inc.evento_id);
    end if;
    select existencia into v_exist from public.variantes where id = inc.variante_id for update;
    select * into it from public.evento_items where evento_id = inc.evento_id and variante_id = inc.variante_id for update;
    v_actual := case inc.tipo
                  when 'faltante' then greatest(0, it.entregada - it.regresada - it.baja)
                  when 'sobrante' then greatest(0, it.regresada - it.entregada - it.sobrante_aceptado)
                  else greatest(0, it.danada - it.danado_revisado) end;
    if v_actual <> inc.cantidad then
      return public._fallar(p_idem, 'resolver_incidencia', p_args - 'pin',
        'Las cantidades cambiaron desde que se generó la incidencia; actualiza la pantalla', 'desactualizada', p_evento => inc.evento_id);
    end if;

    if inc.tipo = 'faltante' then
      update public.evento_items set baja = baja + inc.cantidad, updated_at = now() where id = it.id;
      insert into public.movimientos (operacion_id, tipo, variante_id, evento_id, cantidad, efecto_existencia, motivo, usuario_id, dispositivo)
      values (p_idem, 'baja', inc.variante_id, inc.evento_id, inc.cantidad, 0, v_motivo, auth.uid(), p_args->>'dispositivo');
      v_accion := format('Baja de %s unidad(es) como %s', inc.cantidad, v_motivo);
    elsif inc.tipo = 'sobrante' then
      update public.evento_items set sobrante_aceptado = sobrante_aceptado + inc.cantidad, updated_at = now() where id = it.id;
      v_accion := format('Sobrante de %s aceptado (%s)', inc.cantidad, v_motivo);
    else
      update public.evento_items set danado_revisado = danado_revisado + inc.cantidad, updated_at = now() where id = it.id;
      if v_retirar then
        if v_exist < inc.cantidad then
          return public._fallar(p_idem, 'resolver_incidencia', p_args - 'pin',
            'No hay suficiente existencia para retirar', 'existencia_negativa', p_evento => inc.evento_id);
        end if;
        update public.variantes set existencia = existencia - inc.cantidad, updated_at = now() where id = inc.variante_id;
        insert into public.movimientos (operacion_id, tipo, variante_id, evento_id, cantidad, efecto_existencia, motivo, usuario_id, dispositivo)
        values (p_idem, 'retiro_dano', inc.variante_id, inc.evento_id, inc.cantidad, -inc.cantidad, v_motivo, auth.uid(), p_args->>'dispositivo');
        v_accion := format('%s unidad(es) dañada(s) retirada(s) del inventario', inc.cantidad);
      else
        v_accion := format('%s unidad(es) dañada(s) revisada(s), se conservan en inventario', inc.cantidad);
      end if;
    end if;
  elsif v_estado = 'rechazada' then
    v_accion := 'Rechazada: corregir el conteo';
  end if;

  update public.incidencias set
    estado = v_estado, motivo = v_motivo,
    notas = coalesce(public._txt(p_args,'notas'), notas),
    accion = coalesce(v_accion, accion),
    revisado_por = case when v_estado in ('aprobada','rechazada') then auth.uid() else revisado_por end,
    revisado_at = case when v_estado in ('aprobada','rechazada') then now() else revisado_at end,
    updated_at = now()
  where id = inc.id;

  perform public._auditar(p_accion => 'incidencia_' || v_estado, p_entidad => 'incidencia', p_entidad_id => inc.id,
    p_evento => inc.evento_id, p_variante => inc.variante_id,
    p_antes => jsonb_build_object('estado', inc.estado, 'motivo', inc.motivo),
    p_despues => jsonb_build_object('estado', v_estado, 'motivo', v_motivo, 'tipo', inc.tipo,
                                    'cantidad', inc.cantidad, 'accion', v_accion),
    p_motivo => v_motivo, p_detalle => public._txt(p_args,'notas'), p_args => p_args - 'pin', p_idem => p_idem);
  return public._idem_fin(p_idem, jsonb_build_object('ok', true));
end $$;

-- =====================================================================
-- VERIFICACIÓN: reconstruye saldos desde el historial y los compara.
-- Debe devolver cero filas. (Solo administrador)
-- =====================================================================
create or replace function public.verificar_saldos() returns table (
  variante_id uuid, nombre text, existencia_guardada integer, existencia_historial integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.id, v.nombre, v.existencia, coalesce(sum(m.efecto_existencia), 0)::integer
  from public.variantes v left join public.movimientos m on m.variante_id = v.id
  where public._es_admin()
  group by v.id
  having v.existencia <> coalesce(sum(m.efecto_existencia), 0)
$$;
