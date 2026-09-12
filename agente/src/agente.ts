// El núcleo: recibe un mensaje entrante (venga del webhook o del sondeo) y
// decide qué contestar. Es el mismo para los dos modos.
//
// Orden de las compuertas, de la más barata a la más cara:
//   duplicado → otro número → BAJA/ALTA → número dado de baja → límites →
//   sólo medios → tope de gasto → modelo → validación → envío → avisos a Pablo.

import type { Config } from './config.ts';
import type { Conocimiento } from './conocimiento.ts';
import { promptSistema } from './conocimiento.ts';
import type { Bajas, Limites, Vistos } from './estado.ts';
import { palabraClave } from './estado.ts';
import type { Gasto } from './gasto.ts';
import type { Entrada, Historial } from './historial.ts';
import type { MensajeModelo, Proveedor, RespuestaModelo } from './modelo.ts';
import { enmascarar, registrar } from './registro.ts';
import type { Accion } from './salida.ts';
import { extraerAcciones, LIMITE_TWILIO, validarSalida } from './salida.ts';
import type { MensajeEntrante, Mensajeria } from './twilio.ts';

export type Desenlace =
  | 'duplicado'
  | 'ignorado'
  | 'baja'
  | 'alta'
  | 'silencio_baja'
  | 'limite_numero'
  | 'limite_global'
  | 'solo_medios'
  | 'tope'
  | 'fallo_modelo'
  | 'rechazado'
  | 'respondido';

export interface Resultado {
  desenlace: Desenlace;
  respuesta?: string;
  acciones?: Accion[];
}

export interface Dependencias {
  config: Config;
  twilio: Mensajeria;
  proveedor: Proveedor;
  conocimiento: Conocimiento;
  historial: Historial;
  vistos: Vistos;
  bajas: Bajas;
  limites: Limites;
  gasto: Gasto;
  reloj?: () => Date;
}

export function textos(humano: string) {
  return {
    baja: 'Listo: el asistente de ANTE ya no te escribirá a este número. Si cambias de opinión, escribe ALTA.',
    alta: 'Listo, el asistente de ANTE vuelve a contestar en este número.',
    soloMedios: 'Por ahora sólo leo texto. Escríbeme lo que necesitas y te ayudo.',
    tope: `Ahora mismo no puedo contestarte en automático. Ya le pasé tu mensaje a ${humano} y te escribe él por aquí.`,
    fallo: `Tuve un problema para contestarte. Ya le pasé tu mensaje a ${humano} y te escribe él por aquí.`,
    rechazo: `Eso prefiero que te lo confirme ${humano} directamente. Ya le pasé tu mensaje y te escribe por aquí.`,
  };
}

function cita(texto: string, max = 300): string {
  const t = texto.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export class Agente {
  readonly d: Dependencias;
  readonly t: ReturnType<typeof textos>;
  private colas = new Map<string, Promise<unknown>>();
  private enCurso = new Set<Promise<unknown>>();
  /** Avisos de tope y de límite global ya mandados (una vez por número y día / por hora). */
  private avisados = new Set<string>();

  constructor(d: Dependencias) {
    this.d = d;
    this.t = textos(d.config.humano);
  }

  private ahora(): Date {
    return this.d.reloj ? this.d.reloj() : new Date();
  }

  /**
   * Punto de entrada de los dos modos. La deduplicación es SÍNCRONA y va
   * primero: si el webhook reintentado y el sondeo traen el mismo MessageSid a la
   * vez, sólo uno pasa. Luego, en fila por número (orden de la conversación).
   */
  recibir(m: MensajeEntrante): Promise<Resultado> {
    if (!m.sid || !this.d.vistos.marcar(m.sid, this.ahora())) {
      return Promise.resolve({ desenlace: 'duplicado' });
    }
    const previa = this.colas.get(m.de) ?? Promise.resolve();
    const tarea = previa.then(() => this.procesar(m)).catch((e) => {
      registrar('error', 'agente.procesar', { de: enmascarar(m.de), error: String((e as Error)?.message ?? e) });
      return { desenlace: 'fallo_modelo' } as Resultado;
    });
    this.colas.set(m.de, tarea);
    this.enCurso.add(tarea);
    tarea.finally(() => {
      this.enCurso.delete(tarea);
      if (this.colas.get(m.de) === tarea) this.colas.delete(m.de);
    });
    return tarea;
  }

  /** Espera a que no quede nada en proceso (pruebas, simulador y apagado ordenado). */
  async esperarInactividad(): Promise<void> {
    while (this.enCurso.size) await Promise.allSettled([...this.enCurso]);
  }

  private async procesar(m: MensajeEntrante): Promise<Resultado> {
    const { config, bajas, limites, historial } = this.d;
    const ahora = this.ahora();
    const de = m.de;
    const log = { de: enmascarar(de), sid: m.sid };

    if (m.para !== config.twilio.desde || de === config.twilio.desde || !de.startsWith('whatsapp:')) {
      registrar('aviso', 'agente.ignorado', { ...log, motivo: 'no es un WhatsApp a nuestro número' });
      return { desenlace: 'ignorado' };
    }

    const clave = palabraClave(m.cuerpo);
    if (clave === 'baja') {
      bajas.darDeBaja(de, ahora);
      await this.d.twilio.enviar(de, this.t.baja);
      registrar('info', 'agente.baja', log);
      return { desenlace: 'baja', respuesta: this.t.baja };
    }
    if (clave === 'alta' && bajas.es(de)) {
      bajas.darDeAlta(de);
      await this.d.twilio.enviar(de, this.t.alta);
      registrar('info', 'agente.alta', log);
      return { desenlace: 'alta', respuesta: this.t.alta };
    }
    if (bajas.es(de)) {
      // Ni se contesta ni se guarda lo que escribió.
      registrar('info', 'agente.silencio_baja', log);
      return { desenlace: 'silencio_baja' };
    }

    const permiso = limites.permitir(de, ahora);
    if (!permiso.ok) {
      registrar('aviso', `agente.limite_${permiso.motivo}`, log);
      if (permiso.motivo === 'global') {
        const marca = `global:${ahora.toISOString().slice(0, 13)}`;
        if (!this.avisados.has(marca)) {
          this.avisados.add(marca);
          await this.avisarAdmin(`⚠️ Asistente de ANTE: se alcanzó el límite global de ${limites.global} mensajes por hora. Deja de contestar hasta que baje.`);
        }
        return { desenlace: 'limite_global' };
      }
      return { desenlace: 'limite_numero' };
    }

    if (!m.cuerpo.trim()) {
      if (m.medios > 0) {
        await this.d.twilio.enviar(de, this.t.soloMedios);
        return { desenlace: 'solo_medios', respuesta: this.t.soloMedios };
      }
      return { desenlace: 'ignorado' };
    }

    const cuerpo = m.cuerpo.slice(0, LIMITE_TWILIO);
    const ultima = historial.ultimaActividad(de);
    const primerMensaje = !ultima || ahora.getTime() - ultima.getTime() > config.conversacionHoras * 3_600_000;
    historial.anexar(de, { t: ahora.toISOString(), rol: 'cliente', texto: cuerpo, sid: m.sid });

    const mensajes = this.armarMensajes(historial.leer(de, ahora), primerMensaje, ahora);
    const caracteres = mensajes.reduce((s, x) => s + x.content.length, 0);

    // ── Tope de gasto: se reserva el peor caso antes de llamar.
    const reserva = this.d.gasto.estimarMaximo(caracteres, config.maxTokens);
    if (!this.d.gasto.reservar(reserva, ahora)) {
      registrar('aviso', 'agente.tope', { ...log, gastadoHoyUsd: this.d.gasto.gastadoHoy(ahora), topeUsd: this.d.gasto.tope });
      const marca = `tope:${de}:${this.d.gasto.resumenHoy(ahora).fecha}`;
      if (!this.avisados.has(marca)) {
        this.avisados.add(marca);
        const primeraVezHoy = this.d.gasto.marcarTopeAvisado(ahora);
        await this.avisarAdmin(
          [
            primeraVezHoy
              ? `⚠️ Asistente de ANTE: se alcanzó el tope de gasto de hoy (US$${this.d.gasto.tope}). Ya no llama al modelo hasta mañana.`
              : '⚠️ Asistente de ANTE, tope de gasto: otro cliente escribió.',
            `Cliente: ${de}`,
            `Mensaje: «${cita(cuerpo)}»`,
          ].join('\n'),
        );
      }
      return this.contestar(de, this.t.tope, 'tope', []);
    }

    let respuesta: RespuestaModelo | undefined;
    try {
      respuesta = await this.d.proveedor.responder(mensajes);
    } catch (e) {
      this.d.gasto.liquidar(reserva, undefined, ahora);
      registrar('error', 'agente.modelo', { ...log, error: String((e as Error)?.message ?? e) });
      await this.avisarAdmin(
        [`⚠️ El asistente de ANTE no pudo contestar (falló el modelo).`, `Cliente: ${de}`, `Mensaje: «${cita(cuerpo)}»`].join('\n'),
      );
      return this.contestar(de, this.t.fallo, 'fallo_modelo', []);
    }
    const usd = this.d.gasto.liquidar(reserva, respuesta.uso, ahora);
    registrar('info', 'agente.modelo.ok', { ...log, tokens: respuesta.uso, usd: Number(usd.toFixed(6)) });

    const { texto, acciones } = extraerAcciones(respuesta.texto);
    const intro = primerMensaje && config.presentarse ? config.textoPresentacion : '';
    const limite = LIMITE_TWILIO - (intro ? intro.length + 2 : 0);
    const v = validarSalida(texto, this.d.conocimiento.permitidos, limite);
    if (v.problemas.length) registrar('aviso', 'agente.salida', { ...log, problemas: v.problemas });

    if (!v.ok) {
      acciones.push({ tipo: 'pasar', motivo: `respuesta automática descartada (${v.problemas.join('; ')})` });
      await this.avisar(de, cuerpo, acciones);
      return this.contestar(de, (intro ? intro + '\n\n' : '') + this.t.rechazo, 'rechazado', acciones);
    }

    const final = (intro ? intro + '\n\n' : '') + v.texto;
    const resultado = await this.contestar(de, final, 'respondido', acciones);
    await this.avisar(de, cuerpo, acciones);
    return resultado;
  }

  private armarMensajes(entradas: Entrada[], primerMensaje: boolean, ahora: Date): MensajeModelo[] {
    const { config, conocimiento } = this.d;
    const sistema = promptSistema(conocimiento, {
      humano: config.humano,
      presentacionAparte: config.presentarse,
      primerMensaje,
      zonaHoraria: config.zonaHoraria,
      ahora,
    });
    return [
      { role: 'system', content: sistema },
      ...entradas.map((e): MensajeModelo => ({ role: e.rol === 'cliente' ? 'user' : 'assistant', content: e.texto })),
    ];
  }

  private async contestar(de: string, texto: string, desenlace: Desenlace, acciones: Accion[]): Promise<Resultado> {
    const envio = await this.d.twilio.enviar(de, texto);
    this.d.historial.anexar(de, { t: this.ahora().toISOString(), rol: 'agente', texto });
    registrar(envio.ok ? 'info' : 'error', 'agente.respuesta', {
      de: enmascarar(de),
      desenlace,
      caracteres: texto.length,
      enviado: envio.ok,
      acciones: acciones.map((a) => a.tipo),
    });
    return { desenlace, respuesta: texto, acciones };
  }

  private async avisar(de: string, ultimo: string, acciones: Accion[]): Promise<void> {
    for (const a of acciones) {
      if (a.tipo === 'agendar') {
        await this.avisarAdmin(
          [
            '📅 Solicitud de sesión (asistente de ANTE)',
            `Cliente: ${de}`,
            `Nombre: ${a.nombre}`,
            `Sesión: ${a.sesion}`,
            `Fecha preferida: ${a.fecha}`,
            '',
            'El asistente le dijo que tú confirmas disponibilidad y anticipo.',
          ].join('\n'),
        );
      } else {
        await this.avisarAdmin(
          ['🙋 El asistente de ANTE te pasa una conversación', `Cliente: ${de}`, `Motivo: ${a.motivo}`, `Último mensaje: «${cita(ultimo)}»`].join('\n'),
        );
      }
    }
  }

  /**
   * Aviso a Pablo por la misma vía que src/lib/whatsapp.ts (Twilio REST a
   * ADMIN_WHATSAPP_TO). Nunca tumba la conversación: en el Sandbox, fuera de la
   * ventana de 24 h de Pablo, un mensaje iniciado por el negocio puede rebotar.
   */
  private async avisarAdmin(texto: string): Promise<void> {
    const admin = this.d.config.twilio.admin;
    if (!admin) {
      registrar('aviso', 'agente.aviso_admin.sin_destino', { caracteres: texto.length });
      return;
    }
    const r = await this.d.twilio.enviar(admin, texto.slice(0, LIMITE_TWILIO));
    registrar(r.ok ? 'info' : 'error', 'agente.aviso_admin', { enviado: r.ok, estado: r.estado, codigo: r.codigo });
  }
}
