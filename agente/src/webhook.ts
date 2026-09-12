// Modo webhook: servidor HTTP atado a 127.0.0.1 (nunca 0.0.0.0). Para que Twilio
// llegue hace falta un túnel que lo saque a una URL pública; ésa es la que firma
// Twilio y la que se configura en AGENTE_URL_PUBLICA.
//
// Twilio manda «application/x-www-form-urlencoded» y «expects to receive TwiML in
// response» (https://www.twilio.com/docs/messaging/guides/webhook-request).
// Se contesta 200 con TwiML vacío EN EL ACTO y el mensaje se procesa aparte: el
// modelo tarda más de lo que conviene tener a Twilio esperando, y la respuesta
// sale por la API REST. Firma mala → 403, y el mensaje no se toca.

import http from 'node:http';
import type { Agente } from './agente.ts';
import type { Config } from './config.ts';
import { verificarFirma } from './firma.ts';
import { enmascarar, registrar } from './registro.ts';
import type { MensajeEntrante } from './twilio.ts';

export const TWIML_VACIO = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const MAX_CUERPO = 64 * 1024;

function leerCuerpo(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const trozos: Buffer[] = [];
    let total = 0;
    req.on('data', (b: Buffer) => {
      total += b.length;
      if (total > MAX_CUERPO) {
        resolve(null);
        req.destroy();
        return;
      }
      trozos.push(b);
    });
    req.on('end', () => resolve(Buffer.concat(trozos).toString('utf8')));
    req.on('error', reject);
  });
}

function responder(res: http.ServerResponse, estado: number, cuerpo: string, tipo = 'text/plain; charset=utf-8'): void {
  res.writeHead(estado, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
  res.end(cuerpo);
}

export function mensajeDesdeWebhook(p: URLSearchParams): MensajeEntrante {
  return {
    sid: p.get('MessageSid') ?? p.get('SmsMessageSid') ?? '',
    de: p.get('From') ?? '',
    para: p.get('To') ?? '',
    cuerpo: p.get('Body') ?? '',
    fecha: new Date(),
    medios: Number(p.get('NumMedia') ?? 0) || 0,
  };
}

export function crearServidorWebhook(agente: Agente, config: Config): http.Server {
  // Tal cual está escrita en AGENTE_URL_PUBLICA (que debe ser idéntica a la de la
  // consola de Twilio), sin su query: la query se toma de la petición que llega.
  const baseFirmada = (config.urlPublica ?? '').split(/[?#]/)[0];

  const servidor = http.createServer(async (req, res) => {
    try {
      const local = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'GET' && local.pathname === '/salud') return responder(res, 200, 'ok\n');
      if (local.pathname !== config.rutaWebhook) return responder(res, 404, 'no encontrado\n');
      if (req.method !== 'POST') return responder(res, 405, 'sólo POST\n');
      if (!(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
        return responder(res, 415, 'se espera application/x-www-form-urlencoded\n');
      }

      const crudo = await leerCuerpo(req);
      if (crudo === null) return responder(res, 413, 'demasiado grande\n');
      const params = new URLSearchParams(crudo);

      // La URL firmada: la pública configurada + la query con la que llegó.
      const url = baseFirmada + local.search;
      const firma = req.headers['x-twilio-signature'];
      if (!verificarFirma(config.twilio.token, url, params, Array.isArray(firma) ? firma[0] : firma)) {
        registrar('aviso', 'webhook.firma_invalida', { de: enmascarar(params.get('From') ?? undefined), conFirma: Boolean(firma) });
        return responder(res, 403, 'firma inválida\n');
      }

      responder(res, 200, TWIML_VACIO, 'text/xml; charset=utf-8');
      const m = mensajeDesdeWebhook(params);
      setImmediate(() => void agente.recibir(m));
    } catch (e) {
      registrar('error', 'webhook.error', { error: String((e as Error)?.message ?? e) });
      if (!res.headersSent) responder(res, 500, 'error\n');
    }
  });

  servidor.requestTimeout = 10_000;
  servidor.headersTimeout = 5_000;
  return servidor;
}

/** Arranca y resuelve con el puerto real (útil con puerto 0 en pruebas). */
export function escuchar(servidor: http.Server, config: Config): Promise<number> {
  return new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(config.puerto, config.host, () => {
      const dir = servidor.address();
      resolve(typeof dir === 'object' && dir ? dir.port : config.puerto);
    });
  });
}
