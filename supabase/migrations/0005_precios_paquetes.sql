-- Alinea la tabla `paquetes` con la lista de precios 2026
-- (public/img/lista-precios.jpg) y con src/lib/precios.ts.
--
-- La semilla de 0001_init.sql dejó `precio_base` en NULL y quedó desfasada en
-- las duraciones. El admin usa `precio_base` para calcular el total de la
-- sesión, así que sin esto sigue cotizando sobre NULL.

update paquetes set precio_base = 1800, fotos_incluidas = 2,  duracion_min = 30, looks = 1
  where nombre = 'Básico';
update paquetes set precio_base = 2400, fotos_incluidas = 5,  duracion_min = 60, looks = 2
  where nombre = 'Estándar';
update paquetes set precio_base = 3000, fotos_incluidas = 10, duracion_min = 90, looks = 3
  where nombre = 'Completo';
