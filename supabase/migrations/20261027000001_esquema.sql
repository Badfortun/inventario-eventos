-- =====================================================================
-- Inventario de Eventos v2 · 1/3 · Esquema
-- Modelo: el material siempre está en un LUGAR (Almacén, Reparación o un
-- Evento). Todo cambio es un MOVIMIENTO de un lugar a otro.
-- Las escrituras solo se hacen por las funciones del archivo 2/3.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Usuarios
--   admin     → todo; autoriza traslados entre eventos
--   salidas   → Almacén → Evento; solicita traslados entre eventos
--   recogidas → Evento → Almacén/Reparación; Reparación → Almacén;
--               marca material escaneado; solicita traslados entre eventos
--   lectura   → solo consulta
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Lugares
-- ---------------------------------------------------------------------
create table public.lugares (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null check (tipo in ('almacen','reparacion','evento','perdida','baja')),
  nombre      text not null check (length(trim(nombre)) > 0),
  fecha       date,
  fecha_fin   date,
  ubicacion   text,
  notas       text,
  estado      text not null default 'abierto' check (estado in ('abierto','cerrado')),
  created_by  uuid references public.perfiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  cerrado_por uuid references public.perfiles(id),
  cerrado_at  timestamptz,
  check (tipo = 'evento' or (fecha is null and estado = 'abierto')),
  check (tipo <> 'evento' or fecha is not null)
);
-- Un solo Almacén, una sola Reparación, etc.
create unique index lugares_fijos on public.lugares(tipo) where tipo <> 'evento';

insert into public.lugares (tipo, nombre) values
  ('almacen', 'Almacén'),
  ('reparacion', 'Reparación'),
  ('perdida', 'Pérdidas'),
  ('baja', 'Dados de baja');

-- ---------------------------------------------------------------------
-- Artículos (cada uno con su propio código)
-- ---------------------------------------------------------------------
create table public.articulos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique check (length(trim(codigo)) > 0),
  nombre        text not null check (length(trim(nombre)) > 0),
  categoria     text,
  unidad        text not null default 'pieza',
  color_nombre  text,
  color_hex     text check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  medida        numeric(12,2) check (medida is null or medida > 0),
  unidad_medida text,
  tamano        text,
  marca_modelo  text,
  notas         text,
  activo        boolean not null default true,
  created_by    uuid references public.perfiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Existencias: cuántas piezas de cada artículo hay en cada lugar
-- ---------------------------------------------------------------------
create table public.existencias (
  lugar_id     uuid not null references public.lugares(id),
  articulo_id  uuid not null references public.articulos(id),
  cantidad     integer not null default 0 check (cantidad >= 0),
  sin_escanear integer not null default 0 check (sin_escanear >= 0),
  updated_at   timestamptz not null default now(),
  primary key (lugar_id, articulo_id),
  check (sin_escanear <= cantidad)
);
create index existencias_articulo on public.existencias(articulo_id);

-- ---------------------------------------------------------------------
-- Movimientos
-- tipo:
--   traslado    de un lugar a otro (salida, regreso, entre eventos, reparación)
--   alta        material nuevo que entra al Almacén
--   ajuste      corrección autorizada de existencia en un lugar
--   perdida     lo que quedó en un evento al cerrarlo
--   baja        material dado de baja (ya no sirve)
--   correccion  anula un movimiento anterior (no se borra nada)
--   escaneo     material del Almacén que se escaneó después de llegar
-- estado:
--   aplicado | por_autorizar (traslado entre eventos) | rechazado | revertido
-- ---------------------------------------------------------------------
create table public.movimientos (
  id                  uuid primary key default gen_random_uuid(),
  operacion_id        uuid not null,
  tipo                text not null check (tipo in ('traslado','alta','ajuste','perdida','baja','correccion','escaneo')),
  estado              text not null default 'aplicado' check (estado in ('aplicado','por_autorizar','rechazado','revertido')),
  origen_id           uuid references public.lugares(id),
  destino_id          uuid references public.lugares(id),
  escaneo_salida      text check (escaneo_salida in ('escaneado','sin_escaneo')),
  escaneo_salida_por  uuid references public.perfiles(id),
  escaneo_entrada     text check (escaneo_entrada in ('escaneado','sin_escaneo')),
  escaneo_entrada_por uuid references public.perfiles(id),
  notas               text,
  motivo              text,
  registrado_por      uuid not null references public.perfiles(id),
  dispositivo         text,
  created_at          timestamptz not null default now(),
  autorizado_por      uuid references public.perfiles(id),
  autorizado_at       timestamptz,
  rechazo_motivo      text,
  revierte_a          uuid references public.movimientos(id),
  revertido_por       uuid references public.perfiles(id),
  revertido_at        timestamptz,
  check (origen_id is distinct from destino_id or tipo = 'escaneo'),
  check (escaneo_salida <> 'escaneado' or escaneo_salida_por is not null),
  check (escaneo_entrada <> 'escaneado' or escaneo_entrada_por is not null)
);
create index movimientos_origen on public.movimientos(origen_id, created_at desc);
create index movimientos_destino on public.movimientos(destino_id, created_at desc);
create index movimientos_estado on public.movimientos(estado) where estado = 'por_autorizar';
create index movimientos_fecha on public.movimientos(created_at desc);
create unique index movimientos_una_correccion on public.movimientos(revierte_a) where revierte_a is not null;

create table public.movimiento_items (
  id             uuid primary key default gen_random_uuid(),
  movimiento_id  uuid not null references public.movimientos(id),
  articulo_id    uuid not null references public.articulos(id),
  cantidad       integer not null check (cantidad > 0),          -- piezas contadas en el movimiento
  danadas        integer not null default 0 check (danadas >= 0), -- de esas, cuántas llegaron dañadas (van a Reparación)
  sobrante       integer not null default 0 check (sobrante >= 0),-- de esas, cuántas no estaban registradas en el origen
  unique (movimiento_id, articulo_id),
  check (danadas <= cantidad),
  check (sobrante <= cantidad)
);
create index movimiento_items_articulo on public.movimiento_items(articulo_id);

-- Libro de cambios de existencia: cada cambio de cantidad deja un asiento.
-- Sirve para comprobar que las existencias cuadran con el historial.
create table public.asientos (
  id             bigint generated always as identity primary key,
  movimiento_id  uuid not null references public.movimientos(id),
  lugar_id       uuid not null references public.lugares(id),
  articulo_id    uuid not null references public.articulos(id),
  delta          integer not null check (delta <> 0),
  created_at     timestamptz not null default now()
);
create index asientos_lugar_articulo on public.asientos(lugar_id, articulo_id);

-- ---------------------------------------------------------------------
-- Idempotencia y bitácora
-- ---------------------------------------------------------------------
create table public.operaciones (
  id          uuid primary key,
  funcion     text not null,
  usuario_id  uuid not null,
  resultado   jsonb,
  created_at  timestamptz not null default now()
);

create table public.auditoria (
  id              bigint generated always as identity primary key,
  usuario_id      uuid,
  usuario_nombre  text,
  accion          text not null,
  exito           boolean not null default true,
  entidad         text,
  entidad_id      uuid,
  lugar_id        uuid,
  articulo_id     uuid,
  antes           jsonb,
  despues         jsonb,
  motivo          text,
  detalle         text,
  dispositivo     text,
  created_at      timestamptz not null default now()
);
create index auditoria_fecha on public.auditoria(created_at desc);
create index auditoria_usuario on public.auditoria(usuario_id, created_at desc);

-- ---------------------------------------------------------------------
-- Protección del historial
-- ---------------------------------------------------------------------
create or replace function public._bloquear_cambios() returns trigger
language plpgsql as $$
begin
  raise exception 'La tabla % no admite %: el historial no se modifica', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end $$;

-- Bitácora, asientos y renglones de movimientos: solo agregar
create trigger auditoria_inmutable before update or delete on public.auditoria for each row execute function public._bloquear_cambios();
create trigger auditoria_sin_truncate before truncate on public.auditoria for each statement execute function public._bloquear_cambios();
create trigger asientos_inmutable before update or delete on public.asientos for each row execute function public._bloquear_cambios();
create trigger asientos_sin_truncate before truncate on public.asientos for each statement execute function public._bloquear_cambios();
create trigger items_inmutable before update or delete on public.movimiento_items for each row execute function public._bloquear_cambios();
create trigger items_sin_truncate before truncate on public.movimiento_items for each statement execute function public._bloquear_cambios();
create trigger movimientos_sin_borrar before delete on public.movimientos for each row execute function public._bloquear_cambios();
create trigger movimientos_sin_truncate before truncate on public.movimientos for each statement execute function public._bloquear_cambios();

-- De un movimiento solo puede cambiar su estado (autorizar, rechazar, revertir)
create or replace function public._movimiento_solo_estado() returns trigger
language plpgsql as $$
begin
  if (new.operacion_id, new.tipo, new.origen_id, new.destino_id, new.escaneo_salida, new.escaneo_salida_por,
      new.escaneo_entrada, new.escaneo_entrada_por, new.notas, new.motivo, new.registrado_por, new.created_at, new.revierte_a)
     is distinct from
     (old.operacion_id, old.tipo, old.origen_id, old.destino_id, old.escaneo_salida, old.escaneo_salida_por,
      old.escaneo_entrada, old.escaneo_entrada_por, old.notas, old.motivo, old.registrado_por, old.created_at, old.revierte_a) then
    raise exception 'Solo se puede cambiar el estado de un movimiento' using errcode = 'insufficient_privilege';
  end if;
  if not ((old.estado = 'por_autorizar' and new.estado in ('aplicado','rechazado'))
          or (old.estado = 'aplicado' and new.estado = 'revertido')
          or old.estado = new.estado) then
    raise exception 'Cambio de estado no permitido: % → %', old.estado, new.estado using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger movimientos_solo_estado before update on public.movimientos for each row execute function public._movimiento_solo_estado();

-- ---------------------------------------------------------------------
-- Alta de usuarios: quien se registra queda pendiente; el primero es admin
-- ---------------------------------------------------------------------
create or replace function public._nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_primero boolean;
  v_usuario text;
  v_nombre text;
begin
  perform pg_advisory_xact_lock(hashtext('alta_usuarios'));
  select not exists (select 1 from public.perfiles) into v_primero;
  v_usuario := lower(coalesce(nullif(new.raw_user_meta_data->>'usuario',''), split_part(new.email,'@',1)));
  v_nombre := coalesce(nullif(new.raw_user_meta_data->>'nombre',''), v_usuario);
  insert into public.perfiles (id, usuario, nombre, roles, activo)
  values (new.id, v_usuario, v_nombre,
          case when v_primero then array['admin'] else '{}'::text[] end, v_primero);
  insert into public.auditoria (usuario_id, usuario_nombre, accion, entidad, entidad_id, despues)
  values (new.id, v_nombre, case when v_primero then 'alta_primer_administrador' else 'registro_usuario' end,
          'perfil', new.id, jsonb_build_object('usuario', v_usuario, 'activo', v_primero));
  return new;
end $$;

create trigger al_registrar_usuario after insert on auth.users
  for each row execute function public._nuevo_usuario();
