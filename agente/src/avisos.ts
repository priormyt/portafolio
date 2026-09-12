// Avisos a Pablo, con el hueco a la vista.
//
// Con la Cloud API, un mensaje que INICIA el negocio fuera de la ventana de
// 24 h del destinatario sólo puede ser una plantilla aprobada. El aviso a
// Pablo es justo eso: el negocio le escribe a él. Así que:
//   (a) si Pablo escribió al número de ANTE en las últimas 24 h (menos un
//       margen), va como texto libre;
//   (b) si no, y hay plantilla configurada (AGENTE_PLANTILLA_AVISO y
//       AGENTE_PLANTILLA_IDIOMA), va como plantilla de utilidad con el aviso
//       resumido en su único parámetro;
//   (c) si no hay ni ventana ni plantilla, NO llega: queda en
//       datos/avisos-pendientes.jsonl, se registra con nivel «error», y se
//       manda en cuanto Pablo escriba (eso abre la ventana).
// Si Meta rechaza el texto libre por la ventana (código 131047), se sigue por
// (b) y luego (c). No hay correo ni otro canal: eso lo decide Pablo.

import path from 'node:path';
import { anexarLinea, escribirJson, escribirLineas, leerJson, leerLineas } from './almacen.ts';
import type { Mensajeria } from './meta.ts';
import { mismoNumero } from './meta.ts';
import { registrar } from './registro.ts';

export const VENTANA_MS = 24 * 3_600_000;
/** Margen: no se apuesta a los últimos 30 minutos de la ventana. */
export const MARGEN_MS = 30 * 60_000;
const FUERA_DE_VENTANA = 131047;

export interface OpcionesAvisos {
  datos: string;
  admin: string | undefined;
  plantilla: { nombre: string; idioma: string } | undefined;
  retencionDias: number;
  reloj?: () => Date;
}

interface Pendiente {
  t: string;
  texto: string;
}

export type Via = 'texto' | 'plantilla' | 'pendiente' | 'sin_destino';

export class Avisos {
  readonly o: OpcionesAvisos;
  readonly whatsapp: Mensajeria;
  readonly rutaVentanas: string;
  readonly rutaPendientes: string;
  private ventanas: Record<string, string>;

  constructor(o: OpcionesAvisos, whatsapp: Mensajeria) {
    this.o = o;
    this.whatsapp = whatsapp;
    this.rutaVentanas = path.join(o.datos, 'ventanas.json');
    this.rutaPendientes = path.join(o.datos, 'avisos-pendientes.jsonl');
    this.ventanas = leerJson<Record<string, string>>(this.rutaVentanas, {});
  }

  private ahora(): Date {
    return this.o.reloj ? this.o.reloj() : new Date();
  }

  esAdmin(numero: string): boolean {
    return Boolean(this.o.admin) && mismoNumero(numero, this.o.admin!);
  }

  /** Apunta que `numero` acaba de escribir: su ventana de 24 h se abre ahora. */
  registrarEntrante(numero: string, t: Date = this.ahora()): void {
    // Sólo se guarda la ventana de Pablo: la de los clientes no hace falta
    // (se les contesta a lo que acaban de escribir) y así no se acumulan números.
    if (!this.esAdmin(numero)) return;
    this.ventanas.admin = t.toISOString();
    escribirJson(this.rutaVentanas, this.ventanas);
  }

  ventanaAdminAbierta(t: Date = this.ahora()): boolean {
    const ultima = this.ventanas.admin ? Date.parse(this.ventanas.admin) : NaN;
    return Number.isFinite(ultima) && t.getTime() < ultima + VENTANA_MS - MARGEN_MS;
  }

  pendientes(): Pendiente[] {
    return leerLineas<Pendiente>(this.rutaPendientes);
  }

  async avisar(texto: string): Promise<Via> {
    const admin = this.o.admin;
    if (!admin) {
      registrar('aviso', 'aviso_admin.sin_destino', { caracteres: texto.length });
      return 'sin_destino';
    }
    if (this.ventanaAdminAbierta()) {
      const r = await this.whatsapp.enviarTexto(admin, texto);
      if (r.ok) {
        registrar('info', 'aviso_admin', { via: 'texto' });
        return 'texto';
      }
      if (r.codigo !== FUERA_DE_VENTANA) registrar('error', 'aviso_admin.texto_fallo', { estado: r.estado, codigo: r.codigo });
    }
    const p = this.o.plantilla;
    if (p) {
      const r = await this.whatsapp.enviarPlantilla(admin, p.nombre, p.idioma, [resumirParaPlantilla(texto)]);
      if (r.ok) {
        registrar('info', 'aviso_admin', { via: 'plantilla', plantilla: p.nombre });
        return 'plantilla';
      }
      registrar('error', 'aviso_admin.plantilla_fallo', { estado: r.estado, codigo: r.codigo });
    }
    const pendiente: Pendiente = { t: this.ahora().toISOString(), texto };
    anexarLinea(this.rutaPendientes, pendiente);
    registrar('error', 'aviso_admin.NO_ENTREGADO', {
      motivo: p ? 'la plantilla falló y la ventana de 24 h de Pablo está cerrada' : 'ventana de 24 h cerrada y sin AGENTE_PLANTILLA_AVISO',
      pendientes: this.pendientes().length,
      queHacer: 'que Pablo escriba cualquier cosa al número de ANTE: se manda al instante',
    });
    return 'pendiente';
  }

  /** Pablo escribió: su ventana está abierta, se manda lo pendiente. Devuelve cuántos salieron. */
  async vaciarPendientes(): Promise<number> {
    const admin = this.o.admin;
    const lista = this.pendientes();
    if (!admin || !lista.length) return 0;
    const quedan: Pendiente[] = [];
    let enviados = 0;
    for (const [i, p] of lista.entries()) {
      const r = await this.whatsapp.enviarTexto(admin, `(aviso pendiente del ${p.t.slice(0, 16).replace('T', ' ')} UTC)\n${p.texto}`);
      if (r.ok) enviados += 1;
      else {
        quedan.push(...lista.slice(i));
        break;
      }
    }
    escribirLineas(this.rutaPendientes, quedan);
    registrar(quedan.length ? 'error' : 'info', 'aviso_admin.pendientes', { enviados, quedan: quedan.length });
    return enviados;
  }

  /** Los pendientes también caducan (llevan números y mensajes de clientes). */
  aplicarRetencion(t: Date = this.ahora()): void {
    const limite = t.getTime() - this.o.retencionDias * 86_400_000;
    const todas = this.pendientes();
    const vigentes = todas.filter((p) => Date.parse(p.t) >= limite);
    if (vigentes.length !== todas.length) escribirLineas(this.rutaPendientes, vigentes);
  }
}

/**
 * Un parámetro de plantilla va en una sola línea: se cambian los saltos por
 * « · » y se recorta. (Precaución nuestra: los parámetros con saltos de línea
 * o tabuladores los rechaza Meta, según reportes; no está en las citas.)
 */
export function resumirParaPlantilla(texto: string, max = 900): string {
  const t = texto.replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

