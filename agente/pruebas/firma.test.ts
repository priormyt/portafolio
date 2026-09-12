// La firma de Meta: HMAC-SHA256 de los BYTES CRUDOS con el App Secret,
// en `X-Hub-Signature-256: sha256=<hex>`.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { calcularFirma, igualesSeguro, verificarFirma } from '../src/firma.ts';

const SECRETO = 'app-secret-de-prueba';
const CRUDO = Buffer.from('{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[]}]}', 'utf8');

test('firma: formato sha256=<64 hex> y coincide con un HMAC-SHA256 independiente', () => {
  const f = calcularFirma(SECRETO, CRUDO);
  assert.match(f, /^sha256=[0-9a-f]{64}$/);
  // Vector fijo: si alguien cambia el algoritmo (SHA1, otra llave, base64…), esto se rompe.
  assert.equal(f, 'sha256=' + crypto.createHmac('sha256', SECRETO).update(CRUDO).digest('hex'));
  assert.equal(verificarFirma(SECRETO, CRUDO, f), true);
  assert.equal(verificarFirma(SECRETO, CRUDO, f.toUpperCase().replace('SHA256=', 'sha256=')), true, 'hex en mayúsculas');
});

test('firma mala: otro secreto, un byte cambiado, sin prefijo, basura, ausente → falso', () => {
  const f = calcularFirma(SECRETO, CRUDO);
  assert.equal(verificarFirma('otro-secreto', CRUDO, f), false);
  const alterado = Buffer.from(CRUDO);
  alterado[10] ^= 1;
  assert.equal(verificarFirma(SECRETO, alterado, f), false);
  assert.equal(verificarFirma(SECRETO, CRUDO, f.slice('sha256='.length)), false, 'sin «sha256=»');
  assert.equal(verificarFirma(SECRETO, CRUDO, 'sha1=' + f.slice(7)), false);
  assert.equal(verificarFirma(SECRETO, CRUDO, 'sha256=abc'), false);
  assert.equal(verificarFirma(SECRETO, CRUDO, 'sha256=' + 'z'.repeat(64)), false);
  assert.equal(verificarFirma(SECRETO, CRUDO, undefined), false);
  assert.equal(verificarFirma('', CRUDO, f), false);
});

test('firma sobre JSON re-serializado (otros espacios, otro orden, otro escape) → falso', () => {
  const payload = JSON.parse(CRUDO.toString('utf8'));
  const f = calcularFirma(SECRETO, CRUDO);
  const bonito = Buffer.from(JSON.stringify(payload, null, 2));
  const reordenado = Buffer.from(JSON.stringify({ entry: payload.entry, object: payload.object }));
  assert.equal(verificarFirma(SECRETO, bonito, f), false);
  assert.equal(verificarFirma(SECRETO, reordenado, f), false);
  // Mismo JSON lógico, «á» literal frente a su escape: bytes distintos, firma distinta.
  const barra = String.fromCharCode(92);
  const conAcento = Buffer.from('{"t":"á"}');
  const escapado = Buffer.from(`{"t":"${barra}u00e1"}`);
  assert.deepEqual(JSON.parse(escapado.toString()), JSON.parse(conAcento.toString()));
  assert.equal(verificarFirma(SECRETO, escapado, calcularFirma(SECRETO, conAcento)), false);
});

test('verify token: comparación que no depende del largo común', () => {
  assert.equal(igualesSeguro('abc123', 'abc123'), true);
  assert.equal(igualesSeguro('abc123', 'abc124'), false);
  assert.equal(igualesSeguro('abc', 'abc123'), false);
  assert.equal(igualesSeguro('', ''), true);
});
