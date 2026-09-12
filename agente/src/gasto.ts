// Tope de gasto diario, en el código y no en la consola del proveedor.
//
// costo = tokens × precio (así lo define DeepSeek: «The expense = number of
// tokens × price», https://api-docs.deepseek.com/quick_start/pricing/).
// El día es el de la Ciudad de México. Antes de cada llamada se RESERVA el peor
// caso (entrada estimada por lo alto + max_tokens de salida): si no cabe bajo el
// tope, no se llama. Así el tope no se rebasa ni con llamadas simultáneas.

import path from 'node:path';
import type { Precios } from './config.ts';
import { escribirJson, leerJson } from './almacen.ts';

export interface Uso {
  /** Tokens de entrada que NO acertaron la caché (cache miss). */
  entrada: number;
  /** Tokens de entrada que acertaron la caché (cache hit). */
  entradaCache: number;
  salida: number;
}

interface Dia {
  usd: number;
  llamadas: number;
  entrada: number;
  entradaCache: number;
  salida: number;
  topeAvisado?: boolean;
}

export function costoUsd(uso: Uso, p: Precios): number {
  return (uso.entrada * p.entrada + uso.entradaCache * p.entradaCache + uso.salida * p.salida) / 1_000_000;
}

/** YYYY-MM-DD en la zona dada. */
export function fechaLocal(ahora: Date, zona: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

export class Gasto {
  readonly ruta: string;
  readonly tope: number;
  readonly precios: Precios;
  readonly zona: string;
  private dias: Record<string, Dia>;
  private reservado = 0;

  constructor(datos: string, tope: number, precios: Precios, zona: string) {
    this.ruta = path.join(datos, 'gasto.json');
    this.tope = tope;
    this.precios = precios;
    this.zona = zona;
    this.dias = leerJson<Record<string, Dia>>(this.ruta, {});
  }

  private dia(ahora: Date): Dia {
    const f = fechaLocal(ahora, this.zona);
    this.dias[f] ??= { usd: 0, llamadas: 0, entrada: 0, entradaCache: 0, salida: 0 };
    return this.dias[f];
  }

  gastadoHoy(ahora: Date = new Date()): number {
    return this.dia(ahora).usd;
  }

  /**
   * Peor caso de una llamada: toda la entrada sin caché, estimada a razón de un
   * token cada 2 caracteres (en español suele ser uno cada 3 o 4: esto exagera a
   * propósito), más `maxTokens` completos de salida.
   */
  estimarMaximo(caracteresEntrada: number, maxTokens: number): number {
    return costoUsd({ entrada: Math.ceil(caracteresEntrada / 2), entradaCache: 0, salida: maxTokens }, this.precios);
  }

  /** Reserva `usd` si cabe bajo el tope. Devuelve false si no cabe (y entonces no se llama al modelo). */
  reservar(usd: number, ahora: Date = new Date()): boolean {
    if (this.dia(ahora).usd + this.reservado + usd > this.tope) return false;
    this.reservado += usd;
    return true;
  }

  /** Libera la reserva y apunta lo que de verdad se gastó. */
  liquidar(reserva: number, uso: Uso | undefined, ahora: Date = new Date()): number {
    this.reservado = Math.max(0, this.reservado - reserva);
    if (!uso) return 0;
    const usd = costoUsd(uso, this.precios);
    const d = this.dia(ahora);
    d.usd += usd;
    d.llamadas += 1;
    d.entrada += uso.entrada;
    d.entradaCache += uso.entradaCache;
    d.salida += uso.salida;
    this.guardar();
    return usd;
  }

  /** true la primera vez del día; sirve para avisar a Pablo una sola vez. */
  marcarTopeAvisado(ahora: Date = new Date()): boolean {
    const d = this.dia(ahora);
    if (d.topeAvisado) return false;
    d.topeAvisado = true;
    this.guardar();
    return true;
  }

  resumenHoy(ahora: Date = new Date()): Dia & { fecha: string } {
    return { fecha: fechaLocal(ahora, this.zona), ...this.dia(ahora) };
  }

  private guardar(): void {
    // Se conservan 60 días de contabilidad; lo demás se descarta.
    const fechas = Object.keys(this.dias).sort();
    for (const f of fechas.slice(0, Math.max(0, fechas.length - 60))) delete this.dias[f];
    escribirJson(this.ruta, this.dias);
  }
}
