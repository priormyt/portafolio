// El único transporte: el webhook de la WhatsApp Cloud API de Meta.
//
// Un servidor HTTP atado a 127.0.0.1 (nunca 0.0.0.0) con UNA ruta
// (AGENTE_RUTA, `/webhook/meta` por omisión). El túnel de Cloudflare manda ahí
// esa ruta y sólo ésa.
//   GET  → verificación de la suscripción: hub.mode=subscribe y
//          hub.verify_token == META_VERIFY_TOKEN → 200 con hub.challenge en
//          texto plano; si no, 403.
//   POST → X-Hub-Signature-256 sobre los BYTES CRUDOS (firma.ts). Mala o
//          ausente → 403 y no se toca nada. Buena → 200 en el acto y el
//          procesamiento va aparte: el modelo tarda más de lo que conviene tener
//          a Meta esperando, y la respuesta sale por la Graph API.
//   Cualquier otra ruta → 404; otro método en la ruta → 405.
// Las citas de Meta para cada mecánica, en agente/LEEME.md § «Lo verificado».

import http from 'node:http';
import type { Agente } from './agente.ts';
import type { Config } from './config.ts';
import { igualesSeguro, verificarFirma } from './firma.ts';
import type { MensajeEntrante } from './meta.ts';
import { digitos } from './meta.ts';
import { registrar } from './registro.ts';

// «Webhook payloads can be up to 3 MB» (webhooks/overview de WhatsApp). Un 413 a un
// payload legítimo haría que Meta lo reintentara durante días: se deja holgura.
const MAX_CUERPO = 4 * 1024 * 1024;

function leerCrudo(req: http.IncomingMessage): Promise<Buffer | null> {
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
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}

function responder(res: http.ServerResponse, estado: number, cuerpo: string): void {
  res.writeHead(estado, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(cuerpo);
}

interface ValorMeta {
  metadata?: { phone_number_id?: string };
  messages?: Array<{ id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string } }>;
  statuses?: unknown[];
}

export interface Extraidos {
  mensajes: MensajeEntrante[];
  estados: number;
  ajenos: number;
}

/**
 * Lee `entry[].changes[].value.messages[]` de un payload ya verificado. Los
 * `statuses` (entregado, leído…) se cuentan y se ignoran; lo que venga para
 * otro PHONE_NUMBER_ID, también.
 */
export function extraerMensajes(payload: unknown, phoneNumberId: string): Extraidos {
  const out: Extraidos = { mensajes: [], estados: 0, ajenos: 0 };
  const p = payload as { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: ValorMeta }> }> };
  if (!p || p.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return out;
  for (const entrada of p.entry) {
    for (const cambio of entrada.changes ?? []) {
      if (cambio.field !== 'messages' || !cambio.value) continue;
      const v = cambio.value;
      if (v.metadata?.phone_number_id !== phoneNumberId) {
        out.ajenos += (v.messages?.length ?? 0) + (v.statuses?.length ?? 0);
        continue;
      }
      out.estados += v.statuses?.length ?? 0;
      for (const m of v.messages ?? []) {
        if (!m.id || !m.from) continue;
        const segundos = Number(m.timestamp);
        out.mensajes.push({
          id: m.id,
          de: digitos(m.from),
          tipo: m.type ?? 'desconocido',
          cuerpo: m.type === 'text' ? (m.text?.body ?? '') : '',
          fecha: Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : new Date(),
        });
      }
    }
  }
  return out;
}

export function crearServidorWebhook(agente: Agente, config: Config): http.Server {
  const servidor = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== config.rutaWebhook) return responder(res, 404, 'no encontrado\n');

      if (req.method === 'GET') {
        const modo = u.searchParams.get('hub.mode');
        const token = u.searchParams.get('hub.verify_token') ?? '';
        const reto = u.searchParams.get('hub.challenge') ?? '';
        if (modo === 'subscribe' && igualesSeguro(token, config.meta.verifyToken) && /^[\w-]{1,200}$/.test(reto)) {
          registrar('info', 'webhook.verificacion', { ok: true });
          return responder(res, 200, reto);
        }
        registrar('aviso', 'webhook.verificacion', { ok: false, modo });
        return responder(res, 403, 'verificación rechazada\n');
      }

      if (req.method !== 'POST') return responder(res, 405, 'sólo GET y POST\n');

      const crudo = await leerCrudo(req);
      if (crudo === null) return responder(res, 413, 'demasiado grande\n');
      const firma = req.headers['x-hub-signature-256'];
      if (!verificarFirma(config.meta.appSecret, crudo, Array.isArray(firma) ? firma[0] : firma)) {
        registrar('aviso', 'webhook.firma_invalida', { conFirma: Boolean(firma), bytes: crudo.length });
        return responder(res, 403, 'firma inválida\n');
      }

      responder(res, 200, 'ok\n');
      setImmediate(() => {
        let payload: unknown;
        try {
          payload = JSON.parse(crudo.toString('utf8'));
        } catch {
          registrar('aviso', 'webhook.json_invalido', { bytes: crudo.length });
          return;
        }
        const x = extraerMensajes(payload, config.meta.phoneNumberId);
        if (x.estados || x.ajenos) registrar('info', 'webhook.ignorados', { estados: x.estados, ajenos: x.ajenos });
        for (const m of x.mensajes) void agente.recibir(m);
      });
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
