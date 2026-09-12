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

export type NombreProveedor = 'deepseek' | 'simulado';

/** Dólares por millón de tokens. */
export interface Precios {
  entradaCache: number;
  entrada: number;
  salida: number;
}

export interface Config {
  host: string;
  puerto: number;
  /** La única ruta que se sirve (la que manda el túnel). */
  rutaWebhook: string;
  datos: string;
  conocimiento: string;

  meta: {
    base: string;
    /** Versión de la Graph API, p. ej. v26.0. */
    version: string;
    phoneNumberId: string;
    token: string;
    appSecret: string;
    verifyToken: string;
    /** El WhatsApp de Pablo, en dígitos (E.164 sin «+»). Si falta, los avisos se registran y no se mandan. */
    admin: string | undefined;
    /** Plantilla de utilidad para avisar a Pablo fuera de su ventana de 24 h. */
    plantilla: { nombre: string; idioma: string } | undefined;
  };

  proveedor: NombreProveedor;
  modelo: string;
  deepseek: { base: string; llave: string | undefined };
  precios: Precios;
  topeDiarioUsd: number;
  maxTokens: number;
  tiempoModeloMs: number;

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

export const SECRETOS = ['META_ACCESS_TOKEN', 'META_APP_SECRET', 'META_VERIFY_TOKEN', 'DEEPSEEK_API_KEY', 'ADMIN_WHATSAPP_TO'] as const;

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

// Graph API: la más reciente el 12 sep 2026 es la v26.0 («Introducing Graph API
// v26.0», 29 jul 2026: https://developers.facebook.com/blog/post/2026/07/29/introducing-graph-api-v26-and-marketing-api-v26/).
export const VERSION_GRAPH_POR_OMISION = 'v26.0';

export const PRESENTACION_POR_OMISION =
  'Hola, soy el asistente automático de ANTE. Te ayudo con paquetes, precios y para apartar tu sesión; lo que yo no sepa, se lo paso a {humano}.';

export function cargarConfig(entorno: Entorno = process.env): Config {
  const faltas: string[] = [];

  const host = (entorno.AGENTE_HOST ?? '127.0.0.1').trim();
  if (!LOOPBACK.has(host)) {
    faltas.push('AGENTE_HOST sólo puede ser 127.0.0.1, ::1 o localhost: nada se publica en 0.0.0.0');
  }
  const puerto = numero(entorno, 'AGENTE_PUERTO', 9186, faltas);
  const rutaWebhook = (entorno.AGENTE_RUTA?.trim() || '/webhook/meta').replace(/\/+$/, '') || '/';
  if (!/^\/[\w\-/]*$/.test(rutaWebhook)) faltas.push('AGENTE_RUTA debe ser una ruta como /webhook/meta');

  const token = leerSecreto('META_ACCESS_TOKEN', entorno);
  const appSecret = leerSecreto('META_APP_SECRET', entorno);
  const verifyToken = leerSecreto('META_VERIFY_TOKEN', entorno);
  const adminCrudo = leerSecreto('ADMIN_WHATSAPP_TO', entorno);
  const llave = leerSecreto('DEEPSEEK_API_KEY', entorno);
  ocultarSecretos([token, appSecret, verifyToken, llave, adminCrudo, adminCrudo?.replace(/\D/g, '')]);

  if (!token) faltas.push('META_ACCESS_TOKEN');
  if (!appSecret) faltas.push('META_APP_SECRET (sin él no se puede comprobar la firma)');
  if (!verifyToken) faltas.push('META_VERIFY_TOKEN');
  else if (verifyToken.length < 16) faltas.push('META_VERIFY_TOKEN demasiado corto (usa openssl rand -hex 32)');
  const phoneNumberId = entorno.META_PHONE_NUMBER_ID?.trim();
  if (!phoneNumberId) faltas.push('META_PHONE_NUMBER_ID');
  else if (!/^\d{5,30}$/.test(phoneNumberId)) faltas.push('META_PHONE_NUMBER_ID debe ser sólo dígitos');
  const version = entorno.META_GRAPH_VERSION?.trim() || VERSION_GRAPH_POR_OMISION;
  if (!/^v\d{1,3}\.\d$/.test(version)) faltas.push('META_GRAPH_VERSION debe verse como v26.0');
  if (adminCrudo && !/^\+?\d{8,15}$/.test(adminCrudo)) faltas.push('ADMIN_WHATSAPP_TO debe ir en E.164, p. ej. +5215500000000');

  const plantillaNombre = entorno.AGENTE_PLANTILLA_AVISO?.trim();
  const plantillaIdioma = entorno.AGENTE_PLANTILLA_IDIOMA?.trim();
  if (Boolean(plantillaNombre) !== Boolean(plantillaIdioma)) {
    faltas.push('AGENTE_PLANTILLA_AVISO y AGENTE_PLANTILLA_IDIOMA van juntas (o ninguna)');
  }
  if (plantillaNombre && !/^[a-z0-9_]{1,512}$/.test(plantillaNombre)) faltas.push('AGENTE_PLANTILLA_AVISO: minúsculas, dígitos y «_»');
  if (plantillaIdioma && !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(plantillaIdioma)) faltas.push('AGENTE_PLANTILLA_IDIOMA como es_MX');

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
    host,
    puerto,
    rutaWebhook,
    datos: path.resolve(entorno.AGENTE_DATOS?.trim() || path.join(RAIZ_AGENTE, '.datos')),
    conocimiento: path.resolve(entorno.AGENTE_CONOCIMIENTO?.trim() || path.join(RAIZ_AGENTE, 'conocimiento.md')),
    meta: {
      base: (entorno.META_GRAPH_BASE?.trim() || 'https://graph.facebook.com').replace(/\/$/, ''),
      version,
      phoneNumberId: phoneNumberId ?? '',
      token: token ?? '',
      appSecret: appSecret ?? '',
      verifyToken: verifyToken ?? '',
      admin: adminCrudo ? adminCrudo.replace(/\D/g, '') : undefined,
      plantilla: plantillaNombre && plantillaIdioma ? { nombre: plantillaNombre, idioma: plantillaIdioma } : undefined,
    },
    proveedor,
    modelo: entorno.AGENTE_MODELO?.trim() || 'deepseek-flash',
    deepseek: { base: (entorno.DEEPSEEK_API_BASE?.trim() || 'https://api.deepseek.com').replace(/\/$/, ''), llave },
    precios,
    topeDiarioUsd: numero(entorno, 'AGENTE_TOPE_DIARIO_USD', 0.5, faltas),
    maxTokens: Math.min(numero(entorno, 'AGENTE_MAX_TOKENS', 400, faltas, 16), 1000),
    tiempoModeloMs: numero(entorno, 'AGENTE_TIEMPO_MODELO_MS', 20000, faltas, 1000),
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
    escucha: `${c.host}:${c.puerto}${c.rutaWebhook}`,
    graph: `${c.meta.version} · phone_number_id …${c.meta.phoneNumberId.slice(-4)}`,
    proveedor: c.proveedor,
    modelo: c.proveedor === 'deepseek' ? c.modelo : '(simulado)',
    topeDiarioUsd: c.topeDiarioUsd,
    maxTokens: c.maxTokens,
    datos: c.datos,
    avisosAlAdmin: c.meta.admin ? 'sí' : 'no (falta ADMIN_WHATSAPP_TO)',
    plantillaAviso: c.meta.plantilla ? `${c.meta.plantilla.nombre}/${c.meta.plantilla.idioma}` : 'no (fuera de la ventana de 24 h los avisos quedan pendientes)',
    presentarse: c.presentarse,
  };
}
