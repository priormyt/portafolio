// Cliente mínimo de la API REST de Twilio (Programmable Messaging, 2010-04-01),
// verificado el 12 sep 2026 en https://www.twilio.com/docs/messaging/api/message-resource :
//   - Enviar: POST /2010-04-01/Accounts/{Sid}/Messages.json con From, To, Body
//     (Basic auth SID:token; igual que src/lib/whatsapp.ts del sitio).
//   - Listar: GET del mismo recurso. «Results are sorted by the `DateSent` field,
//     with the most recent messages appearing first.» El filtro DateSent sólo
//     acepta días GMT («YYYY-MM-DD», «>=YYYY-MM-DD»), así que el corte fino por
//     hora se hace aquí con `date_sent` (RFC 2822). `direction` = «inbound» son
//     los mensajes entrantes. No se filtra por `To` en el servidor: la
//     documentación sólo lo ilustra con números de teléfono, no con direcciones
//     `whatsapp:`; el volumen de la cuenta es pequeño y el filtro se hace aquí.
//   - Paginación: PageSize (máx. 1000) y `next_page_uri`.
//
// El Sandbox manda como mucho «one message every three seconds»
// (https://www.twilio.com/docs/whatsapp/sandbox): los envíos van en fila con un
// espacio mínimo configurable (AGENTE_ENVIO_INTERVALO_MS, 3000 por omisión).

import { enmascarar, registrar } from './registro.ts';

export interface MensajeEntrante {
  sid: string;
  de: string;
  para: string;
  cuerpo: string;
  fecha: Date;
  medios: number;
}

export interface ResultadoEnvio {
  ok: boolean;
  sid?: string;
  estado?: number;
  codigo?: number;
}

/** Lo que el agente necesita de Twilio. Las pruebas pueden darle otra cosa que cumpla. */
export interface Mensajeria {
  enviar(para: string, cuerpo: string): Promise<ResultadoEnvio>;
  listarEntrantes(desde: Date): Promise<MensajeEntrante[]>;
}

export interface OpcionesTwilio {
  base: string;
  sid: string;
  token: string;
  /** Nuestro número (whatsapp:+…). */
  desde: string;
  intervaloEnvioMs: number;
  tiempoMs?: number;
  maxPaginas?: number;
}

interface MensajeApi {
  sid: string;
  from: string;
  to: string;
  body: string | null;
  direction: string;
  date_sent: string | null;
  date_created: string | null;
  num_media?: string;
}

interface PaginaApi {
  messages?: MensajeApi[];
  next_page_uri?: string | null;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function diaGmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class ClienteTwilio implements Mensajeria {
  readonly o: OpcionesTwilio;
  private fila: Promise<unknown> = Promise.resolve();
  private ultimoEnvio = 0;

  constructor(o: OpcionesTwilio) {
    this.o = o;
  }

  private autorizacion(): string {
    return 'Basic ' + Buffer.from(`${this.o.sid}:${this.o.token}`).toString('base64');
  }

  private recurso(): string {
    return `${this.o.base}/2010-04-01/Accounts/${encodeURIComponent(this.o.sid)}/Messages.json`;
  }

  /** Envía en fila, respetando el espacio mínimo entre mensajes. Nunca lanza. */
  enviar(para: string, cuerpo: string): Promise<ResultadoEnvio> {
    const tarea = this.fila.then(async () => {
      const falta = this.ultimoEnvio + this.o.intervaloEnvioMs - Date.now();
      if (falta > 0) await esperar(falta);
      try {
        return await this.enviarAhora(para, cuerpo);
      } finally {
        this.ultimoEnvio = Date.now();
      }
    });
    this.fila = tarea.catch(() => undefined);
    return tarea;
  }

  private async enviarAhora(para: string, cuerpo: string, intento = 0): Promise<ResultadoEnvio> {
    let res: Response;
    try {
      res = await fetch(this.recurso(), {
        method: 'POST',
        headers: { Authorization: this.autorizacion(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: this.o.desde, To: para, Body: cuerpo }).toString(),
        signal: AbortSignal.timeout(this.o.tiempoMs ?? 15000),
      });
    } catch (e) {
      if (intento === 0) {
        await esperar(1000);
        return this.enviarAhora(para, cuerpo, 1);
      }
      registrar('error', 'twilio.envio.red', { para: enmascarar(para), error: (e as Error)?.name });
      return { ok: false };
    }
    const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number };
    if (res.ok) return { ok: true, sid: json.sid, estado: res.status };
    if (intento === 0 && (res.status === 429 || res.status >= 500)) {
      await esperar(1000);
      return this.enviarAhora(para, cuerpo, 1);
    }
    // Sólo el código de error: el mensaje de Twilio puede traer el número completo.
    registrar('error', 'twilio.envio.rechazado', { para: enmascarar(para), estado: res.status, codigo: json.code });
    return { ok: false, estado: res.status, codigo: json.code };
  }

  /** Mensajes entrantes a nuestro número con fecha ≥ `desde`, del más viejo al más nuevo. */
  async listarEntrantes(desde: Date): Promise<MensajeEntrante[]> {
    const q = new URLSearchParams({ 'DateSent>': diaGmt(desde), PageSize: '50' });
    let url: string | null = `${this.recurso()}?${q.toString()}`;
    const out: MensajeEntrante[] = [];
    for (let pagina = 0; url && pagina < (this.o.maxPaginas ?? 10); pagina++) {
      const res: Response = await fetch(url, {
        headers: { Authorization: this.autorizacion() },
        signal: AbortSignal.timeout(this.o.tiempoMs ?? 15000),
      });
      if (!res.ok) throw new Error(`Twilio listar: HTTP ${res.status}`);
      const json = (await res.json()) as PaginaApi;
      const mensajes = json.messages ?? [];
      let masViejo = Infinity;
      for (const m of mensajes) {
        const fecha = new Date(m.date_sent ?? m.date_created ?? 0);
        masViejo = Math.min(masViejo, fecha.getTime());
        if (m.direction !== 'inbound' || m.to !== this.o.desde) continue;
        if (fecha.getTime() < desde.getTime()) continue;
        out.push({ sid: m.sid, de: m.from, para: m.to, cuerpo: m.body ?? '', fecha, medios: Number(m.num_media ?? 0) });
      }
      // Vienen del más reciente al más viejo: si esta página ya llegó antes de
      // `desde`, las siguientes también.
      if (!mensajes.length || masViejo < desde.getTime() || !json.next_page_uri) break;
      url = `${this.o.base}${json.next_page_uri}`;
    }
    return out.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  }
}
