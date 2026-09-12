// Configuración del agente. Todo sale del entorno, y los secretos primero de
// $CREDENTIALS_DIRECTORY (systemd LoadCredentialEncrypted: un tmpfs que sólo lee
// este servicio) y, sólo en desarrollo, de variables de entorno.
//
// Si falta algo imprescindible, `cargarConfig` lanza un Error con la lista de lo
// que falta — nunca con los valores.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ocultarSecretos } from './registro.ts';

export type Modo = 'sondeo' | 'webhook';
export type NombreProveedor = 'deepseek' | 'simulado';

/** Dólares por millón de tokens. */
export interface Precios {
  entradaCache: number;
  entrada: number;
  salida: number;
}

export interface Config {
  modo: Modo;
  host: string;
  puerto: number;
  /** La URL que llama Twilio (detrás del túnel). Es la que se firma. */
  urlPublica: string | undefined;
  rutaWebhook: string;
  datos: string;
  conocimiento: string;

  twilio: {
    base: string;
    sid: string;
    token: string;
    /** Nuestro número: whatsapp:+… (en el Sandbox, el número compartido de Twilio). */
    desde: string;
    /** A quién se avisa (Pablo). Si falta, los avisos se registran y no se mandan. */
    admin: string | undefined;
    /** Espacio mínimo entre envíos. El Sandbox manda uno cada 3 s como mucho. */
    intervaloEnvioMs: number;
  };

  proveedor: NombreProveedor;
  modelo: string;
  deepseek: { base: string; llave: string | undefined };
  precios: Precios;
  topeDiarioUsd: number;
  maxTokens: number;
  tiempoModeloMs: number;

  sondeoMs: number;
  /** Tras un apagón, hasta cuántos minutos atrás se contesta lo que llegó. */
  sondeoAtrasoMaxMin: number;

  presentarse: boolean;
  textoPresentacion: string;
  /** Cómo se llama ante el cliente la persona que confirma. */
  humano: string;
  /** Horas de silencio tras las que un mensaje abre conversación nueva (y se vuelve a presentar). */
  conversacionHoras: number;

  limitePorNumeroHora: number;
  limiteGlobalHora: number;

  vueltas: number;
  caracteresHistorial: number;
  retencionDias: number;
  zonaHoraria: string;
}

export const SECRETOS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'DEEPSEEK_API_KEY', 'ADMIN_WHATSAPP_TO'] as const;
export type NombreSecreto = (typeof SECRETOS)[number];

type Entorno = Record<string, string | undefined>;

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ_AGENTE = path.resolve(AQUI, '..');

/**
 * Lee un secreto: primero `$CREDENTIALS_DIRECTORY/<NOMBRE>`, luego la variable
 * de entorno (desarrollo). El nombre se valida para que nunca sea una ruta.
 */
export function leerSecreto(nombre: string, entorno: Entorno = process.env): string | undefined {
  if (!/^[A-Z][A-Z0-9_]*$/.test(nombre)) throw new Error(`nombre de secreto inválido: ${nombre}`);
  const dir = entorno.CREDENTIALS_DIRECTORY;
  if (dir) {
    try {
      const v = fs.readFileSync(path.join(dir, nombre), 'utf8').trim();
      if (v) return v;
    } catch {
      // No está en el directorio de credenciales: se prueba el entorno.
    }
  }
  const v = entorno[nombre]?.trim();
  return v ? v : undefined;
}

function numero(entorno: Entorno, nombre: string, porOmision: number, faltas: string[], min = 0): number {
  const crudo = entorno[nombre];
  if (crudo === undefined || crudo.trim() === '') return porOmision;
  const n = Number(crudo);
  if (!Number.isFinite(n) || n < min) {
    faltas.push(`${nombre} debe ser un número ≥ ${min}`);
    return porOmision;
  }
  return n;
}

function siNo(crudo: string | undefined, porOmision: boolean): boolean {
  if (crudo === undefined || crudo.trim() === '') return porOmision;
  return ['si', 'sí', 'yes', 'true', '1'].includes(crudo.trim().toLowerCase());
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

// DeepSeek, precios de hoy (12 sep 2026) en https://api-docs.deepseek.com/quick_start/pricing/
// para `deepseek-flash` (DeepSeek-V4.1-Flash): cache hit $0.003/$0.006, cache miss
// $0.15/$0.3 y salida $0.6/$1.2 (valle/pico) por millón de tokens. Se usa SIEMPRE
// la tarifa pico: así el tope diario es una cota superior y nunca se queda corto.
export const PRECIOS_DEEPSEEK_FLASH_PICO: Precios = { entradaCache: 0.006, entrada: 0.3, salida: 1.2 };

export const PRESENTACION_POR_OMISION =
  'Hola, soy el asistente automático de ANTE. Te ayudo con paquetes, precios y para apartar tu sesión; lo que yo no sepa, se lo paso a {humano}.';

export function cargarConfig(entorno: Entorno = process.env): Config {
  const faltas: string[] = [];

  const modoCrudo = (entorno.AGENTE_MODO ?? 'sondeo').trim();
  if (modoCrudo !== 'sondeo' && modoCrudo !== 'webhook') faltas.push('AGENTE_MODO debe ser «sondeo» o «webhook»');
  const modo: Modo = modoCrudo === 'webhook' ? 'webhook' : 'sondeo';

  const host = (entorno.AGENTE_HOST ?? '127.0.0.1').trim();
  if (!LOOPBACK.has(host)) {
    faltas.push('AGENTE_HOST sólo puede ser 127.0.0.1, ::1 o localhost: nada se publica en 0.0.0.0');
  }
  const puerto = numero(entorno, 'AGENTE_PUERTO', 9186, faltas);

  const urlPublica = entorno.AGENTE_URL_PUBLICA?.trim() || undefined;
  let rutaWebhook = '/twilio/whatsapp';
  if (urlPublica) {
    try {
      const u = new URL(urlPublica);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocolo');
      rutaWebhook = u.pathname || '/';
    } catch {
      faltas.push('AGENTE_URL_PUBLICA no es una URL válida');
    }
  }
  if (modo === 'webhook' && !urlPublica) {
    faltas.push('AGENTE_URL_PUBLICA (en modo webhook la firma se calcula sobre la URL pública que llama Twilio)');
  }

  const sid = leerSecreto('TWILIO_ACCOUNT_SID', entorno);
  const token = leerSecreto('TWILIO_AUTH_TOKEN', entorno);
  const admin = leerSecreto('ADMIN_WHATSAPP_TO', entorno);
  const llave = leerSecreto('DEEPSEEK_API_KEY', entorno);
  ocultarSecretos([sid, token, llave, admin]);

  if (!sid) faltas.push('TWILIO_ACCOUNT_SID');
  if (!token) faltas.push('TWILIO_AUTH_TOKEN');
  const desde = entorno.TWILIO_WHATSAPP_FROM?.trim();
  if (!desde) faltas.push('TWILIO_WHATSAPP_FROM (nuestro número, whatsapp:+…)');
  else if (!/^whatsapp:\+\d{8,15}$/.test(desde)) faltas.push('TWILIO_WHATSAPP_FROM debe verse como whatsapp:+<dígitos>');
  if (admin && !/^whatsapp:\+\d{8,15}$/.test(admin)) faltas.push('ADMIN_WHATSAPP_TO debe verse como whatsapp:+<dígitos>');

  const provCrudo = entorno.AGENTE_PROVEEDOR?.trim();
  let proveedor: NombreProveedor;
  if (!provCrudo) proveedor = llave ? 'deepseek' : 'simulado';
  else if (provCrudo === 'deepseek' || provCrudo === 'simulado') proveedor = provCrudo;
  else {
    faltas.push('AGENTE_PROVEEDOR debe ser «deepseek» o «simulado»');
    proveedor = 'simulado';
  }
  if (proveedor === 'deepseek' && !llave) faltas.push('DEEPSEEK_API_KEY (el proveedor es deepseek)');

  const precios: Precios = {
    entradaCache: numero(entorno, 'AGENTE_PRECIO_ENTRADA_CACHE_USD_MTOK', PRECIOS_DEEPSEEK_FLASH_PICO.entradaCache, faltas),
    entrada: numero(entorno, 'AGENTE_PRECIO_ENTRADA_USD_MTOK', PRECIOS_DEEPSEEK_FLASH_PICO.entrada, faltas),
    salida: numero(entorno, 'AGENTE_PRECIO_SALIDA_USD_MTOK', PRECIOS_DEEPSEEK_FLASH_PICO.salida, faltas),
  };

  const humano = entorno.AGENTE_NOMBRE_HUMANO?.trim() || 'Pablo';

  const config: Config = {
    modo,
    host,
    puerto,
    urlPublica,
    rutaWebhook,
    datos: path.resolve(entorno.AGENTE_DATOS?.trim() || path.join(RAIZ_AGENTE, '.datos')),
    conocimiento: path.resolve(entorno.AGENTE_CONOCIMIENTO?.trim() || path.join(RAIZ_AGENTE, 'conocimiento.md')),
    twilio: {
      base: (entorno.TWILIO_API_BASE?.trim() || 'https://api.twilio.com').replace(/\/$/, ''),
      sid: sid ?? '',
      token: token ?? '',
      desde: desde ?? '',
      admin,
      intervaloEnvioMs: numero(entorno, 'AGENTE_ENVIO_INTERVALO_MS', 3000, faltas),
    },
    proveedor,
    modelo: entorno.AGENTE_MODELO?.trim() || 'deepseek-flash',
    deepseek: { base: (entorno.DEEPSEEK_API_BASE?.trim() || 'https://api.deepseek.com').replace(/\/$/, ''), llave },
    precios,
    topeDiarioUsd: numero(entorno, 'AGENTE_TOPE_DIARIO_USD', 0.5, faltas),
    maxTokens: Math.min(numero(entorno, 'AGENTE_MAX_TOKENS', 400, faltas, 16), 1000),
    tiempoModeloMs: numero(entorno, 'AGENTE_TIEMPO_MODELO_MS', 20000, faltas, 1000),
    sondeoMs: numero(entorno, 'AGENTE_SONDEO_MS', 5000, faltas, 50),
    sondeoAtrasoMaxMin: numero(entorno, 'AGENTE_SONDEO_ATRASO_MAX_MIN', 60, faltas, 1),
    presentarse: siNo(entorno.AGENTE_PRESENTARSE, true),
    textoPresentacion: (entorno.AGENTE_PRESENTACION?.trim() || PRESENTACION_POR_OMISION).replaceAll('{humano}', humano),
    humano,
    conversacionHoras: numero(entorno, 'AGENTE_CONVERSACION_HORAS', 12, faltas, 0),
    limitePorNumeroHora: numero(entorno, 'AGENTE_LIMITE_POR_NUMERO_HORA', 20, faltas, 1),
    limiteGlobalHora: numero(entorno, 'AGENTE_LIMITE_GLOBAL_HORA', 200, faltas, 1),
    vueltas: numero(entorno, 'AGENTE_VUELTAS', 12, faltas, 1),
    caracteresHistorial: numero(entorno, 'AGENTE_HISTORIAL_CARACTERES', 8000, faltas, 500),
    retencionDias: numero(entorno, 'AGENTE_RETENCION_DIAS', 30, faltas, 1),
    zonaHoraria: entorno.AGENTE_ZONA_HORARIA?.trim() || 'America/Mexico_City',
  };

  if (faltas.length) {
    throw new Error('Configuración incompleta:\n  - ' + faltas.join('\n  - '));
  }
  return config;
}

/** Lo que se puede imprimir al arrancar: nada secreto, ningún número completo. */
export function resumenConfig(c: Config): Record<string, unknown> {
  return {
    modo: c.modo,
    escucha: c.modo === 'webhook' ? `${c.host}:${c.puerto}${c.rutaWebhook}` : '(no escucha: sondeo)',
    urlPublica: c.urlPublica ?? '(no aplica)',
    proveedor: c.proveedor,
    modelo: c.proveedor === 'deepseek' ? c.modelo : '(simulado)',
    topeDiarioUsd: c.topeDiarioUsd,
    maxTokens: c.maxTokens,
    datos: c.datos,
    avisosAlAdmin: c.twilio.admin ? 'sí' : 'no (falta ADMIN_WHATSAPP_TO)',
    presentarse: c.presentarse,
    sondeoMs: c.modo === 'sondeo' ? c.sondeoMs : undefined,
  };
}
