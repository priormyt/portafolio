// Ayudas compartidas por las pruebas y el simulador. Todos los números son de
// mentira (+52 155 0000 00xx) y los secretos también.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '../src/config.ts';
import { cargarConfig } from '../src/config.ts';
import { configurarRegistro } from '../src/registro.ts';

export const SID_FALSO = 'AC' + '0'.repeat(32);
export const TOKEN_FALSO = 'token-falso-solo-para-pruebas';
export const NUESTRO = 'whatsapp:+5215500000000';
export const CLIENTE = 'whatsapp:+5215500000001';
export const OTRO_CLIENTE = 'whatsapp:+5215500000002';
export const ADMIN = 'whatsapp:+5215500000009';
export const URL_PUBLICA = 'https://wa.ejemplo.test/twilio/whatsapp';

export function dirTemporal(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ante-agente-'));
}

export function entornoBase(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    TWILIO_ACCOUNT_SID: SID_FALSO,
    TWILIO_AUTH_TOKEN: TOKEN_FALSO,
    TWILIO_WHATSAPP_FROM: NUESTRO,
    ADMIN_WHATSAPP_TO: ADMIN,
    AGENTE_PROVEEDOR: 'simulado',
    AGENTE_DATOS: dirTemporal(),
    AGENTE_ENVIO_INTERVALO_MS: '0',
    AGENTE_PUERTO: '0',
    ...extra,
  };
}

export function configPrueba(extra: Record<string, string | undefined> = {}): Config {
  return cargarConfig(entornoBase(extra));
}

/** Captura el registro (y lo silencia) mientras dura una prueba. */
export function capturarRegistro(): string[] {
  const lineas: string[] = [];
  configurarRegistro((l) => lineas.push(l));
  return lineas;
}
