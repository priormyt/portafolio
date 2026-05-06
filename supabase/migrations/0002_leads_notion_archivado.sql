-- ANTE 0002 — Modelo A (leads) + sync Notion + auto-archivado a 30 días
-- Aplicar en Supabase SQL Editor (corre todo el archivo de un jalón).

-- ─── 1) Nuevos valores del enum de estado ────────────────────
-- 'lead'      → llenó form público, aún no es sesión confirmada
-- 'archivada' → se borraron las fotos pero conserva info histórica
alter type sesion_estado add value if not exists 'lead'      before 'seleccion';
alter type sesion_estado add value if not exists 'archivada' after  'entregada';

-- ─── 2) Columnas nuevas en sesiones ──────────────────────────
alter table sesiones add column if not exists telefono         text;
alter table sesiones add column if not exists handle_ig        text;
alter table sesiones add column if not exists ubicacion        text;
alter table sesiones add column if not exists fecha_preferida  date;
alter table sesiones add column if not exists es_estudiante    boolean not null default false;
alter table sesiones add column if not exists origen           text;  -- 'instagram' | 'referido' | 'web' | 'google' | 'tiktok' | 'otro'
alter table sesiones add column if not exists notas_sesion     text;
alter table sesiones add column if not exists notas_tecnicas   text;
alter table sesiones add column if not exists notion_page_id   text;
alter table sesiones add column if not exists fecha_archivado  timestamptz;

-- ─── 3) Permitir leads sin código asignado ───────────────────
-- Los leads no tienen código todavía; al convertirlos en sesión se asigna.
alter table sesiones alter column codigo drop not null;

-- ─── 4) Índices nuevos ───────────────────────────────────────
create index if not exists idx_sesiones_notion on sesiones (notion_page_id);
create index if not exists idx_sesiones_estado_fecha_entrega
  on sesiones (estado, fecha_entrega)
  where estado = 'entregada';
