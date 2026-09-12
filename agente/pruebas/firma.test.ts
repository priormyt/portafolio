import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cadenaAFirmar, calcularFirma, verificarFirma } from '../src/firma.ts';

// El ejemplo resuelto de https://www.twilio.com/docs/usage/security (12 sep 2026).
const URL_DOC = 'https://example.com/myapp.php?foo=1&bar=2';
const PARAMS_DOC = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+14158675310',
  Digits: '1234',
  From: '+14158675310',
  To: '+18005551212',
};
const TOKEN_DOC = '12345';
const FIRMA_DOC = 'L/OH5YylLD5NRKLltdqwSvS0BnU=';

test('firma: reproduce el ejemplo oficial de Twilio', () => {
  assert.equal(
    cadenaAFirmar(URL_DOC, PARAMS_DOC),
    'https://example.com/myapp.php?foo=1&bar=2CallSidCA1234567890ABCDECaller+14158675310Digits1234From+14158675310To+18005551212',
  );
  assert.equal(calcularFirma(TOKEN_DOC, URL_DOC, PARAMS_DOC), FIRMA_DOC);
});

test('firma buena: se acepta, sin importar el orden en que lleguen los parámetros', () => {
  const desordenados = new URLSearchParams([
    ['To', '+18005551212'],
    ['Digits', '1234'],
    ['From', '+14158675310'],
    ['Caller', '+14158675310'],
    ['CallSid', 'CA1234567890ABCDE'],
  ]);
  assert.equal(verificarFirma(TOKEN_DOC, URL_DOC, desordenados, FIRMA_DOC), true);
});

test('firma mala: token distinto, parámetro alterado, firma basura o ausente → se rechaza', () => {
  assert.equal(verificarFirma('otro-token', URL_DOC, PARAMS_DOC, FIRMA_DOC), false);
  assert.equal(verificarFirma(TOKEN_DOC, URL_DOC, { ...PARAMS_DOC, Digits: '9999' }, FIRMA_DOC), false);
  assert.equal(verificarFirma(TOKEN_DOC, URL_DOC, { ...PARAMS_DOC, Extra: 'x' }, FIRMA_DOC), false);
  assert.equal(verificarFirma(TOKEN_DOC, URL_DOC, PARAMS_DOC, 'AAAAAAAAAAAAAAAAAAAAAAAAAAA='), false);
  assert.equal(verificarFirma(TOKEN_DOC, URL_DOC, PARAMS_DOC, 'corta'), false);
  assert.equal(verificarFirma(TOKEN_DOC, URL_DOC, PARAMS_DOC, undefined), false);
  assert.equal(verificarFirma('', URL_DOC, PARAMS_DOC, FIRMA_DOC), false);
});

test('firma con URL distinta: la de 127.0.0.1, otra query, http en vez de https o sin query → se rechaza', () => {
  for (const url of [
    'http://127.0.0.1:9186/myapp.php?foo=1&bar=2',
    'https://example.com/myapp.php?foo=1&bar=3',
    'http://example.com/myapp.php?foo=1&bar=2',
    'https://example.com/myapp.php',
    'https://example.com:8443/myapp.php?foo=1&bar=2',
  ]) {
    assert.equal(verificarFirma(TOKEN_DOC, url, PARAMS_DOC, FIRMA_DOC), false, url);
  }
});

test('firma: el signo + del cuerpo urlencoded se firma ya decodificado', () => {
  // Twilio manda From=whatsapp%3A%2B5215500000001; URLSearchParams lo decodifica a «whatsapp:+…».
  const p = new URLSearchParams('From=whatsapp%3A%2B5215500000001&Body=Hola+ANTE');
  assert.equal(p.get('From'), 'whatsapp:+5215500000001');
  assert.equal(p.get('Body'), 'Hola ANTE');
  const firma = calcularFirma('t0k3n-de-prueba', 'https://wa.ejemplo.test/w', { From: 'whatsapp:+5215500000001', Body: 'Hola ANTE' });
  assert.equal(verificarFirma('t0k3n-de-prueba', 'https://wa.ejemplo.test/w', p, firma), true);
});
