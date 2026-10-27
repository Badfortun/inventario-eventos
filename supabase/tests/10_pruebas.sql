-- =====================================================================
-- Pruebas de la base v2 (se corren con el rol "authenticated", como la app)
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
create table pruebas.u (alias text primary key, id uuid);
create table pruebas.k (k text primary key, id uuid);
grant all on pruebas.u, pruebas.k to authenticated;
create function pruebas.como(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from pruebas.u where alias = p), false) $$;
create function pruebas.uid(p text) returns uuid language sql as $$ select id from pruebas.u where alias = p $$;
create function pruebas.id(p text) returns uuid language sql as $$ select id from pruebas.k where k = p $$;
create function pruebas.rpc(p_fn text, p_args jsonb, p_idem uuid default gen_random_uuid()) returns jsonb language plpgsql as $$
declare r jsonb;
begin execute format('select public.%I($1, $2)', p_fn) into r using p_idem, p_args; return r; end $$;
-- Movimiento rápido: origen, destino, artículo, cantidad, [dañadas], escaneo salida/entrada
create function pruebas.mov(o text, d text, a text, c int, dan int default 0, es text default 'escaneado', ee text default 'escaneado', idem uuid default gen_random_uuid())
returns jsonb language sql as $$
  select pruebas.rpc('registrar_movimiento', jsonb_build_object('origen_id', pruebas.id(o), 'destino_id', pruebas.id(d),
    'items', jsonb_build_array(jsonb_build_object('articulo_id', pruebas.id(a), 'cantidad', c, 'danadas', dan)),
    'escaneo_salida', es, 'escaneo_entrada', ee, 'dispositivo', 'Celular de prueba'), idem) $$;
create function pruebas.en(l text, a text) returns int language sql as $$
  select coalesce((select cantidad from public.existencias where lugar_id = pruebas.id(l) and articulo_id = pruebas.id(a)), 0) $$;
grant execute on all functions in schema pruebas to authenticated;

with n as (
  insert into auth.users (email, raw_user_meta_data) values
    ('admin@x.app', '{"usuario":"admin","nombre":"Ana Admin"}'),
    ('sal@x.app', '{"usuario":"sal","nombre":"Pedro Salidas"}'),
    ('rec@x.app', '{"usuario":"rec","nombre":"Rosa Recogidas"}'),
    ('lec@x.app', '{"usuario":"lec","nombre":"Luis Lectura"}'),
    ('pend@x.app', '{"usuario":"pend","nombre":"Pendiente"}')
  returning id, raw_user_meta_data->>'usuario' a)
insert into pruebas.u select a, id from n;
insert into pruebas.k select tipo, id from public.lugares where tipo <> 'evento';

set role authenticated;

\echo '▶ Usuarios'
select pruebas.como('admin');
select pruebas.ok((select activo and roles = '{admin}' from public.perfiles where usuario = 'admin'), 'El primer usuario queda como administrador');
select pruebas.ok((pruebas.rpc('actualizar_usuario', jsonb_build_object('usuario_id', pruebas.uid('sal'), 'roles', '["salidas"]'::jsonb, 'activo', true))->>'ok')::boolean, 'Aprobar a Pedro (Salidas)');
select pruebas.ok((pruebas.rpc('actualizar_usuario', jsonb_build_object('usuario_id', pruebas.uid('rec'), 'roles', '["recogidas"]'::jsonb, 'activo', true))->>'ok')::boolean, 'Aprobar a Rosa (Recogidas)');
select pruebas.ok((pruebas.rpc('actualizar_usuario', jsonb_build_object('usuario_id', pruebas.uid('lec'), 'roles', '["lectura"]'::jsonb, 'activo', true))->>'ok')::boolean, 'Aprobar a Luis (Solo lectura)');
select pruebas.ok((select count(*) = 4 from public.lugares where tipo <> 'evento'), 'Existen los lugares fijos: Almacén, Reparación, Pérdidas, Dados de baja');

\echo '▶ Artículos con código propio'
insert into pruebas.k select 'ext', (pruebas.rpc('guardar_articulo', '{"codigo":"ext-10-n","nombre":"Extensión","color_nombre":"Negra","medida":10,"unidad_medida":"metros","categoria":"Eléctrico","cantidad_inicial":200,"escaneo_inicial":"escaneado"}')->>'id')::uuid;
insert into pruebas.k select 'cab', (pruebas.rpc('guardar_articulo', '{"codigo":"CAB-CAF-25","nombre":"Cable","color_nombre":"Café","medida":25,"unidad_medida":"pies","cantidad_inicial":10,"escaneo_inicial":"sin_escaneo"}')->>'id')::uuid;
select pruebas.ok((select codigo = 'EXT-10-N' from public.articulos where id = pruebas.id('ext')), 'El código se guarda en mayúsculas');
select pruebas.ok((pruebas.rpc('guardar_articulo', '{"codigo":"EXT-10-N","nombre":"Otra"}')->>'codigo') = 'codigo_duplicado', 'No se permiten códigos repetidos');
select pruebas.ok(pruebas.en('almacen', 'ext') = 200, '200 extensiones en Almacén');
select pruebas.ok((select sin_escanear = 0 from public.v_articulos where id = pruebas.id('ext')) and (select sin_escanear = 10 from public.v_articulos where id = pruebas.id('cab')), 'El alta registra si llegó escaneado o pendiente de escanear');

\echo '▶ Eventos como lugares'
insert into pruebas.k select 'e1', (pruebas.rpc('guardar_evento', '{"nombre":"Evento 1","fecha":"2026-11-05"}')->>'id')::uuid;
insert into pruebas.k select 'e2', (pruebas.rpc('guardar_evento', '{"nombre":"Evento 2","fecha":"2026-11-06"}')->>'id')::uuid;
select pruebas.ok((select count(*) = 2 from public.v_lugares where tipo = 'evento' and estado = 'abierto'), 'Dos eventos abiertos');

\echo '▶ Tu ejemplo: 200 extensiones'
select pruebas.como('sal');
select pruebas.ok((pruebas.mov('almacen', 'e1', 'ext', 200, 0, 'escaneado', 'sin_escaneo')->>'ok')::boolean, 'Pedro lleva 200 al Evento 1 (salida escaneada)');
select pruebas.ok(pruebas.en('almacen', 'ext') = 0 and pruebas.en('e1', 'ext') = 200, 'Almacén 0 · Evento 1: 200');
select pruebas.ok((pruebas.mov('almacen', 'e1', 'ext', 1)->>'codigo') = 'sin_existencia', 'No se puede sacar lo que no hay en el Almacén');
select pruebas.ok((select escaneo_salida = 'escaneado' and escaneo_salida_por = pruebas.uid('sal') and escaneo_entrada = 'sin_escaneo'
                   from public.movimientos where tipo = 'traslado' order by created_at limit 1), 'Se guarda quién escaneó la salida y que la entrada no se escaneó');

select pruebas.como('rec');
insert into pruebas.k select 'sol1', (pruebas.mov('e1', 'e2', 'ext', 50, 0, 'sin_escaneo', 'escaneado')->>'id')::uuid;
select pruebas.ok((select estado = 'por_autorizar' from public.movimientos where id = pruebas.id('sol1')), 'Rosa solicita mover 50 del Evento 1 al Evento 2 → queda POR AUTORIZAR');
select pruebas.ok(pruebas.en('e1', 'ext') = 200 and pruebas.en('e2', 'ext') = 0, 'Mientras no se autoriza, las cantidades no cambian');
select pruebas.ok((pruebas.rpc('autorizar_movimiento', jsonb_build_object('movimiento_id', pruebas.id('sol1'), 'aprobar', true))->>'codigo') = 'sin_permiso', 'Rosa no puede autorizar su propio traslado');
select pruebas.como('admin');
select pruebas.ok((pruebas.rpc('autorizar_movimiento', jsonb_build_object('movimiento_id', pruebas.id('sol1'), 'aprobar', true))->>'ok')::boolean, 'El administrador autoriza el traslado');
select pruebas.ok(pruebas.en('e1', 'ext') = 150 and pruebas.en('e2', 'ext') = 50, 'Evento 1: 150 · Evento 2: 50');
select pruebas.ok((select autorizado_por = pruebas.uid('admin') and escaneo_salida = 'sin_escaneo' from public.movimientos where id = pruebas.id('sol1')), 'Queda registrado quién autorizó y que salió del Evento 1 sin escaneo');
select pruebas.como('sal');
select pruebas.ok((pruebas.mov('e1', 'e2', 'ext', 151)->>'codigo') = 'sin_existencia', 'No se puede solicitar mover más de lo que hay en el evento');

select pruebas.como('rec');
select pruebas.ok((pruebas.mov('e1', 'almacen', 'ext', 150, 0, 'escaneado', 'sin_escaneo')->>'ok')::boolean, 'Regresan 150 del Evento 1 al Almacén (entrada sin escanear)');
select pruebas.ok((pruebas.mov('e2', 'almacen', 'ext', 48, 3, 'escaneado', 'escaneado')->>'ok')::boolean, 'Regresan 48 del Evento 2 (3 dañadas)');
select pruebas.ok(pruebas.en('almacen', 'ext') = 195 and pruebas.en('reparacion', 'ext') = 3, 'Almacén 195 · Reparación 3 (las dañadas van a Reparación)');
select pruebas.ok(pruebas.en('e1', 'ext') = 0 and pruebas.en('e2', 'ext') = 2, 'Evento 1 cuadra (0) · Evento 2 tiene 2 sin regresar');

\echo '▶ Total y reparto'
select pruebas.ok((select total = 200 and en_almacen = 195 and en_reparacion = 3 and en_eventos = 2 and num_eventos = 1
                   from public.v_articulos where id = pruebas.id('ext')), 'Total 200 = 195 almacén + 3 reparación + 2 en 1 evento');
select pruebas.ok((select sin_escanear = 150 from public.v_articulos where id = pruebas.id('ext')), 'Almacén: 150 pendientes de escanear (las que llegaron sin escaneo)');
select pruebas.ok((select llego = 200 and a_otros_eventos = 50 and regreso_almacen = 150 and en_evento = 0
                   from public.v_evento_resumen where evento_id = pruebas.id('e1') and articulo_id = pruebas.id('ext')), 'Resumen Evento 1: llegaron 200, 50 a otro evento, 150 regresaron, quedan 0');
select pruebas.ok((select llego = 50 and llego_de_eventos = 50 and regreso_almacen = 48 and danadas = 3 and en_evento = 2
                   from public.v_evento_resumen where evento_id = pruebas.id('e2') and articulo_id = pruebas.id('ext')), 'Resumen Evento 2: llegaron 50 (del Evento 1), regresaron 48 (3 dañadas), faltan 2');

\echo '▶ Cierre de evento: la pérdida queda en el evento correcto'
select pruebas.ok((pruebas.rpc('cerrar_evento', jsonb_build_object('evento_id', pruebas.id('e2')))->>'codigo') = 'sin_permiso', 'Recogidas no puede cerrar eventos');
select pruebas.como('admin');
create temp table cierre as select pruebas.rpc('cerrar_evento', jsonb_build_object('evento_id', pruebas.id('e2'))) r;
select pruebas.ok((select (r->>'ok')::boolean and (r->'perdidas'->0->>'cantidad')::int = 2 from cierre), 'Al cerrar el Evento 2 se confirman 2 extensiones perdidas');
select pruebas.ok((select perdidas = 2 and en_evento = 0 from public.v_evento_resumen where evento_id = pruebas.id('e2') and articulo_id = pruebas.id('ext')), 'La pérdida queda registrada en el Evento 2');
select pruebas.ok((select total = 198 and perdidas = 2 from public.v_articulos where id = pruebas.id('ext')), 'Total baja a 198; 2 en Pérdidas');
select pruebas.ok((select perdidas = 0 from public.v_lugares where id = pruebas.id('e1')), 'El Evento 1 no tiene pérdidas');
select pruebas.como('sal');
select pruebas.ok((pruebas.mov('almacen', 'e2', 'ext', 1)->>'codigo') = 'evento_cerrado', 'No se puede mover material a un evento cerrado');

\echo '▶ Escaneo pendiente en Almacén'
select pruebas.como('rec');
select pruebas.ok((pruebas.rpc('marcar_escaneado', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('articulo_id', pruebas.id('ext'), 'cantidad', 100)), 'escaneado_por', pruebas.uid('sal')))->>'ok')::boolean, 'Se marcan 100 como escaneadas (las entregó Pedro al escaneador)');
select pruebas.ok((select sin_escanear = 50 from public.v_articulos where id = pruebas.id('ext')), 'Quedan 50 pendientes de escanear');
select pruebas.ok((pruebas.rpc('marcar_escaneado', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('articulo_id', pruebas.id('ext'), 'cantidad', 51))))->>'codigo') = 'dato_invalido', 'No se pueden marcar más de las pendientes');
select pruebas.ok((select escaneo_entrada_por = pruebas.uid('sal') and registrado_por = pruebas.uid('rec') from public.movimientos where tipo = 'escaneo'), 'Queda quién escaneó (Pedro) y quién lo registró (Rosa)');

\echo '▶ Sobrante: regresan más de las registradas'
select pruebas.como('admin');
insert into pruebas.k select 'e3', (pruebas.rpc('guardar_evento', '{"nombre":"Evento 3","fecha":"2026-11-10"}')->>'id')::uuid;
select pruebas.como('sal');
select pruebas.mov('almacen', 'e3', 'cab', 10);
select pruebas.como('rec');
create temp table sob as select pruebas.mov('e3', 'almacen', 'cab', 12) r;
select pruebas.ok((select (r->>'ok')::boolean and (r->'sobrantes'->0->>'sobrante')::int = 2 from sob), 'Se registran 12 contadas (no se recortan a 10) y se marca sobrante de 2');
select pruebas.ok(pruebas.en('almacen', 'cab') = 12 and pruebas.en('e3', 'cab') = 0, 'Almacén recibe las 12; el Evento 3 queda en 0');
select pruebas.ok((select sobrante = 2 from public.v_evento_resumen where evento_id = pruebas.id('e3') and articulo_id = pruebas.id('cab')), 'El resumen del Evento 3 muestra el sobrante');

\echo '▶ Corrección de errores (no se borra nada)'
select pruebas.como('sal');
insert into pruebas.k select 'err', (pruebas.mov('almacen', 'e3', 'cab', 5)->>'id')::uuid;
select pruebas.como('rec');
select pruebas.ok((pruebas.rpc('revertir_movimiento', jsonb_build_object('movimiento_id', pruebas.id('err'), 'motivo', 'x'))->>'codigo') = 'sin_permiso', 'Rosa no puede corregir un registro de Pedro');
select pruebas.como('sal');
select pruebas.ok((pruebas.rpc('revertir_movimiento', jsonb_build_object('movimiento_id', pruebas.id('err')))->>'codigo') = 'falta_motivo', 'Corregir exige motivo');
select pruebas.ok((pruebas.rpc('revertir_movimiento', jsonb_build_object('movimiento_id', pruebas.id('err'), 'motivo', 'Me equivoqué de evento'))->>'ok')::boolean, 'Pedro corrige su propio registro');
select pruebas.ok(pruebas.en('almacen', 'cab') = 12 and pruebas.en('e3', 'cab') = 0, 'Las cantidades vuelven a como estaban');
select pruebas.ok((select estado = 'revertido' from public.movimientos where id = pruebas.id('err')) and (select count(*) = 1 from public.movimientos where revierte_a = pruebas.id('err')), 'El original se conserva (marcado como corregido) y existe el movimiento de corrección');
select pruebas.ok((pruebas.rpc('revertir_movimiento', jsonb_build_object('movimiento_id', pruebas.id('err'), 'motivo', 'otra'))->>'codigo') = 'no_reversible', 'No se puede corregir dos veces');

\echo '▶ Reparación y bajas'
select pruebas.como('rec');
select pruebas.ok((pruebas.mov('reparacion', 'almacen', 'ext', 2)->>'ok')::boolean, 'Recogidas regresa 2 reparadas al Almacén');
select pruebas.ok((pruebas.mov('reparacion', 'baja', 'ext', 1, 0, 'sin_escaneo', null)->>'codigo') = 'sin_permiso', 'Recogidas no puede dar de baja');
select pruebas.como('admin');
select pruebas.ok((pruebas.mov('reparacion', 'baja', 'ext', 1, 0, 'sin_escaneo', null)->>'ok')::boolean, 'El administrador da de baja 1 que no tuvo arreglo');
select pruebas.ok((select total = 197 and bajas = 1 and en_reparacion = 0 from public.v_articulos where id = pruebas.id('ext')), 'Total 197 · 1 dada de baja · 0 en reparación');

\echo '▶ Rechazo y cancelación de traslados'
insert into pruebas.k select 'e4', (pruebas.rpc('guardar_evento', '{"nombre":"Evento 4","fecha":"2026-11-12"}')->>'id')::uuid;
select pruebas.como('sal');
select pruebas.mov('almacen', 'e4', 'ext', 20);
insert into pruebas.k select 'sol2', (pruebas.mov('e4', 'e1', 'ext', 5)->>'id')::uuid;
insert into pruebas.k select 'sol3', (pruebas.mov('e4', 'e1', 'ext', 3)->>'id')::uuid;
select pruebas.ok((pruebas.rpc('autorizar_movimiento', jsonb_build_object('movimiento_id', pruebas.id('sol3'), 'aprobar', false, 'motivo', 'Me equivoqué'))->>'ok')::boolean, 'Quien pidió el traslado puede cancelarlo');
select pruebas.como('admin');
select pruebas.ok((pruebas.rpc('cerrar_evento', jsonb_build_object('evento_id', pruebas.id('e4')))->>'codigo') = 'traslados_pendientes', 'No se puede cerrar un evento con traslados por autorizar');
select pruebas.ok((pruebas.rpc('autorizar_movimiento', jsonb_build_object('movimiento_id', pruebas.id('sol2'), 'aprobar', false))->>'codigo') = 'falta_motivo', 'Rechazar exige motivo');
select pruebas.ok((pruebas.rpc('autorizar_movimiento', jsonb_build_object('movimiento_id', pruebas.id('sol2'), 'aprobar', false, 'motivo', 'No se movió'))->>'ok')::boolean, 'El administrador rechaza el traslado');
select pruebas.ok(pruebas.en('e4', 'ext') = 20, 'Las cantidades no cambian al rechazar');
select pruebas.ok((pruebas.mov('e4', 'e1', 'ext', 4, 0, 'escaneado', 'escaneado')->>'estado') = 'aplicado', 'Si el administrador registra el traslado, queda autorizado de inmediato');

\echo '▶ Idempotencia'
select pruebas.como('sal');
insert into pruebas.k values ('idem', gen_random_uuid());
select pruebas.mov('almacen', 'e4', 'ext', 1, 0, 'escaneado', 'escaneado', pruebas.id('idem'));
create temp table rep as select pruebas.mov('almacen', 'e4', 'ext', 1, 0, 'escaneado', 'escaneado', pruebas.id('idem')) r;
select pruebas.ok((select (r->>'repetida')::boolean from rep), 'El segundo envío se reconoce como repetido');
select pruebas.ok((select count(*) = 1 from public.movimientos where operacion_id = pruebas.id('idem')) and pruebas.en('e4', 'ext') = 17, 'Solo se registró una vez');

\echo '▶ Permisos en el servidor'
select pruebas.como('lec');
select pruebas.ok((pruebas.mov('almacen', 'e4', 'ext', 1)->>'codigo') = 'sin_permiso', 'Solo lectura no puede mover material');
select pruebas.ok((select count(*) > 0 from public.v_articulos), 'Solo lectura sí consulta');
select pruebas.ok((select count(*) = 0 from public.auditoria), 'Solo lectura no ve la bitácora');
select pruebas.como('sal');
select pruebas.ok((pruebas.mov('e4', 'almacen', 'ext', 1)->>'codigo') = 'sin_permiso', 'Salidas no puede registrar regresos');
select pruebas.ok((pruebas.rpc('guardar_articulo', '{"codigo":"X","nombre":"X"}')->>'codigo') = 'sin_permiso', 'Salidas no puede dar de alta artículos');
select pruebas.ok((pruebas.rpc('ajustar_existencia', jsonb_build_object('articulo_id', pruebas.id('ext'), 'cantidad', 9, 'motivo', 'x'))->>'codigo') = 'sin_permiso', 'Salidas no puede ajustar existencias');
select pruebas.ok((select bool_and(usuario_id = pruebas.uid('sal')) from public.auditoria), 'Salidas solo ve sus acciones en la bitácora');
select pruebas.como('pend');
select pruebas.ok((select count(*) = 0 from public.articulos) and (select count(*) = 1 from public.perfiles), 'Un usuario pendiente no ve nada');
select pruebas.como('admin');
do $$ begin
  begin update public.existencias set cantidad = 999; raise exception 'FALLÓ';
  exception when insufficient_privilege then raise notice '  ✔ Nadie puede editar existencias directamente'; end;
  begin insert into public.movimientos (operacion_id, tipo, destino_id, registrado_por) values (gen_random_uuid(), 'alta', (select id from public.lugares limit 1), auth.uid()); raise exception 'FALLÓ';
  exception when insufficient_privilege then raise notice '  ✔ Nadie puede crear movimientos sin pasar por las funciones'; end;
  begin perform public._mover(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 5, false); raise exception 'FALLÓ';
  exception when insufficient_privilege then raise notice '  ✔ Las funciones internas no se pueden llamar desde la app'; end;
end $$;
select pruebas.ok((select count(*) > 0 from public.auditoria where not exito and detalle like 'Permiso denegado%'), 'Los intentos rechazados quedan en la bitácora');
reset role;
do $$ begin
  begin update public.movimiento_items set cantidad = 1; raise exception 'FALLÓ';
  exception when insufficient_privilege then raise notice '  ✔ Ni el dueño de la base puede cambiar cantidades del historial'; end;
  begin update public.movimientos set origen_id = null where tipo = 'traslado'; raise exception 'FALLÓ';
  exception when insufficient_privilege then raise notice '  ✔ De un movimiento solo puede cambiar su estado'; end;
  begin delete from public.auditoria; raise exception 'FALLÓ';
  exception when insufficient_privilege then raise notice '  ✔ La bitácora no se puede borrar'; end;
end $$;

\echo '▶ Integridad'
select pruebas.como('admin');
set role authenticated;
select pruebas.ok((select count(*) = 0 from public.verificar_saldos()), 'Existencias = suma del historial en todos los lugares');
select pruebas.ok((select sum(total + perdidas + bajas) = 200 + 10 + 2 from public.v_articulos), 'Nada aparece ni desaparece: total + pérdidas + bajas = altas + sobrantes');
reset role;
\echo '✅ Todas las pruebas pasaron'
