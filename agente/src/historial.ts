// Historial por número, en JSON Lines: datos/conversaciones/<dígitos>.jsonl.
// Tres podas:
//   - vueltas: sólo las últimas N (una vuelta = mensaje del cliente + respuesta);
//   - caracteres: el total no pasa de un tope (es lo que se manda al modelo);
//   - retención: nada de más de `retencionDias` días. Lo más viejo se borra.

import fs from 'node:fs';
import path from 'node:path';
import { anexarLinea, asegurarDir, escribirLineas, leerLineas } from './almacen.ts';

export type Rol = 'cliente' | 'agente';

export interface Entrada {
  /** ISO 8601. */
  t: string;
  rol: Rol;
  texto: string;
  sid?: string;
}

export interface OpcionesHistorial {
  vueltas: number;
  caracteres: number;
  retencionDias: number;
}

/**
 * Poda pura: las últimas `vueltas*2` entradas y, de ésas, las más recientes que
 * quepan en `caracteres`. La última entrada se conserva siempre (recortada si
 * sola ya rebasa el tope), para que el modelo nunca reciba un historial vacío.
 */
export function podar(entradas: Entrada[], vueltas: number, caracteres: number): Entrada[] {
  let out = entradas.slice(-vueltas * 2);
  let total = out.reduce((s, e) => s + e.texto.length, 0);
  while (out.length > 1 && total > caracteres) {
    total -= out[0].texto.length;
    out = out.slice(1);
  }
  if (out.length === 1 && out[0].texto.length > caracteres) {
    out = [{ ...out[0], texto: out[0].texto.slice(-caracteres) }];
  }
  return out;
}

export class Historial {
  readonly dir: string;
  readonly opciones: OpcionesHistorial;

  constructor(datos: string, opciones: OpcionesHistorial) {
    this.dir = path.join(datos, 'conversaciones');
    this.opciones = opciones;
    asegurarDir(this.dir);
  }

  archivo(numero: string): string {
    const digitos = numero.replace(/\D/g, '') || 'desconocido';
    return path.join(this.dir, `${digitos}.jsonl`);
  }

  leer(numero: string, ahora: Date = new Date()): Entrada[] {
    const limite = ahora.getTime() - this.opciones.retencionDias * 86_400_000;
    return leerLineas<Entrada>(this.archivo(numero)).filter((e) => Date.parse(e.t) >= limite);
  }

  anexar(numero: string, entrada: Entrada): void {
    const ruta = this.archivo(numero);
    anexarLinea(ruta, entrada);
    const todas = leerLineas<Entrada>(ruta);
    const podadas = podar(todas, this.opciones.vueltas, this.opciones.caracteres);
    if (podadas.length !== todas.length || podadas.at(-1)?.texto !== todas.at(-1)?.texto) {
      escribirLineas(ruta, podadas);
    }
  }

  ultimaActividad(numero: string): Date | undefined {
    const ultima = leerLineas<Entrada>(this.archivo(numero)).at(-1);
    return ultima ? new Date(ultima.t) : undefined;
  }

  /** Borra lo que tenga más de `retencionDias`. Devuelve cuántas entradas se fueron. */
  aplicarRetencion(ahora: Date = new Date()): number {
    const limite = ahora.getTime() - this.opciones.retencionDias * 86_400_000;
    let borradas = 0;
    for (const nombre of fs.readdirSync(this.dir)) {
      if (!nombre.endsWith('.jsonl')) continue;
      const ruta = path.join(this.dir, nombre);
      const todas = leerLineas<Entrada>(ruta);
      const vigentes = todas.filter((e) => Date.parse(e.t) >= limite);
      if (vigentes.length !== todas.length) {
        borradas += todas.length - vigentes.length;
        escribirLineas(ruta, vigentes);
      }
    }
    return borradas;
  }
}
