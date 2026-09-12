// Modo sondeo: el servicio no escucha nada. Cada `sondeoMs` le pregunta a la API
// REST de Twilio por los mensajes entrantes a nuestro número y contesta por la
// misma API. Cero exposición pública.
//
// Qué se ve en cada vuelta: todo lo entrante desde (ahora − VENTANA). La
// deduplicación por MessageSid (persistente) evita contestar dos veces lo que
// se vuelve a ver. Si una vuelta falla, la siguiente mira desde donde se quedó
// la última buena, para no perder lo que llegó durante el fallo.
//
// Al arrancar: si hay constancia de la última vuelta buena, se mira desde ahí
// (con un máximo de AGENTE_SONDEO_ATRASO_MAX_MIN); si es el primer arranque, sólo
// los últimos 2 minutos — no se contesta el historial viejo de la cuenta.

import path from 'node:path';
import type { Agente } from './agente.ts';
import { escribirJson, leerJson } from './almacen.ts';
import type { Config } from './config.ts';
import { registrar } from './registro.ts';
import type { Mensajeria } from './twilio.ts';

const VENTANA_MS = 10 * 60_000;
const PRIMER_ARRANQUE_MS = 2 * 60_000;

export class Sondeo {
  readonly agente: Agente;
  readonly twilio: Mensajeria;
  readonly config: Config;
  readonly reloj: () => Date;
  readonly ruta: string;
  /** Nunca se mira antes de esto: el corte del arranque. */
  readonly piso: number;
  private pendienteDesde: Date;
  private temporizador: NodeJS.Timeout | undefined;
  private activo = false;
  private fallos = 0;
  private vuelta: Promise<number> | undefined;

  constructor(agente: Agente, twilio: Mensajeria, config: Config, reloj: () => Date = () => new Date()) {
    this.agente = agente;
    this.twilio = twilio;
    this.config = config;
    this.reloj = reloj;
    this.ruta = path.join(config.datos, 'sondeo.json');
    const ahora = reloj().getTime();
    const previo = leerJson<{ ultimaBuena?: string }>(this.ruta, {}).ultimaBuena;
    const tope = ahora - config.sondeoAtrasoMaxMin * 60_000;
    this.piso = previo ? Math.max(Date.parse(previo) - 60_000, tope) : ahora - PRIMER_ARRANQUE_MS;
    this.pendienteDesde = new Date(this.piso);
  }

  /**
   * Una vuelta: lista desde max(piso, pendienteDesde), entrega al agente y
   * devuelve cuántos mensajes entregó (los duplicados los descarta el agente).
   * Si listar falla, lanza y `pendienteDesde` no se mueve: la próxima vuelta
   * cubre el hueco.
   */
  async unaVuelta(): Promise<number> {
    const ahora = this.reloj();
    const desde = new Date(Math.max(this.piso, this.pendienteDesde.getTime()));
    const mensajes = await this.twilio.listarEntrantes(desde);
    let entregados = 0;
    for (const m of mensajes) {
      if (m.fecha.getTime() < desde.getTime()) continue;
      if (this.agente.d.vistos.ya(m.sid)) continue;
      void this.agente.recibir(m);
      entregados += 1;
    }
    if (entregados) registrar('info', 'sondeo.entregados', { entregados });
    this.pendienteDesde = new Date(ahora.getTime() - VENTANA_MS);
    escribirJson(this.ruta, { ultimaBuena: ahora.toISOString() });
    return entregados;
  }

  iniciar(): void {
    this.activo = true;
    const ciclo = async () => {
      if (!this.activo) return;
      this.vuelta = this.unaVuelta();
      try {
        await this.vuelta;
        this.fallos = 0;
      } catch (e) {
        this.fallos += 1;
        registrar('error', 'sondeo.fallo', { fallos: this.fallos, error: String((e as Error)?.message ?? e) });
      }
      if (!this.activo) return;
      // Con fallos seguidos se espacia (hasta 1 min) para no martillar a Twilio.
      const espera = Math.min(this.config.sondeoMs * 2 ** Math.min(this.fallos, 4), 60_000);
      this.temporizador = setTimeout(ciclo, this.fallos ? espera : this.config.sondeoMs);
    };
    void ciclo();
  }

  async detener(): Promise<void> {
    this.activo = false;
    if (this.temporizador) clearTimeout(this.temporizador);
    await this.vuelta?.catch(() => undefined);
  }
}
