-- =====================================================================
-- Inventario de Eventos v2 · 3/3 · Seguridad y vistas
-- =====================================================================

alter table public.perfiles          enable row level security;
alter table public.lugares           enable row level security;
alter table public.articulos         enable row level security;
alter table public.existencias       enable row level security;
alter table public.movimientos       enable row level security;
alter table public.movimiento_items  enable row level security;
alter table public.asientos          enable row level security;
alter table public.operaciones       enable row level security;
alter table public.auditoria         enable row level security;

-- Lectura solo para usuarios aprobados. Un usuario pendiente solo ve su perfil.
drop policy if exists perfiles_leer on public.perfiles;
create policy perfiles_leer on public.perfiles for select to authenticated using (id = auth.uid() or public._es_activo());
drop policy if exists lugares_leer on public.lugares;
create policy lugares_leer on public.lugares for select to authenticated using (public._es_activo());
drop policy if exists articulos_leer on public.articulos;
create policy articulos_leer on public.articulos for select to authenticated using (public._es_activo());
drop policy if exists existencias_leer on public.existencias;
create policy existencias_leer on public.existencias for select to authenticated using (public._es_activo());
drop policy if exists movimientos_leer on public.movimientos;
create policy movimientos_leer on public.movimientos for select to authenticated using (public._es_activo());
drop policy if exists items_leer on public.movimiento_items;
create policy items_leer on public.movimiento_items for select to authenticated using (public._es_activo());
drop policy if exists asientos_leer on public.asientos;
create policy asientos_leer on public.asientos for select to authenticated using (public._es_admin());
-- Bitácora: administrador todo; salidas/recogidas solo lo suyo; solo lectura nada.
drop policy if exists auditoria_leer on public.auditoria;
create policy auditoria_leer on public.auditoria for select to authenticated
  using (public._es_admin() or (usuario_id = auth.uid() and public._tiene(array['salidas', 'recogidas'])));
-- No hay políticas de escritura: todo pasa por las funciones del archivo 2/3.

-- ---------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------
-- Artículo con su total y cómo está repartido
create or replace view public.v_articulos with (security_invoker = true) as
select a.*,
  coalesce(sum(e.cantidad) filter (where l.tipo in ('almacen', 'reparacion', 'evento')), 0)::integer as total,
  coalesce(sum(e.cantidad) filter (where l.tipo = 'almacen'), 0)::integer as en_almacen,
  coalesce(sum(e.sin_escanear) filter (where l.tipo = 'almacen'), 0)::integer as sin_escanear,
  coalesce(sum(e.cantidad) filter (where l.tipo = 'reparacion'), 0)::integer as en_reparacion,
  coalesce(sum(e.cantidad) filter (where l.tipo = 'evento'), 0)::integer as en_eventos,
  count(distinct e.lugar_id) filter (where l.tipo = 'evento' and e.cantidad > 0)::integer as num_eventos,
  coalesce(sum(e.cantidad) filter (where l.tipo = 'perdida'), 0)::integer as perdidas,
  coalesce(sum(e.cantidad) filter (where l.tipo = 'baja'), 0)::integer as bajas
from public.articulos a
left join public.existencias e on e.articulo_id = a.id
left join public.lugares l on l.id = e.lugar_id
group by a.id;

-- Qué hay en cada lugar
create or replace view public.v_existencias with (security_invoker = true) as
select e.lugar_id, e.articulo_id, e.cantidad, e.sin_escanear, e.updated_at,
       l.nombre as lugar_nombre, l.tipo as lugar_tipo, l.estado as lugar_estado, l.fecha as lugar_fecha,
       a.codigo, a.nombre, a.categoria, a.unidad, a.color_nombre, a.color_hex, a.medida, a.unidad_medida, a.tamano, a.activo
from public.existencias e
join public.lugares l on l.id = e.lugar_id
join public.articulos a on a.id = e.articulo_id
where e.cantidad > 0;

-- Lugares con totales
create or replace view public.v_lugares with (security_invoker = true) as
select l.*,
  coalesce((select sum(cantidad) from public.existencias where lugar_id = l.id), 0)::integer as piezas,
  (select count(*) from public.existencias where lugar_id = l.id and cantidad > 0)::integer as articulos,
  coalesce((select sum(sin_escanear) from public.existencias where lugar_id = l.id), 0)::integer as sin_escanear,
  (select count(*) from public.movimientos m where m.estado = 'por_autorizar' and (m.origen_id = l.id or m.destino_id = l.id))::integer as por_autorizar,
  coalesce((select sum(i.cantidad) from public.movimientos m join public.movimiento_items i on i.movimiento_id = m.id
            where m.tipo = 'perdida' and m.estado = 'aplicado' and m.origen_id = l.id), 0)::integer as perdidas,
  pc.nombre as creado_por_nombre, pz.nombre as cerrado_por_nombre
from public.lugares l
left join public.perfiles pc on pc.id = l.created_by
left join public.perfiles pz on pz.id = l.cerrado_por;

-- Movimientos con nombres y renglones
create or replace view public.v_movimientos with (security_invoker = true) as
select m.*,
  o.nombre as origen_nombre, o.tipo as origen_tipo, d.nombre as destino_nombre, d.tipo as destino_tipo,
  pr.nombre as registrado_nombre, ps.nombre as escaneo_salida_nombre, pe.nombre as escaneo_entrada_nombre,
  pa.nombre as autorizado_nombre, pv.nombre as revertido_nombre,
  it.piezas, it.danadas_total, it.sobrante_total, it.num_articulos, it.items
from public.movimientos m
left join public.lugares o on o.id = m.origen_id
left join public.lugares d on d.id = m.destino_id
left join public.perfiles pr on pr.id = m.registrado_por
left join public.perfiles ps on ps.id = m.escaneo_salida_por
left join public.perfiles pe on pe.id = m.escaneo_entrada_por
left join public.perfiles pa on pa.id = m.autorizado_por
left join public.perfiles pv on pv.id = m.revertido_por
left join lateral (
  select sum(i.cantidad)::integer piezas, sum(i.danadas)::integer danadas_total, sum(i.sobrante)::integer sobrante_total,
         count(*)::integer num_articulos,
         jsonb_agg(jsonb_build_object('articulo_id', a.id, 'codigo', a.codigo, 'nombre', a.nombre, 'color_nombre', a.color_nombre,
                                      'color_hex', a.color_hex, 'medida', a.medida, 'unidad_medida', a.unidad_medida, 'tamano', a.tamano,
                                      'cantidad', i.cantidad, 'danadas', i.danadas, 'sobrante', i.sobrante) order by a.nombre) items
  from public.movimiento_items i join public.articulos a on a.id = i.articulo_id
  where i.movimiento_id = m.id
) it on true;

-- Renglones de movimientos (historial por artículo y reportes)
create or replace view public.v_movimiento_items with (security_invoker = true) as
select i.*, m.tipo, m.estado, m.origen_id, m.destino_id, m.created_at, m.registrado_por, m.escaneo_salida, m.escaneo_entrada,
       m.escaneo_salida_por, m.escaneo_entrada_por, m.notas, m.motivo,
       o.nombre as origen_nombre, o.tipo as origen_tipo, d.nombre as destino_nombre, d.tipo as destino_tipo,
       pr.nombre as registrado_nombre, ps.nombre as escaneo_salida_nombre, pe.nombre as escaneo_entrada_nombre,
       a.codigo, a.nombre, a.color_nombre, a.color_hex, a.medida, a.unidad_medida, a.tamano
from public.movimiento_items i
join public.movimientos m on m.id = i.movimiento_id
join public.articulos a on a.id = i.articulo_id
left join public.lugares o on o.id = m.origen_id
left join public.lugares d on d.id = m.destino_id
left join public.perfiles pr on pr.id = m.registrado_por
left join public.perfiles ps on ps.id = m.escaneo_salida_por
left join public.perfiles pe on pe.id = m.escaneo_entrada_por;

-- Resumen por evento y artículo: qué llegó, a dónde se fue, qué se perdió
create or replace view public.v_evento_resumen with (security_invoker = true) as
with mv as (
  select m.tipo, m.origen_id, m.destino_id, ol.tipo as origen_tipo, dl.tipo as destino_tipo,
         i.articulo_id, i.cantidad, i.danadas, i.sobrante
  from public.movimientos m
  join public.movimiento_items i on i.movimiento_id = m.id
  left join public.lugares ol on ol.id = m.origen_id
  left join public.lugares dl on dl.id = m.destino_id
  where m.estado = 'aplicado' and m.tipo in ('traslado', 'ajuste', 'perdida', 'baja')
), x as (
  select ev.id as evento_id, mv.articulo_id,
    coalesce(sum(mv.cantidad) filter (where mv.destino_id = ev.id and mv.tipo = 'traslado'), 0)::integer as llego,
    coalesce(sum(mv.cantidad) filter (where mv.destino_id = ev.id and mv.tipo = 'traslado' and mv.origen_tipo = 'evento'), 0)::integer as llego_de_eventos,
    coalesce(sum(mv.cantidad - mv.sobrante) filter (where mv.origen_id = ev.id and mv.tipo = 'traslado' and mv.destino_tipo = 'almacen'), 0)::integer as regreso_almacen,
    coalesce(sum(mv.cantidad - mv.sobrante) filter (where mv.origen_id = ev.id and mv.tipo = 'traslado' and mv.destino_tipo = 'reparacion'), 0)::integer as a_reparacion,
    coalesce(sum(mv.cantidad - mv.sobrante) filter (where mv.origen_id = ev.id and mv.tipo = 'traslado' and mv.destino_tipo = 'evento'), 0)::integer as a_otros_eventos,
    coalesce(sum(mv.cantidad - mv.sobrante) filter (where mv.origen_id = ev.id and mv.tipo = 'baja'), 0)::integer as dado_de_baja,
    coalesce(sum(mv.sobrante) filter (where mv.origen_id = ev.id), 0)::integer as sobrante,
    coalesce(sum(mv.danadas) filter (where mv.origen_id = ev.id), 0)::integer as danadas,
    coalesce(sum(mv.cantidad) filter (where mv.origen_id = ev.id and mv.tipo = 'perdida'), 0)::integer as perdidas,
    (coalesce(sum(mv.cantidad) filter (where mv.destino_id = ev.id and mv.tipo = 'ajuste'), 0)
     - coalesce(sum(mv.cantidad) filter (where mv.origen_id = ev.id and mv.tipo = 'ajuste'), 0))::integer as ajustes
  from public.lugares ev
  join mv on mv.origen_id = ev.id or mv.destino_id = ev.id
  where ev.tipo = 'evento'
  group by ev.id, mv.articulo_id
)
select x.*, coalesce(e.cantidad, 0) as en_evento, ev.nombre as evento_nombre, ev.estado as evento_estado,
       a.codigo, a.nombre, a.categoria, a.unidad, a.color_nombre, a.color_hex, a.medida, a.unidad_medida, a.tamano
from x
join public.lugares ev on ev.id = x.evento_id
join public.articulos a on a.id = x.articulo_id
left join public.existencias e on e.lugar_id = x.evento_id and e.articulo_id = x.articulo_id;

create or replace view public.v_auditoria with (security_invoker = true) as
select au.*, l.nombre as lugar_nombre, a.nombre as articulo_nombre
from public.auditoria au
left join public.lugares l on l.id = au.lugar_id
left join public.articulos a on a.id = au.articulo_id;

-- ---------------------------------------------------------------------
-- Latido diario para que Supabase gratis no se pause (no expone datos)
-- ---------------------------------------------------------------------
create or replace function public.ping() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when exists (select 1 from public.lugares) then 'ok' else 'ok' end
$$;

-- ---------------------------------------------------------------------
-- Permisos de objetos
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

grant select on public.perfiles, public.lugares, public.articulos, public.existencias, public.movimientos,
                public.movimiento_items, public.asientos, public.auditoria to authenticated;
grant select on public.v_articulos, public.v_existencias, public.v_lugares, public.v_movimientos,
                public.v_movimiento_items, public.v_evento_resumen, public.v_auditoria to authenticated;

grant execute on function public._es_activo(), public._es_admin(), public._tiene(text[]) to authenticated;
grant execute on function public.ping() to anon, authenticated;
grant execute on function
  public.registrar_acceso(jsonb),
  public.actualizar_usuario(uuid, jsonb),
  public.guardar_articulo(uuid, jsonb),
  public.ajustar_existencia(uuid, jsonb),
  public.guardar_evento(uuid, jsonb),
  public.cerrar_evento(uuid, jsonb),
  public.reabrir_evento(uuid, jsonb),
  public.registrar_movimiento(uuid, jsonb),
  public.autorizar_movimiento(uuid, jsonb),
  public.revertir_movimiento(uuid, jsonb),
  public.marcar_escaneado(uuid, jsonb),
  public.restablecer_contrasena(uuid, jsonb),
  public.verificar_saldos()
to authenticated;
