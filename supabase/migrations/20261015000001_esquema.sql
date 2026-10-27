-- =====================================================================
-- Inventario de Eventos · 1/3 · Esquema
-- Tablas, restricciones, historial append-only y bitácora inmutable.
-- Todas las escrituras se hacen por funciones (archivo 2/3); el cliente
-- solo tiene permiso de lectura sobre las tablas (archivo 3/3).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Usuarios
-- ---------------------------------------------------------------------
-- Roles disponibles:
--   admin      → todo
--   salidas    → registrar salidas a eventos
--   recogidas  → registrar recogidas, terminar conteo y reportar diferencias
--   lectura    → solo consulta
create table public.perfiles (
  id          uuid primary key references auth.users(id) on delete restrict,
  usuario     text not null unique,
  nombre      text not null,
  roles       text[] not null default '{}',
  activo      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint roles_validos check (roles <@ array['admin','salidas','recogidas','lectura']::text[])
);
comment on table public.perfiles is 'Un registro por persona. Nadie se borra: se desactiva.';

-- PIN de confirmación (separado para que nunca sea legible desde el cliente)
create table public.perfiles_pin (
  usuario_id  uuid primary key references public.perfiles(id),
  pin_hash    text not null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
create table public.variantes (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null check (length(trim(nombre)) > 0),
  sku                text unique,
  categoria          text,
  descripcion        text,
  color_nombre       text,
  color_hex          text check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  medida             numeric(12,2) check (medida is null or medida > 0),
  unidad_medida      text,                       -- pies, metros, pulgadas…
  unidad_inventario  text not null default 'pieza',
  marca_modelo       text,
  numero_serie       text,
  ubicacion          text,
  foto_url           text,
  notas              text,
  activo             boolean not null default true,
  -- Existencia física en almacén. Solo la modifican las funciones de
  -- movimientos; siempre es igual a la suma de movimientos.efecto_existencia.
  existencia         integer not null default 0,
  created_by         uuid references public.perfiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index variantes_busqueda on public.variantes
  using gin (to_tsvector('spanish', coalesce(nombre,'')||' '||coalesce(sku,'')||' '||coalesce(categoria,'')||' '||coalesce(color_nombre,'')));

-- ---------------------------------------------------------------------
-- Eventos
-- ---------------------------------------------------------------------
-- Estados:
--   borrador  → se arma la lista; no reserva existencia
--   activo    → reserva existencia; se registran salidas (y recogidas tempranas)
--   recogida  → regreso de material, conteo y revisión de diferencias
--   cerrado   → solo lectura; se puede reabrir con autorización
create table public.eventos (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null check (length(trim(nombre)) > 0),
  fecha            date not null,
  ubicacion        text,
  notas            text,
  estado           text not null default 'borrador'
                   check (estado in ('borrador','activo','recogida','cerrado')),
  conteo_terminado boolean not null default false,
  created_by       uuid references public.perfiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  cerrado_por      uuid references public.perfiles(id),
  cerrado_at       timestamptz,
  cierre_forzado   boolean not null default false
);

create table public.evento_items (
  id                 uuid primary key default gen_random_uuid(),
  evento_id          uuid not null references public.eventos(id),
  variante_id        uuid not null references public.variantes(id),
  cantidad_planeada  integer not null default 0 check (cantidad_planeada >= 0),
  -- Totales mantenidos por las funciones (reconstruibles desde movimientos)
  entregada          integer not null default 0 check (entregada >= 0),
  regresada          integer not null default 0 check (regresada >= 0),  -- contada de regreso (buena + dañada)
  danada             integer not null default 0 check (danada >= 0),     -- parte de "regresada" que volvió dañada
  baja               integer not null default 0 check (baja >= 0),       -- faltante aprobado como pérdida
  sobrante_aceptado  integer not null default 0 check (sobrante_aceptado >= 0),
  danado_revisado    integer not null default 0 check (danado_revisado >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (evento_id, variante_id),
  check (danada <= regresada)
);
create index evento_items_variante on public.evento_items(variante_id);

-- ---------------------------------------------------------------------
-- Movimientos (historial append-only)
-- ---------------------------------------------------------------------
-- tipo:
--   entrada        alta inicial o compra                    efecto +n
--   ajuste         corrección autorizada de existencia      efecto ±n
--   salida         material que sale a un evento            efecto −n
--   devolucion     material contado de regreso              efecto +n
--   reversion      corrige un movimiento anterior           efecto = −efecto original
--   transferencia  reclasifica conteo entre eventos         efecto 0
--   baja           faltante aprobado como pérdida           efecto 0
--   retiro_dano    material dañado retirado del inventario  efecto −n
create table public.movimientos (
  id                 uuid primary key default gen_random_uuid(),
  operacion_id       uuid not null,             -- clave de idempotencia de la operación que lo creó
  tipo               text not null check (tipo in
                     ('entrada','ajuste','salida','devolucion','reversion','transferencia','baja','retiro_dano')),
  variante_id        uuid not null references public.variantes(id),
  evento_id          uuid references public.eventos(id),
  cantidad           integer not null check (cantidad <> 0),
  efecto_existencia  integer not null,
  condicion          text check (condicion in ('buena','danada')),
  forzado            boolean not null default false,
  motivo             text,
  revierte_a         uuid references public.movimientos(id),
  usuario_id         uuid not null references public.perfiles(id),
  dispositivo        text,
  hora_local         timestamptz,               -- hora del celular (si se capturó sin conexión)
  created_at         timestamptz not null default now()  -- hora del servidor
);
create index movimientos_variante on public.movimientos(variante_id, created_at desc);
create index movimientos_evento on public.movimientos(evento_id, created_at desc);
create index movimientos_usuario on public.movimientos(usuario_id, created_at desc);
-- Un movimiento solo puede revertirse una vez
create unique index movimientos_una_reversion on public.movimientos(revierte_a) where revierte_a is not null;

-- ---------------------------------------------------------------------
-- Incidencias (faltantes, sobrantes, daños)
-- ---------------------------------------------------------------------
create table public.incidencias (
  id                 uuid primary key default gen_random_uuid(),
  evento_id          uuid not null references public.eventos(id),
  variante_id        uuid not null references public.variantes(id),
  tipo               text not null check (tipo in ('faltante','sobrante','dano')),
  cantidad_esperada  integer not null,
  cantidad_contada   integer not null,
  diferencia         integer not null,          -- contada − esperada
  cantidad           integer not null check (cantidad > 0),  -- unidades afectadas
  motivo             text not null default 'pendiente de investigar'
                     check (motivo in ('pendiente de investigar','pérdida confirmada','daño','préstamo',
                                       'material de otro evento','error de captura','sobrante encontrado','otro')),
  notas              text,
  estado             text not null default 'pendiente'
                     check (estado in ('pendiente','investigacion','aprobada','rechazada','resuelta')),
  accion             text,                       -- qué se hizo al aprobar
  reportado_por      uuid references public.perfiles(id),
  revisado_por       uuid references public.perfiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  revisado_at        timestamptz
);
create index incidencias_evento on public.incidencias(evento_id, estado);
-- Solo una incidencia abierta por evento/variante/tipo
create unique index incidencias_una_abierta on public.incidencias(evento_id, variante_id, tipo)
  where estado in ('pendiente','investigacion');

-- ---------------------------------------------------------------------
-- Idempotencia: cada operación del cliente trae un UUID único.
-- Si llega dos veces (doble toque, reintento sin conexión) se devuelve
-- el resultado de la primera vez sin repetir nada.
-- ---------------------------------------------------------------------
create table public.operaciones (
  id          uuid primary key,
  funcion     text not null,
  usuario_id  uuid not null,
  resultado   jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Bitácora (inmutable)
-- ---------------------------------------------------------------------
create table public.auditoria (
  id              bigint generated always as identity primary key,
  usuario_id      uuid,
  usuario_nombre  text,
  accion          text not null,
  exito           boolean not null default true,
  entidad         text,
  entidad_id      uuid,
  evento_id       uuid,
  variante_id     uuid,
  antes           jsonb,
  despues         jsonb,
  motivo          text,
  detalle         text,
  dispositivo     text,
  hora_local      timestamptz,
  operacion_id    uuid,
  created_at      timestamptz not null default now()
);
create index auditoria_fecha on public.auditoria(created_at desc);
create index auditoria_usuario on public.auditoria(usuario_id, created_at desc);
create index auditoria_evento on public.auditoria(evento_id, created_at desc);
create index auditoria_variante on public.auditoria(variante_id, created_at desc);

-- Nadie (ni el administrador, ni el dueño de la base) puede modificar o
-- borrar el historial de movimientos ni la bitácora.
create or replace function public._bloquear_cambios() returns trigger
language plpgsql as $$
begin
  raise exception 'La tabla % es de solo agregar: no se permite % ', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end $$;

create trigger auditoria_inmutable before update or delete on public.auditoria
  for each row execute function public._bloquear_cambios();
create trigger auditoria_sin_truncate before truncate on public.auditoria
  for each statement execute function public._bloquear_cambios();
create trigger movimientos_inmutable before update or delete on public.movimientos
  for each row execute function public._bloquear_cambios();
create trigger movimientos_sin_truncate before truncate on public.movimientos
  for each statement execute function public._bloquear_cambios();

-- ---------------------------------------------------------------------
-- Alta de usuarios: al registrarse alguien en la app se crea su perfil
-- INACTIVO y sin roles; el administrador lo aprueba y le asigna rol.
-- El primer usuario del sistema queda como administrador activo.
-- ---------------------------------------------------------------------
create or replace function public._nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_primero boolean;
  v_usuario text;
begin
  perform pg_advisory_xact_lock(hashtext('alta_usuarios'));
  select not exists (select 1 from public.perfiles) into v_primero;
  v_usuario := lower(coalesce(nullif(new.raw_user_meta_data->>'usuario',''), split_part(new.email,'@',1)));
  insert into public.perfiles (id, usuario, nombre, roles, activo)
  values (new.id, v_usuario,
          coalesce(nullif(new.raw_user_meta_data->>'nombre',''), v_usuario),
          case when v_primero then array['admin'] else '{}'::text[] end,
          v_primero);
  insert into public.auditoria (usuario_id, usuario_nombre, accion, entidad, entidad_id, despues)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'nombre',''), v_usuario),
          case when v_primero then 'alta_primer_administrador' else 'registro_usuario' end,
          'perfil', new.id, jsonb_build_object('usuario', v_usuario, 'activo', v_primero));
  return new;
end $$;

create trigger al_registrar_usuario after insert on auth.users
  for each row execute function public._nuevo_usuario();
