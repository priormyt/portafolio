// Estado pequeño y persistente del agente:
//   - Vistos: `id` (wamid) de los mensajes ya procesados. Meta reintenta el
//     webhook y avisa que eso puede duplicar notificaciones; sin esto se
//     contestaría dos veces.
//   - Bajas: números que escribieron BAJA/STOP. No se les vuelve a contestar.
//   - Límites: cuántos mensajes por número y en total por hora (en memoria).

import path from 'node:path';
import { anexarLinea, escribirJson, escribirLineas, leerJson, leerLineas } from './almacen.ts';

export class Vistos {
  readonly ruta: string;
  readonly retencionDias: number;
  private mapa = new Map<string, number>();

  constructor(datos: string, retencionDias: number) {
    this.ruta = path.join(datos, 'vistos.jsonl');
    this.retencionDias = retencionDias;
    for (const { sid, t } of leerLineas<{ sid: string; t: number }>(this.ruta)) this.mapa.set(sid, t);
  }

  ya(sid: string): boolean {
    return this.mapa.has(sid);
  }

  /** Devuelve true si el sid es nuevo (y lo apunta); false si ya se había visto. */
  marcar(sid: string, ahora: Date = new Date()): boolean {
    if (this.mapa.has(sid)) return false;
    const t = ahora.getTime();
    this.mapa.set(sid, t);
    anexarLinea(this.ruta, { sid, t });
    return true;
  }

  compactar(ahora: Date = new Date()): void {
    const limite = ahora.getTime() - this.retencionDias * 86_400_000;
    for (const [sid, t] of this.mapa) if (t < limite) this.mapa.delete(sid);
    escribirLineas(this.ruta, [...this.mapa].map(([sid, t]) => ({ sid, t })));
  }
}

export type PalabraClave = 'baja' | 'alta';

const BAJA = new Set(['BAJA', 'DARDEBAJA', 'STOP', 'ALTO', 'PARAR', 'DETENER', 'UNSUBSCRIBE']);
const ALTA = new Set(['ALTA', 'START', 'REANUDAR']);

/**
 * Sólo cuenta si el mensaje ENTERO es la palabra (sin acentos ni signos):
 * «Baja.» es baja; «no quiero dar de baja mi sesión» no lo es.
 */
export function palabraClave(texto: string): PalabraClave | undefined {
  const n = texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (BAJA.has(n)) return 'baja';
  if (ALTA.has(n)) return 'alta';
  return undefined;
}

export class Bajas {
  readonly ruta: string;
  private numeros: Record<string, string>;

  constructor(datos: string) {
    this.ruta = path.join(datos, 'bajas.json');
    this.numeros = leerJson<Record<string, string>>(this.ruta, {});
  }

  es(numero: string): boolean {
    return Object.hasOwn(this.numeros, numero);
  }

  darDeBaja(numero: string, ahora: Date = new Date()): void {
    this.numeros[numero] = ahora.toISOString();
    escribirJson(this.ruta, this.numeros);
  }

  darDeAlta(numero: string): void {
    delete this.numeros[numero];
    escribirJson(this.ruta, this.numeros);
  }
}

export type MotivoLimite = 'numero' | 'global';

/** Ventana deslizante de una hora. En memoria: un reinicio la vacía, y está bien. */
export class Limites {
  readonly porNumero: number;
  readonly global: number;
  private marcas = new Map<string, number[]>();
  private todas: number[] = [];

  constructor(porNumeroHora: number, globalHora: number) {
    this.porNumero = porNumeroHora;
    this.global = globalHora;
  }

  permitir(numero: string, ahora: Date = new Date()): { ok: true } | { ok: false; motivo: MotivoLimite } {
    const hace1h = ahora.getTime() - 3_600_000;
    this.todas = this.todas.filter((t) => t > hace1h);
    const propias = (this.marcas.get(numero) ?? []).filter((t) => t > hace1h);
    this.marcas.set(numero, propias);
    if (this.todas.length >= this.global) return { ok: false, motivo: 'global' };
    if (propias.length >= this.porNumero) return { ok: false, motivo: 'numero' };
    propias.push(ahora.getTime());
    this.todas.push(ahora.getTime());
    return { ok: true };
  }
}
