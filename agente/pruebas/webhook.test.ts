// El webhook de Meta de punta a punta, contra la Graph API falsa.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { calcularFirma } from '../src/firma.ts';
import type { Instancia } from '../src/main.ts';
import { iniciar } from '../src/main.ts';
import { extraerMensajes } from '../src/webhook.ts';
import type { MetaFalso } from './meta-falso.ts';
import { crearMetaFalso, nuevoWamid } from './meta-falso.ts';
import {
  APP_SECRET,
  capturarRegistro,
  CLIENTE,
  configPrueba,
  payloadEstado,
  payloadTexto,
  PHONE_ID,
  postear,
  postearFirmado,
  TOKEN_FALSO,
  VERIFY_TOKEN,
  VERSION,
} from './utiles.ts';

capturarRegistro();

const abiertos: Array<{ i: Instancia; m: MetaFalso }> = [];
after(async () => {
  for (const { i, m } of abiertos) {
    await i.detener();
    await m.cerrar();
  }
});

async function montar(extra: Record<string, string> = {}) {
  const m = await crearMetaFalso({ version: VERSION, phoneNumberId: PHONE_ID, token: TOKEN_FALSO });
  const i = await iniciar(configPrueba({ META_GRAPH_BASE: m.url, ...extra }));
  abiertos.push({ i, m });
  return { i, m };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('webhook: escucha sólo en 127.0.0.1', async () => {
  const { i } = await montar();
  const dir = i.servidor.address();
  assert.equal(typeof dir === 'object' && dir ? dir.address : '', '127.0.0.1');
});

test('verificación GET: token bueno → 200 con el challenge en texto plano', async () => {
  const { i } = await montar();
  const q = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' });
  const res = await fetch(`http://127.0.0.1:${i.puerto}/webhook/meta?${q}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
  assert.equal(await res.text(), '1158201444');
});

test('verificación GET: token malo, modo distinto o sin challenge → 403', async () => {
  const { i } = await montar();
  for (const q of [
    { 'hub.mode': 'subscribe', 'hub.verify_token': 'otro-token', 'hub.challenge': '1' },
    { 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1' },
    { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN },
    { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '<script>' },
    {},
  ]) {
    const res = await fetch(`http://127.0.0.1:${i.puerto}/webhook/meta?${new URLSearchParams(q as Record<string, string>)}`);
    assert.equal(res.status, 403, JSON.stringify(q));
  }
});

test('POST firmado → 200 en el acto, y la respuesta sale por la Graph API', async () => {
  const { i, m } = await montar();
  const r = await postearFirmado(i.puerto, payloadTexto(CLIENTE, 'Hola'));
  assert.equal(r.estado, 200);
  const enviados = await m.esperarEnviados(CLIENTE, 1);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, '+' + CLIENTE, '`to` en E.164 con «+»');
  assert.equal(enviados[0].crudo.messaging_product, 'whatsapp');
  assert.match(enviados[0].cuerpo, /asistente automático de ANTE/);
});

test('POST con firma mala o sin firma → 403 y no se procesa', async () => {
  const { i, m } = await montar();
  const payload = payloadTexto(CLIENTE, 'Hola');
  const crudo = JSON.stringify(payload);
  const mala = await postear(i.puerto, crudo, 'sha256=' + '0'.repeat(64));
  const sin = await postear(i.puerto, crudo, undefined);
  const otroSecreto = await postear(i.puerto, crudo, calcularFirma('otro-secreto', crudo));
  assert.deepEqual([mala.estado, sin.estado, otroSecreto.estado], [403, 403, 403]);
  await esperar(150);
  await i.agente.esperarInactividad();
  assert.equal(m.envios.length, 0);
  const id = ((payload.entry as Array<{ changes: Array<{ value: { messages: Array<{ id: string }> } }> }>)[0].changes[0].value.messages[0]).id;
  assert.equal(i.agente.d.vistos.ya(id), false, 'ni siquiera se apuntó como visto');
});

test('POST firmado sobre el JSON re-serializado (con otros espacios) → 403', async () => {
  const { i, m } = await montar();
  const payload = payloadTexto(CLIENTE, 'Hola');
  const compacto = JSON.stringify(payload);
  const bonito = JSON.stringify(payload, null, 2);
  // Llegan los bytes «bonitos» con la firma del compacto: quien re-serializara
  // antes de verificar lo daría por bueno. Aquí no.
  const r = await postear(i.puerto, bonito, calcularFirma(APP_SECRET, compacto));
  assert.equal(r.estado, 403);
  // Y al revés también: firma de lo bonito, bytes compactos.
  assert.equal((await postear(i.puerto, compacto, calcularFirma(APP_SECRET, bonito))).estado, 403);
  // Con su propia firma, los bytes bonitos SÍ valen: se firma lo que llega.
  assert.equal((await postear(i.puerto, bonito, calcularFirma(APP_SECRET, bonito))).estado, 200);
  assert.equal((await m.esperarEnviados(CLIENTE, 1)).length, 1);
});

test('el mismo wamid dos veces (Meta reintenta) → una sola respuesta', async () => {
  const { i, m } = await montar();
  const payload = payloadTexto(CLIENTE, 'Hola', nuevoWamid());
  assert.equal((await postearFirmado(i.puerto, payload)).estado, 200);
  assert.equal((await postearFirmado(i.puerto, payload)).estado, 200);
  await m.esperarEnviados(CLIENTE, 1);
  await esperar(150);
  await i.agente.esperarInactividad();
  assert.equal(m.enviados(CLIENTE).length, 1);
});

test('payload de statuses (entregado/leído) → 200 y se ignora', async () => {
  const { i, m } = await montar();
  assert.equal((await postearFirmado(i.puerto, payloadEstado(CLIENTE, 'read'))).estado, 200);
  await esperar(150);
  await i.agente.esperarInactividad();
  assert.equal(m.envios.length, 0);
});

test('mensaje para otro phone_number_id → se ignora', async () => {
  const { i, m } = await montar();
  assert.equal((await postearFirmado(i.puerto, payloadTexto(CLIENTE, 'Hola', nuevoWamid(), '999999999999999'))).estado, 200);
  await esperar(150);
  await i.agente.esperarInactividad();
  assert.equal(m.envios.length, 0);
});

test('mensaje que no es texto (foto) → respuesta fija, sin modelo', async () => {
  const { i, m } = await montar();
  await postearFirmado(i.puerto, payloadTexto(CLIENTE, '', nuevoWamid(), PHONE_ID, 'image'));
  const e = await m.esperarEnviados(CLIENTE, 1);
  assert.match(e[0].cuerpo, /sólo leo texto/);
});

test('rutas y métodos: otra ruta → 404; PUT a la ruta → 405', async () => {
  const { i } = await montar();
  const base = `http://127.0.0.1:${i.puerto}`;
  for (const ruta of ['/', '/salud', '/webhook', '/webhook/meta/x', '/twilio/whatsapp']) {
    assert.equal((await fetch(base + ruta)).status, 404, ruta);
  }
  const firmado = await postear(i.puerto, '{}', calcularFirma(APP_SECRET, '{}'), '/otra');
  assert.equal(firmado.estado, 404, 'ni un POST bien firmado entra por otra ruta');
  assert.equal((await fetch(`${base}/webhook/meta`, { method: 'PUT' })).status, 405);
});

test('extraer: lote con varios mensajes, statuses y otro número', () => {
  const a = payloadTexto(CLIENTE, 'uno') as { entry: Array<{ changes: unknown[] }> };
  const b = payloadTexto('5215500000003', 'dos') as { entry: Array<{ changes: unknown[] }> };
  const s = payloadEstado(CLIENTE) as { entry: Array<{ changes: unknown[] }> };
  const lote = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [...a.entry[0].changes, ...b.entry[0].changes, ...s.entry[0].changes] }] };
  const x = extraerMensajes(lote, PHONE_ID);
  assert.deepEqual(x.mensajes.map((m) => m.cuerpo), ['uno', 'dos']);
  assert.equal(x.estados, 1);
  assert.equal(extraerMensajes({ object: 'page', entry: [] }, PHONE_ID).mensajes.length, 0);
});
