-- =====================================================================
-- Pruebas de aceptación (sección 16 de la especificación)
-- Se corren en una base local con el shim de Supabase. Todas las
-- operaciones se ejecutan con el rol "authenticated", igual que la app.
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;

create schema pruebas;
grant usage on schema pruebas to authenticated;

create function pruebas.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'FALLÓ: %', p_msg; end if;
  raise notice '  ✔ %', p_msg;
end $$;

create table pruebas.usuarios (alias text primary key, id uuid);
grant select on pruebas.usuarios to authenticated;

create function pruebas.como(p_alias text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from pruebas.usuarios where alias = p_alias), false);
$$;

create function pruebas.rpc(p_fn text, p_args jsonb, p_idem uuid default gen_random_uuid()) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  execute format('select public.%I($1, $2)', p_fn) into r using p_idem, p_args;
  return r;
end $$;

create function pruebas.uid(p_alias text) returns uuid language sql as $$
  select id from pruebas.usuarios where alias = p_alias $$;

grant execute on all functions in schema pruebas to authenticated;

-- Usuarios (equivale a que cada persona se registre en la app)
with nuevos as (
  insert into auth.users (email, raw_user_meta_data) values
    ('admin@inv.app', '{"usuario":"admin","nombre":"Administradora"}'),
    ('sal@inv.app',   '{"usuario":"sal","nombre":"Pedro Salidas"}'),
    ('rec@inv.app',   '{"usuario":"rec","nombre":"Rosa Recogidas"}'),
    ('lec@inv.app',   '{"usuario":"lec","nombre":"Luis Lectura"}'),
    ('pend@inv.app',  '{"usuario":"pend","nombre":"Pendiente"}'),
    ('ambos@inv.app', '{"usuario":"ambos","nombre":"Ana Ambos"}')
  returning id, raw_user_meta_data->>'usuario' as alias)
insert into pruebas.usuarios select alias, id from nuevos;

set role authenticated;

-- ---------------------------------------------------------------------
\echo '▶ 0. Usuarios, roles y PIN'
-- ---------------------------------------------------------------------
select pruebas.como('admin');
select pruebas.ok((select roles = '{admin}' and activo from public.perfiles where usuario = 'admin'),
  'El primer usuario registrado queda como administrador activo');
select pruebas.ok((select not activo from public.perfiles where usuario = 'sal'),
  'Los demás usuarios quedan pendientes de aprobación');
select pruebas.ok((pruebas.rpc('establecer_pin', '{"pin_nuevo":"1234"}')->>'ok')::boolean, 'Admin establece su PIN');
select pruebas.ok((pruebas.rpc('actualizar_usuario', jsonb_build_object('usuario_id', pruebas.uid('sal'), 'roles', '["salidas"]'::jsonb, 'activo', true))->>'ok')::boolean, 'Admin aprueba a Pedro como Salidas');
select pruebas.ok((pruebas.rpc('actualizar_usuario', jsonb_build_object('usuario_id', pruebas.uid('rec'), 'roles', '["recogidas"]'::jsonb, 'activo', true))->>'ok')::boolean, 'Admin aprueba a Rosa como Recogidas');
select pruebas.ok((pruebas.rpc('actualizar_usuario', jsonb_build_object('usuario_id', pruebas.uid('lec'), 'roles', '["lectura"]'::jsonb, 'activo', true))->>'ok')::boolean, 'Admin aprueba a Luis como Solo lectura');
select pruebas.ok((pruebas.rpc('actualizar_usuario', jsonb_build_object('usuario_id', pruebas.uid('ambos'), 'roles', '["salidas","recogidas"]'::jsonb, 'activo', true))->>'ok')::boolean, 'Una persona puede tener Salidas y Recogidas a la vez');
select pruebas.ok((pruebas.rpc('actualizar_usuario', jsonb_build_object('usuario_id', pruebas.uid('admin'), 'roles', '["lectura"]'::jsonb))->>'codigo') = 'ultimo_admin',
  'No se puede quitar el rol al último administrador');

-- ---------------------------------------------------------------------
\echo '▶ 1. Variantes distinguibles (cable café 25 pies / cable rojo 50 pies)'
-- ---------------------------------------------------------------------
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
insert into ids select 'cafe', (pruebas.rpc('guardar_variante', '{"nombre":"Cable","color_nombre":"Café","color_hex":"#8b4513","medida":25,"unidad_medida":"pies","categoria":"Cables","sku":"CAB-CAF-25","existencia_inicial":20}')->>'id')::uuid;
insert into ids select 'rojo', (pruebas.rpc('guardar_variante', '{"nombre":"Cable","color_nombre":"Rojo","color_hex":"#CC0000","medida":50,"unidad_medida":"pies","categoria":"Cables","sku":"CAB-ROJ-50","existencia_inicial":30}')->>'id')::uuid;
select pruebas.ok((select count(*) = 2 from public.v_inventario where nombre = 'Cable'), 'Existen dos variantes de "Cable"');
select pruebas.ok((select color_nombre = 'Rojo' and medida = 50 from public.v_inventario where sku = 'CAB-ROJ-50'), 'Se distinguen por color y medida');
select pruebas.ok((select count(*) = 1 from public.variantes where to_tsvector('spanish', nombre||' '||coalesce(color_nombre,'')) @@ plainto_tsquery('spanish','cable café')), 'La búsqueda "cable café" encuentra solo la variante café');
select pruebas.ok((select color_hex = '#8B4513' from public.variantes where id = (select id from ids where k='cafe')), 'El color hexadecimal se normaliza');
select pruebas.ok((pruebas.rpc('guardar_variante', '{"nombre":"Otro","sku":"CAB-ROJ-50"}')->>'codigo') = 'sku_duplicado', 'No se permite SKU duplicado');
select pruebas.ok((select existencia = 20 from public.variantes where id = (select id from ids where k='cafe')), 'Existencia inicial registrada (20)');

-- ---------------------------------------------------------------------
\echo '▶ 2 y 3. Dos eventos simultáneos y disponibilidad (20 unidades, 12 a un evento)'
-- ---------------------------------------------------------------------
insert into ids select 'evA', (pruebas.rpc('guardar_evento', '{"nombre":"Boda García","fecha":"2026-11-07"}')->>'id')::uuid;
insert into ids select 'evB', (pruebas.rpc('guardar_evento', '{"nombre":"Expo Norte","fecha":"2026-11-07"}')->>'id')::uuid;
select pruebas.ok((pruebas.rpc('planear_item', jsonb_build_object('evento_id', (select id from ids where k='evA'), 'variante_id', (select id from ids where k='cafe'), 'cantidad', 12))->>'ok')::boolean, 'Evento A planea 12 cables café');
select pruebas.ok((pruebas.rpc('planear_item', jsonb_build_object('evento_id', (select id from ids where k='evA'), 'variante_id', (select id from ids where k='cafe'), 'cantidad', 12))->>'ok')::boolean, 'Agregar el mismo artículo otra vez actualiza (no duplica)');
select pruebas.ok((select count(*) = 1 from public.evento_items where evento_id = (select id from ids where k='evA')), 'El evento A tiene una sola línea del artículo');
select pruebas.ok((pruebas.rpc('cambiar_estado_evento', jsonb_build_object('evento_id', (select id from ids where k='evA'), 'estado', 'activo'))->>'ok')::boolean, 'Evento A pasa a activo (reserva 12)');
select pruebas.ok((select reservado = 12 and disponible = 8 from public.v_inventario where id = (select id from ids where k='cafe')), 'Disponible = 20 − 12 reservadas = 8');
select pruebas.ok((pruebas.rpc('cambiar_estado_evento', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'estado', 'activo'))->>'ok')::boolean, 'Evento B pasa a activo');
select pruebas.ok((pruebas.rpc('planear_item', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'variante_id', (select id from ids where k='cafe'), 'cantidad', 9))->>'codigo') = 'sin_disponible', 'Evento B NO puede reservar 9 (solo hay 8)');
select pruebas.ok((pruebas.rpc('planear_item', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'variante_id', (select id from ids where k='cafe'), 'cantidad', 9, 'forzar', true, 'motivo', 'urgente', 'pin', '0000'))->>'codigo') = 'requiere_autorizacion', 'Forzar con PIN incorrecto se rechaza');
select pruebas.ok((pruebas.rpc('planear_item', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'variante_id', (select id from ids where k='cafe'), 'cantidad', 8))->>'ok')::boolean, 'Evento B sí puede reservar 8');

select pruebas.como('sal');
select pruebas.ok((pruebas.rpc('registrar_salida', jsonb_build_object('evento_id', (select id from ids where k='evA'), 'items', jsonb_build_array(jsonb_build_object('variante_id', (select id from ids where k='cafe'), 'cantidad', 10)), 'dispositivo', 'Celular Pedro'))->>'ok')::boolean, 'Pedro entrega 10 al evento A');
select pruebas.ok((select existencia = 10 from public.variantes where id = (select id from ids where k='cafe')), 'Existencia física baja a 10');
select pruebas.ok((select reservado = 10 and disponible = 0 from public.v_inventario where id = (select id from ids where k='cafe')), 'Reservado = 2 (A) + 8 (B) = 10; disponible 0');
select pruebas.ok((pruebas.rpc('registrar_salida', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'items', jsonb_build_array(jsonb_build_object('variante_id', (select id from ids where k='cafe'), 'cantidad', 9))))->>'codigo') = 'sin_disponible', 'B no puede sacar 9 (su reserva es 8)');
select pruebas.ok((pruebas.rpc('registrar_salida', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'items', jsonb_build_array(jsonb_build_object('variante_id', (select id from ids where k='cafe'), 'cantidad', 9)), 'forzar', true, 'motivo', 'x'))->>'codigo') = 'requiere_autorizacion', 'Salidas no puede forzar: solo el administrador');
select pruebas.ok((pruebas.rpc('registrar_salida', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'items', jsonb_build_array(
    jsonb_build_object('variante_id', (select id from ids where k='cafe'), 'cantidad', 8),
    jsonb_build_object('variante_id', (select id from ids where k='rojo'), 'cantidad', 31))))->>'codigo') = 'sin_disponible', 'Lote con un artículo sin disponible se rechaza completo');
select pruebas.ok((select existencia = 10 from public.variantes where id = (select id from ids where k='cafe')), '…y no se descontó nada del lote rechazado (todo o nada)');
select pruebas.ok((pruebas.rpc('registrar_salida', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'items', jsonb_build_array(jsonb_build_object('variante_id', (select id from ids where k='cafe'), 'cantidad', 8))))->>'ok')::boolean, 'B saca sus 8');
select pruebas.ok((select count(*) = 1 from public.movimientos where evento_id = (select id from ids where k='evA')) and
                  (select count(*) = 1 from public.movimientos where evento_id = (select id from ids where k='evB')), 'Los movimientos de A y B no se mezclan');

-- ---------------------------------------------------------------------
\echo '▶ 8. Idempotencia: la misma operación enviada dos veces'
-- ---------------------------------------------------------------------
select pruebas.como('admin');
select pruebas.rpc('cambiar_estado_evento', jsonb_build_object('evento_id', (select id from ids where k='evA'), 'estado', 'recogida'));
select pruebas.como('rec');
insert into ids values ('idem1', gen_random_uuid());
create temp table r1 as select pruebas.rpc('registrar_recogida', jsonb_build_object('evento_id', (select id from ids where k='evA'), 'items', jsonb_build_array(jsonb_build_object('variante_id', (select id from ids where k='cafe'), 'cantidad', 5)), 'dispositivo', 'Celular Rosa'), (select id from ids where k='idem1')) r;
create temp table r2 as select pruebas.rpc('registrar_recogida', jsonb_build_object('evento_id', (select id from ids where k='evA'), 'items', jsonb_build_array(jsonb_build_object('variante_id', (select id from ids where k='cafe'), 'cantidad', 5)), 'dispositivo', 'Celular Rosa'), (select id from ids where k='idem1')) r;
select pruebas.ok((select (r->>'repetida')::boolean from r2), 'El segundo envío se reconoce como repetido');
select pruebas.ok((select count(*) = 1 from public.movimientos where operacion_id = (select id from ids where k='idem1')), 'Solo existe un movimiento');
select pruebas.ok((select regresada = 5 from public.evento_items where evento_id = (select id from ids where k='evA')), 'El conteo es 5, no 10');
select pruebas.ok((select existencia = 7 from public.variantes where id = (select id from ids where k='cafe')), 'Existencia 2 + 5 = 7 (sin duplicar)');

-- ---------------------------------------------------------------------
\echo '▶ 4 y 5. Recogidas parciales desde dos dispositivos; entregar 10 y contar 8'
-- ---------------------------------------------------------------------
select pruebas.como('ambos');
select pruebas.ok((pruebas.rpc('registrar_recogida', jsonb_build_object('evento_id', (select id from ids where k='evA'), 'items', jsonb_build_array(jsonb_build_object('variante_id', (select id from ids where k='cafe'), 'cantidad', 3)), 'dispositivo', 'Celular Ana'))->>'ok')::boolean, 'Ana registra 3 más desde otro celular');
select pruebas.ok((select regresada = 8 and entregada = 10 from public.evento_items where evento_id = (select id from ids where k='evA')), 'Total contado 8 de 10 entregados');
select pruebas.ok((select estado_conciliacion = 'parcial' and por_recoger = 2 from public.v_evento_items where evento_id = (select id from ids where k='evA')), 'Antes de terminar el conteo: parcial, faltan 2 por recoger');
select pruebas.ok((pruebas.rpc('terminar_conteo', jsonb_build_object('evento_id', (select id from ids where k='evA')))->>'ok')::boolean, 'Se termina el conteo');
select pruebas.ok((select count(*) = 1 and min(cantidad) = 2 and min(diferencia) = -2 from public.incidencias where evento_id = (select id from ids where k='evA') and tipo = 'faltante' and estado = 'pendiente'), 'Se genera incidencia de FALTANTE de 2 (diferencia −2)');
select pruebas.ok((select count(*) = 1 from public.movimientos where evento_id = (select id from ids where k='evA') and tipo = 'salida'), 'El registro de salida original sigue intacto');

-- ---------------------------------------------------------------------
\echo '▶ 6. Entregar 10 y contar 12 → sobrante 2 (sin recortar)'
-- ---------------------------------------------------------------------
select pruebas.como('admin');
insert into ids select 'evC', (pruebas.rpc('guardar_evento', '{"nombre":"Concierto","fecha":"2026-11-14"}')->>'id')::uuid;
select pruebas.rpc('planear_item', jsonb_build_object('evento_id', (select id from ids where k='evC'), 'variante_id', (select id from ids where k='rojo'), 'cantidad', 10));
select pruebas.rpc('cambiar_estado_evento', jsonb_build_object('evento_id', (select id from ids where k='evC'), 'estado', 'activo'));
select pruebas.como('sal');
select pruebas.rpc('registrar_salida', jsonb_build_object('evento_id', (select id from ids where k='evC'), 'items', jsonb_build_array(jsonb_build_object('variante_id', (select id from ids where k='rojo'), 'cantidad', 10))));
select pruebas.como('rec');
select pruebas.ok((pruebas.rpc('cambiar_estado_evento', jsonb_build_object('evento_id', (select id from ids where k='evC'), 'estado', 'recogida'))->>'ok')::boolean, 'Recogidas puede pasar el evento a recogida');
select pruebas.rpc('registrar_recogida', jsonb_build_object('evento_id', (select id from ids where k='evC'), 'items', jsonb_build_array(jsonb_build_object('variante_id', (select id from ids where k='rojo'), 'cantidad', 11), jsonb_build_object('variante_id', (select id from ids where k='rojo'), 'cantidad', 1, 'condicion', 'danada'))));
select pruebas.ok((select regresada = 12 and danada = 1 from public.evento_items where evento_id = (select id from ids where k='evC')), 'Se registran 12 contadas (1 dañada), no se limita a 10');
select pruebas.ok((select existencia = 32 from public.variantes where id = (select id from ids where k='rojo')), 'Existencia física 30 − 10 + 12 = 32');
select pruebas.rpc('terminar_conteo', jsonb_build_object('evento_id', (select id from ids where k='evC')));
select pruebas.ok((select cantidad = 2 and diferencia = 2 from public.incidencias where evento_id = (select id from ids where k='evC') and tipo = 'sobrante' and estado = 'pendiente'), 'Incidencia de SOBRANTE de 2');

-- ---------------------------------------------------------------------
\echo '▶ 7. Daño: incidencia + ajuste solo con autorización'
-- ---------------------------------------------------------------------
select pruebas.ok((select cantidad = 1 from public.incidencias where evento_id = (select id from ids where k='evC') and tipo = 'dano' and estado = 'pendiente'), 'Incidencia de DAÑO de 1');
insert into ids select 'incDano', id from public.incidencias where evento_id = (select id from ids where k='evC') and tipo = 'dano';
select pruebas.ok((pruebas.rpc('resolver_incidencia', jsonb_build_object('incidencia_id', (select id from ids where k='incDano'), 'estado', 'investigacion', 'notas', 'Conector roto'))->>'ok')::boolean, 'Recogidas puede poner la incidencia en investigación con notas');
select pruebas.ok((pruebas.rpc('resolver_incidencia', jsonb_build_object('incidencia_id', (select id from ids where k='incDano'), 'estado', 'aprobada', 'retirar', true))->>'codigo') = 'sin_permiso', 'Recogidas NO puede aprobar el ajuste');
select pruebas.como('admin');
select pruebas.ok((pruebas.rpc('resolver_incidencia', jsonb_build_object('incidencia_id', (select id from ids where k='incDano'), 'estado', 'aprobada', 'motivo', 'daño', 'retirar', true))->>'codigo') = 'pin_incorrecto', 'Admin sin PIN no puede aprobar');
select pruebas.ok((pruebas.rpc('resolver_incidencia', jsonb_build_object('incidencia_id', (select id from ids where k='incDano'), 'estado', 'aprobada', 'motivo', 'daño', 'retirar', true, 'pin', '1234'))->>'ok')::boolean, 'Admin con PIN aprueba y retira la pieza dañada');
select pruebas.ok((select existencia = 31 from public.variantes where id = (select id from ids where k='rojo')), 'Existencia baja a 31 por movimiento de retiro (no edición directa)');
select pruebas.ok((select count(*) = 1 from public.movimientos where tipo = 'retiro_dano'), 'Existe el movimiento de retiro por daño');

-- Aprobación del faltante del evento A y cierre
select pruebas.ok((pruebas.rpc('cambiar_estado_evento', jsonb_build_object('evento_id', (select id from ids where k='evA'), 'estado', 'cerrado'))->>'codigo') = 'diferencias_pendientes', 'No se puede cerrar el evento A con un faltante sin resolver');
select pruebas.ok((pruebas.rpc('resolver_incidencia', jsonb_build_object('incidencia_id', (select id from public.incidencias where evento_id = (select id from ids where k='evA') and estado = 'pendiente'), 'estado', 'aprobada', 'motivo', 'pérdida confirmada', 'pin', '1234'))->>'ok')::boolean, 'Admin aprueba el faltante como pérdida');
select pruebas.ok((select baja = 2 and estado_conciliacion = 'completo' from public.v_evento_items where evento_id = (select id from ids where k='evA')), 'La línea queda conciliada (8 regresadas + 2 de baja)');
select pruebas.ok((pruebas.rpc('cambiar_estado_evento', jsonb_build_object('evento_id', (select id from ids where k='evA'), 'estado', 'cerrado'))->>'ok')::boolean, 'Ahora sí se cierra el evento A');
select pruebas.ok((pruebas.rpc('cambiar_estado_evento', jsonb_build_object('evento_id', (select id from ids where k='evA'), 'estado', 'recogida'))->>'codigo') = 'requiere_autorizacion', 'Reabrir requiere motivo y PIN');
select pruebas.ok((pruebas.rpc('cambiar_estado_evento', jsonb_build_object('evento_id', (select id from ids where k='evC'), 'estado', 'cerrado', 'forzar', true, 'motivo', 'Cliente devolverá', 'pin', '1234'))->>'ok')::boolean, 'Cierre excepcional del evento C con motivo y PIN');
select pruebas.ok((select cierre_forzado from public.eventos where id = (select id from ids where k='evC')), 'El cierre queda marcado como forzado');

-- ---------------------------------------------------------------------
\echo '▶ Correcciones: reversión auditada y transferencia entre eventos'
-- ---------------------------------------------------------------------
select pruebas.rpc('cambiar_estado_evento', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'estado', 'recogida'));
select pruebas.como('rec');
select pruebas.rpc('registrar_recogida', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'items', jsonb_build_array(jsonb_build_object('variante_id', (select id from ids where k='cafe'), 'cantidad', 9))));
insert into ids select 'movB', id from public.movimientos where evento_id = (select id from ids where k='evB') and tipo = 'devolucion';
select pruebas.ok((pruebas.rpc('revertir_movimiento', jsonb_build_object('movimiento_id', (select id from ids where k='movB')))->>'codigo') = 'falta_motivo', 'Revertir exige motivo');
select pruebas.como('ambos');
select pruebas.ok((pruebas.rpc('revertir_movimiento', jsonb_build_object('movimiento_id', (select id from ids where k='movB'), 'motivo', 'x'))->>'codigo') = 'sin_permiso', 'Nadie (salvo admin) puede revertir el registro de otra persona');
select pruebas.como('rec');
select pruebas.ok((pruebas.rpc('revertir_movimiento', jsonb_build_object('movimiento_id', (select id from ids where k='movB'), 'motivo', 'Conté de más'))->>'ok')::boolean, 'Rosa revierte su propio conteo equivocado');
select pruebas.ok((select count(*) = 2 from public.movimientos where evento_id = (select id from ids where k='evB') and tipo in ('devolucion','reversion')), 'El movimiento original NO se borra: hay original + reversión');
select pruebas.ok((pruebas.rpc('revertir_movimiento', jsonb_build_object('movimiento_id', (select id from ids where k='movB'), 'motivo', 'otra vez'))->>'codigo') = 'ya_revertido', 'No se puede revertir dos veces');
select pruebas.rpc('registrar_recogida', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'items', jsonb_build_array(jsonb_build_object('variante_id', (select id from ids where k='cafe'), 'cantidad', 8))));
select pruebas.ok((select regresada = 8 from public.evento_items where evento_id = (select id from ids where k='evB')), 'Conteo corregido a 8');
select pruebas.como('admin');
insert into ids select 'evD', (pruebas.rpc('guardar_evento', '{"nombre":"Graduación","fecha":"2026-11-08"}')->>'id')::uuid;
create temp table ex_antes as select existencia from public.variantes where id = (select id from ids where k='cafe');
select pruebas.ok((pruebas.rpc('transferir_entre_eventos', jsonb_build_object('origen_id', (select id from ids where k='evB'), 'destino_id', (select id from ids where k='evD'), 'variante_id', (select id from ids where k='cafe'), 'cantidad', 9, 'motivo', 'Eran de la graduación', 'pin', '1234'))->>'codigo') = 'sin_cantidad', 'No se puede transferir más de lo contado');
select pruebas.ok((pruebas.rpc('transferir_entre_eventos', jsonb_build_object('origen_id', (select id from ids where k='evB'), 'destino_id', (select id from ids where k='evD'), 'variante_id', (select id from ids where k='cafe'), 'cantidad', 2, 'motivo', 'Eran de la graduación', 'pin', '1234'))->>'ok')::boolean, 'Admin reclasifica 2 piezas contadas en B que eran del evento D');
select pruebas.ok((select regresada = 6 from public.evento_items where evento_id = (select id from ids where k='evB')) and (select regresada = 2 from public.evento_items where evento_id = (select id from ids where k='evD')), 'B queda con 6 contadas y D con 2 (transferencia explícita)');
select pruebas.ok((select v.existencia = a.existencia from public.variantes v, ex_antes a where v.id = (select id from ids where k='cafe')), 'La transferencia no altera la existencia física');

-- ---------------------------------------------------------------------
\echo '▶ 12. Permisos verificados en el servidor'
-- ---------------------------------------------------------------------
select pruebas.como('lec');
select pruebas.ok((pruebas.rpc('registrar_salida', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'items', '[]'))->>'codigo') = 'sin_permiso', 'Solo lectura no puede registrar salidas');
select pruebas.ok((select count(*) > 0 from public.v_inventario), 'Solo lectura sí puede consultar el inventario');
select pruebas.ok((select count(*) = 0 from public.auditoria), 'Solo lectura no ve la bitácora');
select pruebas.como('rec');
select pruebas.ok((pruebas.rpc('registrar_salida', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'items', '[]'))->>'codigo') = 'sin_permiso', 'Recogidas no puede registrar salidas');
select pruebas.ok((select bool_and(usuario_id = pruebas.uid('rec')) from public.auditoria), 'Recogidas solo ve sus propias acciones en la bitácora');
select pruebas.como('sal');
select pruebas.ok((pruebas.rpc('registrar_recogida', jsonb_build_object('evento_id', (select id from ids where k='evB'), 'items', '[]'))->>'codigo') = 'sin_permiso', 'Salidas no puede registrar recogidas');
select pruebas.ok((pruebas.rpc('ajustar_existencia', jsonb_build_object('variante_id', (select id from ids where k='cafe'), 'cantidad', 100, 'motivo', 'x'))->>'codigo') = 'sin_permiso', 'Salidas no puede ajustar existencias');
select pruebas.ok((pruebas.rpc('guardar_variante', '{"nombre":"Hack"}')->>'codigo') = 'sin_permiso', 'Salidas no puede dar de alta artículos');
select pruebas.como('pend');
select pruebas.ok((select count(*) = 0 from public.variantes), 'Un usuario pendiente de aprobación no ve nada');
select pruebas.ok((select count(*) = 1 from public.perfiles), '…solo su propio perfil');

select pruebas.como('sal');
do $$ begin
  begin
    insert into public.movimientos (operacion_id, tipo, variante_id, cantidad, efecto_existencia, usuario_id)
    values (gen_random_uuid(), 'entrada', (select id from public.variantes limit 1), 99, 99, auth.uid());
    raise exception 'FALLÓ: se pudo insertar directo';
  exception when insufficient_privilege then raise notice '  ✔ Nadie puede insertar movimientos directamente (sin pasar por las funciones)';
  end;
  begin
    update public.variantes set existencia = 999;
    raise exception 'FALLÓ: se pudo editar existencia';
  exception when insufficient_privilege then raise notice '  ✔ Nadie puede editar la existencia directamente';
  end;
  begin
    perform public._auditar('falso');
    raise exception 'FALLÓ: se pudo escribir en la bitácora';
  exception when insufficient_privilege then raise notice '  ✔ Nadie puede escribir en la bitácora directamente';
  end;
end $$;

reset role;
select pruebas.como('admin');
set role authenticated;
select pruebas.ok((select count(*) >= 5 from public.auditoria where not exito and detalle like 'Permiso denegado%'), 'Los intentos rechazados quedan registrados en la bitácora');
select pruebas.ok((select count(*) > 0 from public.v_auditoria where accion = 'registrar_salida' and dispositivo = 'Celular Pedro' and usuario_nombre = 'Pedro Salidas'), 'La bitácora guarda quién, desde qué dispositivo y qué hizo');
reset role;

do $$ begin
  begin
    update public.auditoria set accion = 'x';
    raise exception 'FALLÓ: se modificó la bitácora';
  exception when insufficient_privilege then raise notice '  ✔ Ni el dueño de la base puede modificar la bitácora';
  end;
  begin
    delete from public.movimientos;
    raise exception 'FALLÓ: se borraron movimientos';
  exception when insufficient_privilege then raise notice '  ✔ Ni el dueño de la base puede borrar movimientos';
  end;
end $$;

-- ---------------------------------------------------------------------
\echo '▶ Integridad: saldos reconstruidos desde el historial'
-- ---------------------------------------------------------------------
select pruebas.como('admin');
set role authenticated;
select pruebas.ok((select count(*) = 0 from public.verificar_saldos()), 'Existencia guardada = suma del historial para todos los artículos');
reset role;
\echo '✅ Todas las pruebas pasaron'
