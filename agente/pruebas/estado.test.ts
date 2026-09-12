import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { Bajas, Limites, palabraClave, Vistos } from '../src/estado.ts';
import { costoUsd, fechaLocal, Gasto } from '../src/gasto.ts';
import type { Entrada } from '../src/historial.ts';
import { Historial, podar } from '../src/historial.ts';
import { CLIENTE, dirTemporal } from './utiles.ts';

const e = (texto: string, rol: 'cliente' | 'agente' = 'cliente', t = '2026-09-12T12:00:00Z'): Entrada => ({ t, rol, texto });

test('poda: sólo las últimas N vueltas', () => {
  const entradas = Array.from({ length: 30 }, (_, i) => e(`m${i}`, i % 2 ? 'agente' : 'cliente'));
  const p = podar(entradas, 3, 10_000);
  assert.equal(p.length, 6);
  assert.equal(p[0].texto, 'm24');
  assert.equal(p.at(-1)?.texto, 'm29');
});

test('poda: el total de caracteres no pasa del tope, y la última entrada siempre queda', () => {
  const entradas = [e('a'.repeat(400)), e('b'.repeat(400), 'agente'), e('c'.repeat(300))];
  const p = podar(entradas, 10, 750);
  assert.deepEqual(p.map((x) => x.texto[0]), ['b', 'c']);
  const sola = podar([e('z'.repeat(2000))], 10, 500);
  assert.equal(sola.length, 1);
  assert.equal(sola[0].texto.length, 500);
});

test('historial: se poda al escribir y se guarda en JSON Lines', () => {
  const dir = dirTemporal();
  const h = new Historial(dir, { vueltas: 2, caracteres: 10_000, retencionDias: 30 });
  for (let i = 0; i < 10; i++) h.anexar(CLIENTE, e(`m${i}`, i % 2 ? 'agente' : 'cliente', new Date().toISOString()));
  const archivo = h.archivo(CLIENTE);
  assert.equal(path.basename(archivo), '5215500000001.jsonl');
  const lineas = fs.readFileSync(archivo, 'utf8').trim().split('\n');
  assert.equal(lineas.length, 4);
  assert.equal(JSON.parse(lineas[0]).texto, 'm6');
  assert.equal((fs.statSync(archivo).mode & 0o777).toString(8), '600');
});

test('historial: retención de 30 días — lo más viejo se borra, y el archivo vacío desaparece', () => {
  const dir = dirTemporal();
  const h = new Historial(dir, { vueltas: 50, caracteres: 100_000, retencionDias: 30 });
  const ahora = new Date('2026-09-12T12:00:00Z');
  h.anexar(CLIENTE, e('viejo', 'cliente', '2026-08-01T12:00:00Z'));
  h.anexar(CLIENTE, e('reciente', 'cliente', '2026-09-10T12:00:00Z'));
  h.anexar('5215500000003', e('muy viejo', 'cliente', '2026-07-01T00:00:00Z'));
  assert.equal(h.aplicarRetencion(ahora), 2);
  assert.deepEqual(h.leer(CLIENTE, ahora).map((x) => x.texto), ['reciente']);
  assert.equal(fs.existsSync(h.archivo('5215500000003')), false);
});

test('deduplicación: el mismo wamid sólo pasa una vez, también tras reiniciar', () => {
  const dir = dirTemporal();
  const v = new Vistos(dir, 30);
  assert.equal(v.marcar('wamid.A'), true);
  assert.equal(v.marcar('wamid.A'), false);
  const v2 = new Vistos(dir, 30);
  assert.equal(v2.marcar('wamid.A'), false);
  assert.equal(v2.marcar('wamid.B'), true);
  v2.compactar(new Date(Date.now() + 31 * 86_400_000));
  assert.equal(new Vistos(dir, 30).ya('wamid.A'), false);
});

test('BAJA/STOP: sólo si el mensaje entero es la palabra', () => {
  for (const t of ['BAJA', 'baja', ' Baja. ', 'STOP', 'stop!', 'Alto', 'dar de baja', 'Unsubscribe']) assert.equal(palabraClave(t), 'baja', t);
  for (const t of ['ALTA', 'start', 'Reanudar']) assert.equal(palabraClave(t), 'alta', t);
  for (const t of ['quiero dar de baja mi sesión', 'hola', 'no pares', 'alto contraste']) assert.equal(palabraClave(t), undefined, t);
});

test('bajas: persisten en disco', () => {
  const dir = dirTemporal();
  const b = new Bajas(dir);
  b.darDeBaja(CLIENTE);
  assert.equal(new Bajas(dir).es(CLIENTE), true);
  new Bajas(dir).darDeAlta(CLIENTE);
  assert.equal(new Bajas(dir).es(CLIENTE), false);
});

test('límites: por número y global, en ventana de una hora', () => {
  const l = new Limites(2, 3);
  const t0 = new Date('2026-09-12T12:00:00Z');
  assert.equal(l.permitir('a', t0).ok, true);
  assert.equal(l.permitir('a', t0).ok, true);
  assert.deepEqual(l.permitir('a', t0), { ok: false, motivo: 'numero' });
  assert.equal(l.permitir('b', t0).ok, true);
  assert.deepEqual(l.permitir('c', t0), { ok: false, motivo: 'global' });
  assert.equal(l.permitir('a', new Date(t0.getTime() + 3_601_000)).ok, true);
});

const PRECIOS = { entradaCache: 0.006, entrada: 0.3, salida: 1.2 };

test('gasto: costo = tokens × precio', () => {
  // 1M de entrada sin caché + 1M de caché + 1M de salida = 0.3 + 0.006 + 1.2
  assert.equal(costoUsd({ entrada: 1_000_000, entradaCache: 1_000_000, salida: 1_000_000 }, PRECIOS), 1.506);
});

test('tope de gasto: se reserva el peor caso y se niega lo que no cabe', () => {
  const g = new Gasto(dirTemporal(), 0.001, PRECIOS, 'America/Mexico_City');
  const ahora = new Date('2026-09-12T18:00:00Z');
  const peor = g.estimarMaximo(2000, 400); // 1000 tok × 0.3 + 400 × 1.2 = 0.00078
  assert.ok(Math.abs(peor - 0.00078) < 1e-12);
  assert.equal(g.reservar(peor, ahora), true);
  assert.equal(g.reservar(peor, ahora), false, 'dos reservas simultáneas no caben');
  g.liquidar(peor, { entrada: 500, entradaCache: 0, salida: 100 }, ahora); // 0.00027
  assert.equal(g.reservar(peor, ahora), false, '0.00027 + 0.00078 > 0.001');
  assert.equal(g.reservar(0.0005, ahora), true);
});

test('tope de gasto: el día es el de la Ciudad de México y se reinicia a medianoche de allá', () => {
  const g = new Gasto(dirTemporal(), 0.001, PRECIOS, 'America/Mexico_City');
  // 05:30 UTC del 13 = 23:30 del 12 en CDMX (UTC−6)
  const noche = new Date('2026-09-13T05:30:00Z');
  assert.equal(fechaLocal(noche, 'America/Mexico_City'), '2026-09-12');
  g.liquidar(0, { entrada: 10_000, entradaCache: 0, salida: 0 }, noche); // 0.003 > tope
  assert.equal(g.reservar(0.0001, noche), false);
  const manana = new Date('2026-09-13T06:30:00Z'); // 00:30 del 13 en CDMX
  assert.equal(g.reservar(0.0001, manana), true);
});
