// Los dos modos de entrada, de punta a punta contra el Twilio falso.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { calcularFirma } from '../src/firma.ts';
import type { Instancia } from '../src/main.ts';
import { iniciar } from '../src/main.ts';
import { TWIML_VACIO } from '../src/webhook.ts';
import type { TwilioFalso } from './twilio-falso.ts';
import { crearTwilioFalso, nuevoSid } from './twilio-falso.ts';
import { capturarRegistro, CLIENTE, configPrueba, NUESTRO, OTRO_CLIENTE, paramsTwilio, SID_FALSO, TOKEN_FALSO, URL_PUBLICA } from './utiles.ts';

capturarRegistro();

const abiertos: Array<{ i: Instancia; t: TwilioFalso }> = [];
after(async () => {
  for (const { i, t } of abiertos) {
    await i.detener();
    await t.cerrar();
  }
});

async function montar(modo: 'webhook' | 'sondeo', extra: Record<string, string> = {}) {
  const t = await crearTwilioFalso({ sid: SID_FALSO, token: TOKEN_FALSO });
  const config = configPrueba({ TWILIO_API_BASE: t.url, AGENTE_MODO: modo, AGENTE_URL_PUBLICA: URL_PUBLICA, AGENTE_SONDEO_MS: '50', ...extra });
  const i = await iniciar(config);
  abiertos.push({ i, t });
  return { i, t };
}

function params(cuerpo: string, de = CLIENTE, sid = nuevoSid()): Record<string, string> {
  return paramsTwilio(cuerpo, de, sid);
}

async function postear(puerto: number, params: Record<string, string>, firma: string | undefined, ruta = '/twilio/whatsapp') {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (firma !== undefined) headers['X-Twilio-Signature'] = firma;
  const res = await fetch(`http://127.0.0.1:${puerto}${ruta}`, { method: 'POST', headers, body: new URLSearchParams(params).toString() });
  return { estado: res.status, cuerpo: await res.text(), tipo: res.headers.get('content-type') };
}

test('webhook: escucha sólo en 127.0.0.1', async () => {
  const { i } = await montar('webhook');
  const dir = i.servidor?.address();
  assert.equal(typeof dir === 'object' && dir ? dir.address : '', '127.0.0.1');
});

test('webhook: firma buena → 200 con TwiML vacío en el acto, y la respuesta sale por la API REST', async () => {
  const { i, t } = await montar('webhook');
  const p = params('Hola');
  const r = await postear(i.puerto!, p, calcularFirma(TOKEN_FALSO, URL_PUBLICA, p));
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo, TWIML_VACIO);
  assert.match(r.tipo ?? '', /text\/xml/);
  const enviados = await t.esperarEnviados(CLIENTE, 1);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].from, NUESTRO);
  assert.match(enviados[0].body, /asistente automático de ANTE/);
});

test('webhook: firma mala o ausente → 403 y el mensaje no se procesa', async () => {
  const { i, t } = await montar('webhook');
  const p = params('Hola');
  const mala = await postear(i.puerto!, p, 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  const sin = await postear(i.puerto!, p, undefined);
  const otroToken = await postear(i.puerto!, p, calcularFirma('otro-token', URL_PUBLICA, p));
  assert.deepEqual([mala.estado, sin.estado, otroToken.estado], [403, 403, 403]);
  await new Promise((r) => setTimeout(r, 200));
  await i.agente.esperarInactividad();
  assert.equal(t.enviados().length, 0);
  assert.equal(i.agente.d.vistos.ya(p.MessageSid), false, 'ni siquiera se apuntó como visto');
});

test('webhook: firmado con la URL local (127.0.0.1) en vez de la pública → 403', async () => {
  const { i, t } = await montar('webhook');
  const p = params('Hola');
  const local = `http://127.0.0.1:${i.puerto}/twilio/whatsapp`;
  const r = await postear(i.puerto!, p, calcularFirma(TOKEN_FALSO, local, p));
  assert.equal(r.estado, 403);
  await new Promise((ok) => setTimeout(ok, 100));
  assert.equal(t.enviados().length, 0);
});

test('webhook: la query con la que llega entra en la firma', async () => {
  const { i, t } = await montar('webhook');
  const p = params('Hola');
  const bien = await postear(i.puerto!, p, calcularFirma(TOKEN_FALSO, `${URL_PUBLICA}?x=1`, p), '/twilio/whatsapp?x=1');
  assert.equal(bien.estado, 200);
  const mal = await postear(i.puerto!, params('Hola'), calcularFirma(TOKEN_FALSO, URL_PUBLICA, p), '/twilio/whatsapp?x=1');
  assert.equal(mal.estado, 403);
  await t.esperarEnviados(CLIENTE, 1);
});

test('webhook: Twilio reintenta el mismo MessageSid → una sola respuesta', async () => {
  const { i, t } = await montar('webhook');
  const p = params('Hola');
  const f = calcularFirma(TOKEN_FALSO, URL_PUBLICA, p);
  assert.equal((await postear(i.puerto!, p, f)).estado, 200);
  assert.equal((await postear(i.puerto!, p, f)).estado, 200);
  await t.esperarEnviados(CLIENTE, 1);
  await new Promise((ok) => setTimeout(ok, 150));
  await i.agente.esperarInactividad();
  assert.equal(t.enviados(CLIENTE).length, 1);
});

test('webhook: salud, rutas ajenas y métodos', async () => {
  const { i } = await montar('webhook');
  const base = `http://127.0.0.1:${i.puerto}`;
  assert.equal((await fetch(`${base}/salud`)).status, 200);
  assert.equal((await fetch(`${base}/otra`)).status, 404);
  assert.equal((await fetch(`${base}/twilio/whatsapp`)).status, 405);
  const json = await fetch(`${base}/twilio/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(json.status, 415);
});

test('sondeo: ve el entrante en la lista de Twilio y contesta por la API; no repite en vueltas siguientes', async () => {
  const { i, t } = await montar('sondeo');
  t.inyectarEntrante(CLIENTE, NUESTRO, 'Hola, ¿qué paquetes tienen?');
  const enviados = await t.esperarEnviados(CLIENTE, 1);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].body, /Básico/);
  // Varias vueltas más: el mismo mensaje sigue en la lista, pero no se contesta otra vez.
  const vueltas = t.peticiones.listar;
  while (t.peticiones.listar < vueltas + 4) await new Promise((r) => setTimeout(r, 20));
  await i.agente.esperarInactividad();
  assert.equal(t.enviados(CLIENTE).length, 1);
});

test('sondeo: ignora lo saliente, lo de otros números y lo anterior al arranque', async () => {
  const { i, t } = await montar('sondeo');
  t.inyectarEntrante(OTRO_CLIENTE, NUESTRO, 'mensaje viejo', new Date(Date.now() - 30 * 60_000));
  t.inyectarEntrante(CLIENTE, 'whatsapp:+5215500000077', 'a otro número');
  const n = t.peticiones.listar;
  while (t.peticiones.listar < n + 3) await new Promise((r) => setTimeout(r, 20));
  await i.agente.esperarInactividad();
  assert.equal(t.enviados().length, 0);
  t.inyectarEntrante(OTRO_CLIENTE, NUESTRO, 'hola');
  assert.equal((await t.esperarEnviados(OTRO_CLIENTE, 1)).length, 1);
});

test('sondeo: tras reiniciar, contesta lo que llegó mientras estaba apagado y no repite lo ya contestado', async () => {
  const t = await crearTwilioFalso({ sid: SID_FALSO, token: TOKEN_FALSO });
  const config = configPrueba({ TWILIO_API_BASE: t.url, AGENTE_MODO: 'sondeo', AGENTE_SONDEO_MS: '50' });
  const i1 = await iniciar(config);
  t.inyectarEntrante(CLIENTE, NUESTRO, 'hola');
  await t.esperarEnviados(CLIENTE, 1);
  await i1.detener();
  t.inyectarEntrante(OTRO_CLIENTE, NUESTRO, 'hola, ¿siguen ahí?');
  const i2 = await iniciar(config);
  abiertos.push({ i: i2, t });
  assert.equal((await t.esperarEnviados(OTRO_CLIENTE, 1)).length, 1);
  await new Promise((r) => setTimeout(r, 200));
  await i2.agente.esperarInactividad();
  assert.equal(t.enviados(CLIENTE).length, 1);
});
