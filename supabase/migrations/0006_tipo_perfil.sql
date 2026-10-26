alter table sesiones
  add column if not exists tipo_perfil text not null default 'cliente'
  constraint sesiones_tipo_perfil_check check (tipo_perfil in ('cliente','amigos'));

comment on column sesiones.tipo_perfil is 'cliente = flujo con paquete/límite/pago de extras y marca de agua; amigos = sin precio, sin límite, sin marca de agua, previews HD';

create index if not exists idx_sesiones_tipo_perfil on sesiones (tipo_perfil);
