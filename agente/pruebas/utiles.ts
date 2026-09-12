// Ayudas compartidas por las pruebas y el simulador. Todos los números son de
// mentira (+52 155 0000 00xx) y los secretos también.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '../src/config.ts';
import { cargarConfig } from '../src/config.ts';
import { calcularFirma } from '../src/firma.ts';
import { configurarRegistro } from '../src/registro.ts';
import { nuevoWamid } from './meta-falso.ts';

export const VERSION = 'v26.0';
export const PHONE_ID = '100000000000001';
export const TOKEN_FALSO = 'token-de-meta-falso-solo-para-pruebas';
export const APP_SECRET = 'app-secret-falso-solo-para-pruebas';
export const VERIFY_TOKEN = 'verify-token-falso-de-32-caracteres-xx';
/** Números en dígitos, como los manda Meta en `from` (wa_id). */
export const CLIENTE = '5215500000001';
export const OTRO_CLIENTE = '5215500000002';
/** El de Pablo, en E.164 como se configura. */
export const ADMIN = '+5215500000009';
export const ADMIN_WA_ID = '5215500000009';

export function dirTemporal(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ante-agente-'));
}

export function entornoBase(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    META_ACCESS_TOKEN: TOKEN_FALSO,
    META_APP_SECRET: APP_SECRET,
    META_VERIFY_TOKEN: VERIFY_TOKEN,
    META_PHONE_NUMBER_ID: PHONE_ID,
    META_GRAPH_VERSION: VERSION,
    ADMIN_WHATSAPP_TO: ADMIN,
    AGENTE_PROVEEDOR: 'simulado',
    AGENTE_DATOS: dirTemporal(),
    AGENTE_PUERTO: '0',
    ...extra,
  };
}

export function configPrueba(extra: Record<string, string | undefined> = {}): Config {
  return cargarConfig(entornoBase(extra));
}

/**
 * Un payload de mensaje de texto entrante con la forma de la Cloud API
 * (https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components).
 */
export function payloadTexto(de: string, texto: string, id = nuevoWamid(), phoneId = PHONE_ID, tipo = 'text'): Record<string, unknown> {
  const mensaje: Record<string, unknown> = { from: de, id, timestamp: String(Math.floor(Date.now() / 1000)), type: tipo };
  if (tipo === 'text') mensaje.text = { body: texto };
  else if (tipo === 'image') mensaje.image = { mime_type: 'image/jpeg', sha256: 'x', id: '1' };
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '100000000000009',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: phoneId },
              contacts: [{ profile: { name: 'Cliente de prueba' }, wa_id: de }],
              messages: [mensaje],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

/** Un payload de `statuses` (entregado/leído): el agente lo ignora. */
export function payloadEstado(para: string, estado = 'delivered'): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '100000000000009',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: PHONE_ID },
              statuses: [{ id: nuevoWamid(), status: estado, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: para }],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

/** POST al webhook con los bytes EXACTOS de `crudo` y la cabecera que se dé. */
export async function postear(puerto: number, crudo: string | Buffer, firma: string | undefined, ruta = '/webhook/meta') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (firma !== undefined) headers['X-Hub-Signature-256'] = firma;
  const res = await fetch(`http://127.0.0.1:${puerto}${ruta}`, { method: 'POST', headers, body: crudo });
  return { estado: res.status, cuerpo: await res.text() };
}

/** Firma y manda un payload como lo haría Meta. */
export async function postearFirmado(puerto: number, payload: unknown) {
  const crudo = JSON.stringify(payload);
  return postear(puerto, crudo, calcularFirma(APP_SECRET, crudo));
}

/** Captura el registro (y lo silencia) mientras dura una prueba. */
export function capturarRegistro(): string[] {
  const lineas: string[] = [];
  configurarRegistro((l) => lineas.push(l));
  return lineas;
}
