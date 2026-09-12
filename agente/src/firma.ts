// Verificación de X-Twilio-Signature, tal como la describe Twilio en
// https://www.twilio.com/docs/usage/security (leída el 12 sep 2026):
//
//   1. «Take the full URL of the request URL you specify for your phone number
//      or app, from the protocol (https...) through the end of the query string»
//   2. «If the request is a POST, sort all the POST parameters alphabetically
//      (using Unix-style case-sensitive sorting order).»
//   3. «Iterate through the sorted list of POST parameters, and append the
//      variable name and value (with no delimiters) to the end of the URL string.»
//   4. «Sign the resulting string with HMAC-SHA1 using your AuthToken as the key»
//   5. «Base64-encode the resulting hash value.»
//   6. «Compare your hash to ours, submitted in the X-Twilio-Signature HTTP header.»
//
// La prueba `firma.test.ts` usa el ejemplo resuelto de esa misma página
// (token 12345 → L/OH5YylLD5NRKLltdqwSvS0BnU=).
//
// Tres cosas que son NUESTRAS y no de la documentación:
//   - Twilio recomienda usar la biblioteca de su SDK y no implementar esto; aquí
//     no hay dependencias, así que se implementa y el ejemplo oficial lo vigila.
//   - La comparación es en tiempo constante (crypto.timingSafeEqual).
//   - Parámetros repetidos: la documentación no dice nada; los webhooks de
//     mensajería no los mandan. Si llegaran, se ordenan también por valor.
//
// La URL que se firma es la PÚBLICA (la que Twilio llama, detrás del túnel),
// nunca la de 127.0.0.1: por eso vive en AGENTE_URL_PUBLICA. Twilio conserva el
// puerto en las devoluciones de SMS por HTTPS; con https y puerto por omisión no
// hay puerto que conservar, y se firma la URL tal cual está configurada.

import crypto from 'node:crypto';

export type Parametros = Iterable<[string, string]> | Record<string, string | string[]>;

function pares(params: Parametros): Array<[string, string]> {
  if (Symbol.iterator in Object(params)) return [...(params as Iterable<[string, string]>)];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params as Record<string, string | string[]>)) {
    for (const x of Array.isArray(v) ? v : [v]) out.push([k, x]);
  }
  return out;
}

/** Orden «Unix, sensible a mayúsculas»: por unidad de código, que es el orden por omisión de JS. */
function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function cadenaAFirmar(url: string, params: Parametros): string {
  const lista = pares(params).sort((x, y) => comparar(x[0], y[0]) || comparar(x[1], y[1]));
  return url + lista.map(([k, v]) => k + v).join('');
}

export function calcularFirma(token: string, url: string, params: Parametros): string {
  return crypto.createHmac('sha1', token).update(cadenaAFirmar(url, params), 'utf8').digest('base64');
}

export function verificarFirma(token: string, url: string, params: Parametros, firma: string | undefined | null): boolean {
  if (!token || !firma) return false;
  const esperada = Buffer.from(calcularFirma(token, url, params), 'utf8');
  const recibida = Buffer.from(firma.trim(), 'utf8');
  // La longitud de una firma SHA-1 en Base64 es fija (28): compararla primero
  // no revela nada, y timingSafeEqual exige longitudes iguales.
  if (esperada.length !== recibida.length) return false;
  return crypto.timingSafeEqual(esperada, recibida);
}
