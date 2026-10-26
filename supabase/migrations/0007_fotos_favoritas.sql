alter type foto_tipo add value if not exists 'favorita';
alter table fotos add column if not exists r2_key_original text;
comment on column fotos.r2_key_original is 'Solo tipo=favorita: key en R2 del JPG de alta resolución para descarga. r2_key es la versión web.';
