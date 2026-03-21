// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://priormyt.github.io',
  base: '/portafolio',
  build: {
    format: 'file'
  }
});
