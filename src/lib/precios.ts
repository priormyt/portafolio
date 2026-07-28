// Fuente de verdad de los precios públicos de ANTE.
//
// El home es estático (`output: 'static'`), así que no puede leer Supabase en
// cada request: el catálogo público vive aquí y se congela en cada deploy.
// La tabla `paquetes` sigue siendo la fuente para /agendar, que sí es SSR y
// necesita el uuid del paquete para el lead. Si cambias un precio aquí,
// actualiza también `precio_base` en la base (ver 0005_precios_paquetes.sql).
//
// Referencia: public/img/lista-precios.jpg (lista 2026). Ojo: las duraciones de
// Estándar y Completo aquí (60 y 90 min) son las vigentes y no coinciden con las
// del JPG (45 y 60); si vuelves a exportar la lista, actualízala con estas.

export interface PaquetePublico {
  /** Coincide con `paquetes.nombre` en Supabase. */
  nombre: string;
  precio: number;
  fotos: number;
  duracionMin: number;
  looks: number;
  /** Una línea sobre para quién es. No sale de la lista; es copy del sitio. */
  para: string;
}

export const PAQUETES: PaquetePublico[] = [
  {
    nombre: 'Básico',
    precio: 1800,
    fotos: 2,
    duracionMin: 30,
    looks: 1,
    para: 'Una foto de perfil que aguante años.',
  },
  {
    nombre: 'Estándar',
    precio: 2400,
    fotos: 5,
    duracionMin: 60,
    looks: 2,
    para: 'Perfil, presentaciones y algo de dónde escoger.',
  },
  {
    nombre: 'Completo',
    precio: 3000,
    fotos: 10,
    duracionMin: 90,
    looks: 3,
    para: 'Material completo para portafolio, prensa y redes.',
  },
];

/** Descuento con credencial vigente, aplica a todos los paquetes. */
export const DESCUENTO_ESTUDIANTE = 0.5;

export const ANTICIPO = 0.5;

export const PRECIO_DESDE = Math.min(...PAQUETES.map((p) => p.precio));
export const PRECIO_HASTA = Math.max(...PAQUETES.map((p) => p.precio));
export const PRECIO_DESDE_ESTUDIANTE = PRECIO_DESDE * (1 - DESCUENTO_ESTUDIANTE);

/** 1800 → "$1,800". Sin decimales: todos los precios son cerrados. */
export function formatMXN(n: number): string {
  return `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}

export function precioEstudiante(precio: number): number {
  return precio * (1 - DESCUENTO_ESTUDIANTE);
}
