// El cliente de la Graph API contra la Graph API falsa.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { ClienteMeta } from '../src/meta.ts';
import type { MetaFalso } from './meta-falso.ts';
import { crearMetaFalso } from './meta-falso.ts';
import { capturarRegistro, CLIENTE, PHONE_ID, TOKEN_FALSO, VERSION } from './utiles.ts';

capturarRegistro();
const abiertos: MetaFalso[] = [];
after(async () => {
  for (const m of abiertos) await m.cerrar();
});

async function montar(token = TOKEN_FALSO, version = VERSION) {
  const m = await crearMetaFalso({ version: VERSION, phoneNumberId: PHONE_ID, token: TOKEN_FALSO });
  abiertos.push(m);
  return { m, c: new ClienteMeta({ base: m.url, version, phoneNumberId: PHONE_ID, token }) };
}

test('graph: POST /{versión}/{PHONE_NUMBER_ID}/messages con Bearer y el cuerpo de la Cloud API', async () => {
  const { m, c } = await montar();
  const r = await c.enviarTexto(CLIENTE, 'Hola');
  assert.equal(r.ok, true);
  assert.match(r.id ?? '', /^wamid\./);
  assert.deepEqual(m.envios[0].crudo, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '+' + CLIENTE,
    type: 'text',
    text: { preview_url: false, body: 'Hola' },
  });
});

test('graph: plantilla con un parámetro de cuerpo', async () => {
  const { m, c } = await montar();
  await c.enviarPlantilla('+' + CLIENTE, 'aviso_asistente', 'es_MX', ['hola']);
  assert.deepEqual(m.envios[0].crudo.template, {
    name: 'aviso_asistente',
    language: { code: 'es_MX' },
    components: [{ type: 'body', parameters: [{ type: 'text', text: 'hola' }] }],
  });
});

test('graph: token malo o versión equivocada → no ok, con el código de Meta, sin lanzar', async () => {
  const malo = await montar('otro-token');
  assert.deepEqual(await malo.c.enviarTexto(CLIENTE, 'x'), { ok: false, estado: 401, codigo: 190 });
  const version = await montar(TOKEN_FALSO, 'v1.0');
  assert.equal((await version.c.enviarTexto(CLIENTE, 'x')).estado, 404);
});

test('graph: un 500 se reintenta una vez', async () => {
  const { m, c } = await montar();
  m.fallarEnvios(1, 500);
  assert.equal((await c.enviarTexto(CLIENTE, 'x')).ok, true);
  assert.equal(m.peticiones.enviar, 2);
});
