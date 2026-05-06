-- ANTE 0003 — Precio final manual, comprobante 50% y aviso pre-archivado
-- Aplicar en Supabase SQL Editor.

-- precio_final: si está set, gana sobre el cálculo paquete + extras (descuentos, paquetes a la medida)
alter table sesiones add column if not exists precio_final numeric(10,2);

-- comprobante_50_url: URL pública en R2 al comprobante de pago del anticipo (50%)
alter table sesiones add column if not exists comprobante_50_url text;

-- email_archivo_aviso_enviado: para no mandar el aviso de "se archiva en 7 días" más de una vez
alter table sesiones add column if not exists email_archivo_aviso_enviado boolean not null default false;
