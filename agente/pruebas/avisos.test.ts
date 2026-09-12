// Avisos a Pablo con la regla de la ventana de 24 h de WhatsApp. La Graph API
// falsa EXIGE la ventana: si el código mandara texto libre fuera de ella, el
// envío rebotaría con 131047, como en Meta.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, test } from 'node:test';
import { Avisos, MARGEN_MS, resumirParaPlantilla, VENTANA_MS } from '../src/avisos.ts';
import { ClienteMeta, mismoNumero } from '../src/meta.ts';
import type { MetaFalso } from './meta-falso.ts';
import { crearMetaFalso } from './meta-falso.ts';
import { ADMIN, ADMIN_WA_ID, capturarRegistro, dirTemporal, PHONE_ID, TOKEN_FALSO, VERSION } from './utiles.ts';

const registro = capturarRegistro();
const abiertos: MetaFalso[] = [];
after(async () => {
  for (const m of abiertos) await m.cerrar();
});

async function montar(plantilla?: { nombre: string; idioma: string }, reloj?: () => Date) {
  const m = await crearMetaFalso({ version: VERSION, phoneNumberId: PHONE_ID, token: TOKEN_FALSO, exigirVentana: true });
  abiertos.push(m);
  const cliente = new ClienteMeta({ base: m.url, version: VERSION, phoneNumberId: PHONE_ID, token: TOKEN_FALSO });
  const datos = dirTemporal();
  const a = new Avisos({ datos, admin: ADMIN.replace('+', ''), plantilla, retencionDias: 30, reloj }, cliente);
  return { m, a, datos };
}

test('ventana abierta (Pablo escribió hace poco) → texto libre', async () => {
  const { m, a } = await montar();
  a.registrarEntrante(ADMIN_WA_ID);
  m.abrirVentana(ADMIN_WA_ID);
  assert.equal(await a.avisar('📅 Solicitud de sesión'), 'texto');
  assert.equal(m.enviados(ADMIN)[0].tipo, 'text');
});

test('ventana cerrada y SIN plantilla → no se manda: queda en pendientes y el registro grita', async () => {
  const { m, a, datos } = await montar();
  registro.length = 0;
  assert.equal(await a.avisar('🙋 te pasa una conversación'), 'pendiente');
  assert.equal(m.envios.length, 0);
  assert.equal(m.rechazos.length, 0, 'ni siquiera se intentó texto libre fuera de la ventana');
  assert.equal(a.pendientes().length, 1);
  assert.ok(fs.existsSync(`${datos}/avisos-pendientes.jsonl`));
  const linea = registro.map((l) => JSON.parse(l)).find((l) => l.evento === 'aviso_admin.NO_ENTREGADO');
  assert.equal(linea?.nivel, 'error');
});

test('Pablo escribe → la ventana se abre y los pendientes salen en orden', async () => {
  const { m, a } = await montar();
  await a.avisar('primero');
  await a.avisar('segundo');
  assert.equal(a.pendientes().length, 2);
  a.registrarEntrante(ADMIN_WA_ID);
  m.abrirVentana(ADMIN_WA_ID);
  assert.equal(await a.vaciarPendientes(), 2);
  assert.deepEqual(m.enviados(ADMIN).map((e) => e.cuerpo.split('\n')[1]), ['primero', 'segundo']);
  assert.equal(a.pendientes().length, 0);
});

test('ventana cerrada CON plantilla → sale la plantilla, en una sola línea', async () => {
  const { m, a } = await montar({ nombre: 'aviso_asistente', idioma: 'es_MX' });
  assert.equal(await a.avisar('📅 Solicitud\nNombre: Laura\nSesión: Estándar'), 'plantilla');
  const e = m.enviados(ADMIN)[0];
  assert.equal(e.tipo, 'template');
  assert.equal(e.cuerpo, '[plantilla aviso_asistente/es_MX] 📅 Solicitud · Nombre: Laura · Sesión: Estándar');
});

test('si Meta rechaza el texto por la ventana (131047), se cae a plantilla o a pendientes', async () => {
  const { m, a } = await montar();
  // El agente CREE que la ventana está abierta, pero Meta no la ve (p. ej. el reloj).
  a.registrarEntrante(ADMIN_WA_ID);
  assert.equal(await a.avisar('x'), 'pendiente');
  assert.deepEqual(m.rechazos.map((r) => r.codigo), [131047]);
});

test('la ventana cuenta 24 h menos un margen', async () => {
  let ahora = new Date('2026-09-12T12:00:00Z');
  const { a } = await montar(undefined, () => ahora);
  a.registrarEntrante(ADMIN_WA_ID);
  ahora = new Date(ahora.getTime() + VENTANA_MS - MARGEN_MS - 1000);
  assert.equal(a.ventanaAdminAbierta(), true);
  ahora = new Date(ahora.getTime() + 2000);
  assert.equal(a.ventanaAdminAbierta(), false);
});

test('Pablo es Pablo aunque llegue con el «1» de móvil de México', () => {
  assert.equal(mismoNumero('5215500000009', '525500000009'), true);
  assert.equal(mismoNumero('+52 55 0000 0009', '5215500000009'), true);
  assert.equal(mismoNumero('5215500000009', '5215500000008'), false);
});

test('parámetro de plantilla: una línea y recortado', () => {
  assert.equal(resumirParaPlantilla('a\n\nb\tc    d'), 'a · b · c d');
  assert.equal(resumirParaPlantilla('x'.repeat(2000)).length, 900);
});
