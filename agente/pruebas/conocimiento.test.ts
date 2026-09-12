// El conocimiento se escribió a mano leyendo el sitio. Esta prueba es la máquina
// que lo vigila: si alguien cambia un precio en src/lib/precios.ts y no aquí,
// se pone en rojo.

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { cargarConocimiento, promptSistema } from '../src/conocimiento.ts';
import { RAIZ_AGENTE } from '../src/config.ts';
import { ANTICIPO, DESCUENTO_ESTUDIANTE, formatMXN, PAQUETES } from '../../src/lib/precios.ts';

const c = cargarConocimiento(path.join(RAIZ_AGENTE, 'conocimiento.md'));

test('conocimiento: los paquetes coinciden con src/lib/precios.ts', () => {
  assert.equal(c.paquetes.length, PAQUETES.length);
  for (const p of PAQUETES) {
    const fila = c.paquetes.find((x) => x.nombre === p.nombre);
    assert.ok(fila, `falta ${p.nombre}`);
    assert.equal(fila.precio, `${formatMXN(p.precio)} MXN`, p.nombre);
    assert.equal(fila.estudiantes, `${formatMXN(p.precio * (1 - DESCUENTO_ESTUDIANTE))} MXN`, p.nombre);
    assert.equal(fila.anticipo, `${formatMXN(p.precio * ANTICIPO)} MXN`, p.nombre);
    assert.equal(fila.fotos, String(p.fotos), p.nombre);
    assert.equal(fila.sesion, `${p.duracionMin} min`, p.nombre);
    assert.equal(fila.looks, String(p.looks), p.nombre);
  }
  assert.ok(c.permitidos.porcentajes.has(DESCUENTO_ESTUDIANTE * 100));
  assert.ok(c.permitidos.porcentajes.has(ANTICIPO * 100));
});

test('conocimiento: el modelo no ve las rutas del repo, y no hay teléfonos ni correos', () => {
  assert.doesNotMatch(c.texto, /<!--|src\/lib|src\/pages/);
  assert.doesNotMatch(c.texto, /\+?\d{2}[\s-]?\d{2}[\s-]?\d{4}[\s-]?\d{4}/, 'teléfono');
  assert.doesNotMatch(c.texto, /@/, 'correo');
  for (const url of c.texto.match(/https?:\/\/\S+/g) ?? []) assert.match(url, /^https:\/\/www\.ante\.photo\//, url);
});

test('prompt: lleva las reglas, los marcadores y el conocimiento; lo variable va al final', () => {
  const a = promptSistema(c, { humano: 'Pablo', presentacionAparte: true, primerMensaje: true, zonaHoraria: 'America/Mexico_City', ahora: new Date('2026-09-12T18:00:00Z') });
  const b = promptSistema(c, { humano: 'Pablo', presentacionAparte: true, primerMensaje: false, zonaHoraria: 'America/Mexico_City', ahora: new Date('2026-09-13T18:00:00Z') });
  assert.match(a, /\[\[AGENDAR\|nombre=/);
  assert.match(a, /\[\[PASAR\|motivo=/);
  assert.match(a, /Nunca inventes/);
  assert.match(a, /sábado, 12 de septiembre de 2026/);
  // El prefijo (reglas + conocimiento) es idéntico entre llamadas: caché de DeepSeek.
  const corte = a.indexOf('\nAHORA\n');
  assert.ok(corte > 0);
  assert.equal(a.slice(0, corte), b.slice(0, b.indexOf('\nAHORA\n')));
});
