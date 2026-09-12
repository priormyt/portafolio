// Firma de los webhooks de Meta: cabecera `X-Hub-Signature-256: sha256=<hex>`,
// HMAC-SHA256 del CUERPO CRUDO con el App Secret. Ver la cita y la URL en
// agente/LEEME.md § «Lo verificado».
//
// Lo que no se negocia aquí:
//   - Se firma el Buffer tal como llegó, NUNCA una re-serialización del JSON:
//     otro espaciado, otro orden de claves o un \u escapado distinto dan otra
//     firma. La prueba «re-serializado → 403» vigila justo eso.
//   - Se compara en tiempo constante (crypto.timingSafeEqual), sobre los 32
//     bytes del resumen, no sobre el texto.
//   - Sin cabecera, sin «sha256=», con hex mal formado o de otra longitud: falso.

import crypto from 'node:crypto';

export function calcularFirma(secreto: string, crudo: Buffer | string): string {
  return 'sha256=' + crypto.createHmac('sha256', secreto).update(crudo).digest('hex');
}

export function verificarFirma(secreto: string, crudo: Buffer, cabecera: string | undefined | null): boolean {
  if (!secreto || !cabecera) return false;
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(cabecera.trim());
  if (!m) return false;
  const recibida = Buffer.from(m[1], 'hex');
  const esperada = crypto.createHmac('sha256', secreto).update(crudo).digest();
  return recibida.length === esperada.length && crypto.timingSafeEqual(recibida, esperada);
}

/** Comparación en tiempo constante de dos cadenas (el verify token del GET). */
export function igualesSeguro(a: string, b: string): boolean {
  const x = crypto.createHash('sha256').update(a, 'utf8').digest();
  const y = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(x, y) && a.length === b.length;
}
