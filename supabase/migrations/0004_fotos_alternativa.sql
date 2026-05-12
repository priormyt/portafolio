-- ANTE 0004 — Sub-versión alternativa por foto final
-- Aplicar en Supabase SQL Editor.
--
-- parent_foto_id: si está set, esta foto es una versión alternativa ("subversión")
-- de la foto referenciada. Solo se permite un nivel de jerarquía (no anidar alts de alts);
-- la app valida eso. Cascade delete: si se borra la principal, su alternativa se borra.

alter table fotos add column if not exists parent_foto_id uuid
  references fotos(id) on delete cascade;

create index if not exists idx_fotos_parent on fotos (parent_foto_id);
