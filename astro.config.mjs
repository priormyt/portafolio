// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// Solo estas rutas son públicas e indexables. Todo lo demás (/admin, /clientes,
// las galerías privadas por código, /404) queda fuera del sitemap.
const publicas = ['/', '/agendar', '/aviso-privacidad', '/contacto', '/fotografia-corporativa', '/galeria', '/mas', '/nosotros'];

// build.format: 'file' emite /galeria.html, pero el canonical del Layout apunta
// a /galeria. El sitemap tiene que coincidir con el canonical, no con el archivo.
const rutaDe = (url) =>
  new URL(url).pathname.replace(/index\.html$/, '').replace(/\.html$/, '') || '/';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.ante.photo',
  output: 'static',
  adapter: cloudflare({
    imageService: 'compile',
  }),
  build: {
    format: 'file',
  },
  integrations: [
    sitemap({
      filter: (page) => publicas.includes(rutaDe(page)),
      serialize(item) {
        item.url = new URL(item.url).origin + rutaDe(item.url);
        return item;
      },
    }),
  ],
});
