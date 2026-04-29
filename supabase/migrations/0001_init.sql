-- ANTE Estudio · esquema inicial
-- Aplicar en Supabase SQL Editor (Dashboard → SQL Editor → New query → pegar todo → Run)

-- ─── Extensiones ─────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── Tabla: paquetes ─────────────────────────────────────────
create table if not exists paquetes (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null unique,
  fotos_incluidas integer not null check (fotos_incluidas > 0),
  duracion_min    integer not null check (duracion_min > 0),
  looks           integer not null check (looks > 0),
  precio_base     numeric(10,2),
  activo          boolean not null default true,
  orden           integer not null default 0,
  created_at      timestamptz not null default now()
);

-- ─── Tabla: sesiones ─────────────────────────────────────────
create type sesion_estado as enum ('seleccion', 'pago_pendiente', 'editando', 'entregada');

create table if not exists sesiones (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique,
  nombre_cliente      text not null,
  email_cliente       text,
  paquete_id          uuid references paquetes(id),
  limite_fotos        integer,
  precio_extra        numeric(10,2) not null default 200,
  estado              sesion_estado not null default 'seleccion',
  fecha_sesion        date,
  fecha_confirmacion  timestamptz,
  fecha_pago          timestamptz,
  monto_extras        numeric(10,2),
  payment_id          text,
  fecha_entrega       timestamptz,
  notas_admin         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_sesiones_codigo on sesiones (codigo);
create index if not exists idx_sesiones_estado on sesiones (estado);

-- ─── Tabla: fotos ────────────────────────────────────────────
create type foto_tipo as enum ('preview', 'final');

create table if not exists fotos (
  id                  uuid primary key default gen_random_uuid(),
  sesion_id           uuid not null references sesiones(id) on delete cascade,
  r2_key              text not null,
  tipo                foto_tipo not null,
  orden               integer not null default 0,
  original_filename   text,
  width               integer,
  height              integer,
  created_at          timestamptz not null default now(),
  unique (sesion_id, r2_key)
);

create index if not exists idx_fotos_sesion on fotos (sesion_id);
create index if not exists idx_fotos_sesion_tipo on fotos (sesion_id, tipo);

-- ─── Tabla: selecciones ──────────────────────────────────────
create table if not exists selecciones (
  id          uuid primary key default gen_random_uuid(),
  sesion_id   uuid not null references sesiones(id) on delete cascade,
  foto_id     uuid not null references fotos(id) on delete cascade,
  nota        text,
  created_at  timestamptz not null default now(),
  unique (sesion_id, foto_id)
);

create index if not exists idx_selecciones_sesion on selecciones (sesion_id);

-- ─── Tabla: admin_users ──────────────────────────────────────
create table if not exists admin_users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  created_at  timestamptz not null default now()
);

-- ─── Trigger: updated_at automático en sesiones ──────────────
create or replace function trigger_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on sesiones;
create trigger set_updated_at
  before update on sesiones
  for each row execute function trigger_set_updated_at();

-- ─── Semilla: paquetes ───────────────────────────────────────
insert into paquetes (nombre, fotos_incluidas, duracion_min, looks, orden) values
  ('Básico',   2,  30, 1, 1),
  ('Estándar', 5,  50, 2, 2),
  ('Completo', 10, 80, 3, 3)
on conflict (nombre) do nothing;

-- ─── Semilla: admin user ─────────────────────────────────────
insert into admin_users (email) values
  ('priormyt99@gmail.com')
on conflict (email) do nothing;

-- ─── Row Level Security ──────────────────────────────────────
alter table paquetes      enable row level security;
alter table sesiones      enable row level security;
alter table fotos         enable row level security;
alter table selecciones   enable row level security;
alter table admin_users   enable row level security;

-- Políticas: por ahora todas las operaciones pasan por server-side
-- (service role bypasses RLS), así que no abrimos lectura pública.
-- En fases siguientes ajustamos cuando el cliente lea con anon key.
