-- =====================================================================
-- Inventario de Eventos · 3/3 · Seguridad (RLS, permisos) y vistas
-- =====================================================================

-- ---------------------------------------------------------------------
-- Row Level Security en todas las tablas
-- ---------------------------------------------------------------------
alter table public.perfiles      enable row level security;
alter table public.perfiles_pin  enable row level security;
alter table public.variantes     enable row level security;
alter table public.eventos       enable row level security;
alter table public.evento_items  enable row level security;
alter table public.movimientos   enable row level security;
alter table public.incidencias   enable row level security;
alter table public.operaciones   enable row level security;
alter table public.auditoria     enable row level security;

-- Lectura: solo usuarios aprobados (activos y con rol). Un usuario
-- pendiente solo ve su propio perfil (para mostrar "en espera de aprobación").
create policy perfiles_leer on public.perfiles for select to authenticated
  using (id = auth.uid() or public._es_activo());
create policy variantes_leer on public.variantes for select to authenticated using (public._es_activo());
create policy eventos_leer on public.eventos for select to authenticated using (public._es_activo());
create policy evento_items_leer on public.evento_items for select to authenticated using (public._es_activo());
create policy movimientos_leer on public.movimientos for select to authenticated using (public._es_activo());
create policy incidencias_leer on public.incidencias for select to authenticated using (public._es_activo());
-- Bitácora: el administrador ve todo; salidas/recogidas solo lo suyo; solo lectura nada.
create policy auditoria_leer on public.auditoria for select to authenticated
  using (public._es_admin()
         or (usuario_id = auth.uid() and public._tiene(array['salidas','recogidas'])));
-- perfiles_pin y operaciones: sin políticas → inaccesibles desde la app.

-- No hay políticas de INSERT/UPDATE/DELETE: toda escritura pasa por las
-- funciones del archivo 2/3, que validan rol, estado y disponibilidad.

-- ---------------------------------------------------------------------
-- Vistas de consulta (respetan RLS del usuario que consulta)
-- ---------------------------------------------------------------------
create or replace view public.v_inventario with (security_invoker = true) as
select v.*,
       public._reservado(v.id) as reservado,
       v.existencia - public._reservado(v.id) as disponible,
       coalesce((select sum(greatest(0, ei.entregada - ei.regresada - ei.baja))
                 from public.evento_items ei join public.eventos e on e.id = ei.evento_id
                 where ei.variante_id = v.id and e.estado <> 'cerrado'), 0)::integer as en_eventos
from public.variantes v;

create or replace view public.v_evento_items with (security_invoker = true) as
select ei.*,
       e.nombre as evento_nombre, e.estado as evento_estado,
       v.nombre, v.sku, v.categoria, v.color_nombre, v.color_hex, v.medida, v.unidad_medida,
       v.unidad_inventario, v.existencia,
       v.existencia - public._reservado(v.id, ei.evento_id) as disponible_para_evento,
       greatest(0, ei.cantidad_planeada - ei.entregada) as por_entregar,
       greatest(0, ei.entregada - ei.regresada - ei.baja) as por_recoger,
       greatest(0, ei.regresada - ei.entregada) as sobrante,
       greatest(0, ei.entregada - ei.regresada) as faltante,
       ei.regresada - ei.entregada as diferencia,
       case
         when ei.entregada = 0 and ei.regresada = 0 then 'sin_salida'
         when ei.regresada = 0 then 'pendiente'
         when ei.danada > ei.danado_revisado then 'danado'
         when ei.regresada > ei.entregada + ei.sobrante_aceptado then 'sobrante'
         when ei.regresada + ei.baja < ei.entregada then
              case when e.conteo_terminado then 'faltante' else 'parcial' end
         else 'completo'
       end as estado_conciliacion,
       exists (select 1 from public.incidencias i
               where i.evento_id = ei.evento_id and i.variante_id = ei.variante_id
                 and i.estado in ('pendiente','investigacion')) as por_revisar
from public.evento_items ei
join public.eventos e on e.id = ei.evento_id
join public.variantes v on v.id = ei.variante_id;

create or replace view public.v_eventos with (security_invoker = true) as
select e.*,
       p.nombre as creado_por_nombre,
       pc.nombre as cerrado_por_nombre,
       coalesce(s.articulos, 0) as articulos,
       coalesce(s.planeada, 0) as total_planeado,
       coalesce(s.entregada, 0) as total_entregado,
       coalesce(s.regresada, 0) as total_regresado,
       coalesce(s.por_recoger, 0) as total_por_recoger,
       (select count(*) from public.incidencias i
        where i.evento_id = e.id and i.estado in ('pendiente','investigacion'))::integer as incidencias_abiertas
from public.eventos e
left join public.perfiles p on p.id = e.created_by
left join public.perfiles pc on pc.id = e.cerrado_por
left join lateral (
  select count(*)::integer articulos, sum(cantidad_planeada)::integer planeada, sum(entregada)::integer entregada,
         sum(regresada)::integer regresada, sum(greatest(0, entregada - regresada - baja))::integer por_recoger
  from public.evento_items where evento_id = e.id
) s on true;

create or replace view public.v_movimientos with (security_invoker = true) as
select m.*, p.nombre as usuario_nombre, v.nombre as variante_nombre, v.color_nombre, v.color_hex,
       v.medida, v.unidad_medida, e.nombre as evento_nombre,
       exists (select 1 from public.movimientos r where r.revierte_a = m.id) as revertido
from public.movimientos m
join public.perfiles p on p.id = m.usuario_id
join public.variantes v on v.id = m.variante_id
left join public.eventos e on e.id = m.evento_id;

create or replace view public.v_incidencias with (security_invoker = true) as
select i.*, v.nombre as variante_nombre, v.color_nombre, v.color_hex, v.medida, v.unidad_medida,
       e.nombre as evento_nombre, e.estado as evento_estado,
       pr.nombre as reportado_por_nombre, pv.nombre as revisado_por_nombre
from public.incidencias i
join public.variantes v on v.id = i.variante_id
join public.eventos e on e.id = i.evento_id
left join public.perfiles pr on pr.id = i.reportado_por
left join public.perfiles pv on pv.id = i.revisado_por;

create or replace view public.v_auditoria with (security_invoker = true) as
select a.*, e.nombre as evento_nombre, v.nombre as variante_nombre
from public.auditoria a
left join public.eventos e on e.id = a.evento_id
left join public.variantes v on v.id = a.variante_id;

-- ---------------------------------------------------------------------
-- Permisos de objetos
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;

grant select on public.perfiles, public.variantes, public.eventos, public.evento_items,
                public.movimientos, public.incidencias, public.auditoria to authenticated;
grant select on public.v_inventario, public.v_evento_items, public.v_eventos,
                public.v_movimientos, public.v_incidencias, public.v_auditoria to authenticated;

-- Funciones de solo lectura que usan las políticas y vistas
grant execute on function public._es_activo(), public._es_admin(), public._tiene(text[]),
                          public._reservado(uuid, uuid) to authenticated;

-- Operaciones públicas de la app
grant execute on function
  public.registrar_acceso(jsonb),
  public.establecer_pin(uuid, jsonb),
  public.verificar_pin(jsonb),
  public.actualizar_usuario(uuid, jsonb),
  public.restablecer_acceso(uuid, jsonb),
  public.guardar_variante(uuid, jsonb),
  public.ajustar_existencia(uuid, jsonb),
  public.guardar_evento(uuid, jsonb),
  public.planear_item(uuid, jsonb),
  public.cambiar_estado_evento(uuid, jsonb),
  public.registrar_salida(uuid, jsonb),
  public.registrar_recogida(uuid, jsonb),
  public.terminar_conteo(uuid, jsonb),
  public.revertir_movimiento(uuid, jsonb),
  public.transferir_entre_eventos(uuid, jsonb),
  public.resolver_incidencia(uuid, jsonb),
  public.verificar_saldos()
to authenticated;

-- Las funciones internas (_auditar, _idem_*, _fallar, _recalcular, …) NO
-- son ejecutables desde la app: nadie puede escribir en la bitácora
-- directamente ni saltarse las validaciones.

-- ---------------------------------------------------------------------
-- "Latido" para que el proyecto gratuito de Supabase no se pause por
-- inactividad. Lo llama una tarea diaria de GitHub Actions. No expone datos.
-- ---------------------------------------------------------------------
create or replace function public.ping() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when exists (select 1 from public.eventos) then 'ok' else 'ok' end
$$;
revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
