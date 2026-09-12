// Cliente mínimo de la WhatsApp Cloud API (Graph API de Meta): enviar texto y
// enviar una plantilla. `POST {base}/{versión}/{PHONE_NUMBER_ID}/messages` con
// `Authorization: Bearer <token>`. Las citas y URLs, en agente/LEEME.md
// § «Lo verificado».
//
// Dentro del agente los números van como dígitos con código de país (el `wa_id`
// que Meta manda en `from`). Al enviar, `to` va en E.164 con «+», como el
// ejemplo de la documentación («WhatsApp user phone number», `+16505551234`).

import { enmascarar, registrar } from './registro.ts';

export interface MensajeEntrante {
  /** El `id` del mensaje (wamid). Meta reintenta: se deduplica por él. */
  id: string;
  /** `from`: el wa_id del cliente, sólo dígitos. */
  de: string;
  /** `type` del mensaje: text, image, audio, reaction… */
  tipo: string;
  /** `text.body` si es texto; vacío si no. */
  cuerpo: string;
  fecha: Date;
}

export interface ResultadoEnvio {
  ok: boolean;
  id?: string;
  estado?: number;
  /** `error.code` de Meta (p. ej. 131047: fuera de la ventana de 24 h). */
  codigo?: number;
}

/** Lo que el agente necesita de WhatsApp. Las pruebas pueden darle otra cosa que cumpla. */
export interface Mensajeria {
  enviarTexto(para: string, cuerpo: string): Promise<ResultadoEnvio>;
  enviarPlantilla(para: string, nombre: string, idioma: string, parametros: string[]): Promise<ResultadoEnvio>;
}

export interface OpcionesMeta {
  base: string;
  version: string;
  phoneNumberId: string;
  token: string;
  tiempoMs?: number;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sólo dígitos: «+52 55 0000 0000» → «525500000000». */
export function digitos(numero: string): string {
  return numero.replace(/\D/g, '');
}

/**
 * ¿Es el mismo teléfono? Meta avisa: «For Brazil and Mexico, the extra added
 * prefix of the phone number may be modified by the Cloud API»
 * (https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers/).
 * En México ese prefijo es el «1» de móvil (52 1 + 10 dígitos). Así que
 * 521XXXXXXXXXX y 52XXXXXXXXXX cuentan como el mismo número. Sólo se usa para
 * COMPARAR (¿escribió Pablo?), nunca para decidir a qué número se manda.
 */
export function mismoNumero(a: string, b: string): boolean {
  const n = (x: string) => {
    const d = digitos(x);
    return /^521\d{10}$/.test(d) ? '52' + d.slice(3) : d;
  };
  return n(a) !== '' && n(a) === n(b);
}

export class ClienteMeta implements Mensajeria {
  readonly o: OpcionesMeta;

  constructor(o: OpcionesMeta) {
    this.o = o;
  }

  private url(): string {
    return `${this.o.base}/${encodeURIComponent(this.o.version)}/${encodeURIComponent(this.o.phoneNumberId)}/messages`;
  }

  enviarTexto(para: string, cuerpo: string): Promise<ResultadoEnvio> {
    return this.enviar(para, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+' + digitos(para),
      type: 'text',
      text: { preview_url: false, body: cuerpo },
    });
  }

  enviarPlantilla(para: string, nombre: string, idioma: string, parametros: string[]): Promise<ResultadoEnvio> {
    return this.enviar(para, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+' + digitos(para),
      type: 'template',
      template: {
        name: nombre,
        language: { code: idioma },
        components: parametros.length
          ? [{ type: 'body', parameters: parametros.map((text) => ({ type: 'text', text })) }]
          : [],
      },
    });
  }

  /** Nunca lanza. Un reintento corto ante red caída, 429 o 5xx. */
  private async enviar(para: string, cuerpo: unknown, intento = 0): Promise<ResultadoEnvio> {
    let res: Response;
    try {
      res = await fetch(this.url(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.o.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.o.tiempoMs ?? 15000),
      });
    } catch (e) {
      if (intento === 0) {
        await esperar(1000);
        return this.enviar(para, cuerpo, 1);
      }
      registrar('error', 'meta.envio.red', { para: enmascarar(para), error: (e as Error)?.name });
      return { ok: false };
    }
    const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { code?: number } };
    if (res.ok) return { ok: true, id: json.messages?.[0]?.id, estado: res.status };
    if (intento === 0 && (res.status === 429 || res.status >= 500)) {
      await esperar(1000);
      return this.enviar(para, cuerpo, 1);
    }
    // Sólo el código: el mensaje de error puede traer el número completo.
    registrar('error', 'meta.envio.rechazado', { para: enmascarar(para), estado: res.status, codigo: json.error?.code });
    return { ok: false, estado: res.status, codigo: json.error?.code };
  }
}
