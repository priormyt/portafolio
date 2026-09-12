// Proveedores de modelo, enchufables. El modelo SÓLO produce texto: no tiene
// herramientas y no escribe nada en ningún lado. Lo que el texto pide (avisar a
// Pablo) lo decide y lo hace el código, a un destino fijo.
//
// deepseek — API compatible con OpenAI. Verificado el 12 sep 2026 en
//   https://api-docs.deepseek.com/api/create-chat-completion :
//   POST /chat/completions en https://api.deepseek.com, `model` ∈ {deepseek-flash,
//   deepseek-v4-pro}, `thinking` {type: enabled|disabled} (el modo con
//   razonamiento viene ENCENDIDO por omisión, https://api-docs.deepseek.com/guides/thinking_mode/),
//   y `usage` con prompt_cache_hit_tokens / prompt_cache_miss_tokens / completion_tokens.
// simulado — determinista, sin red. Es el que corre si no hay llave.

import type { Conocimiento } from './conocimiento.ts';
import type { Uso } from './gasto.ts';

export interface MensajeModelo {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RespuestaModelo {
  texto: string;
  uso: Uso;
}

export interface Proveedor {
  nombre: string;
  responder(mensajes: MensajeModelo[]): Promise<RespuestaModelo>;
}

export class ErrorModelo extends Error {
  readonly reintentable: boolean;
  readonly estado: number | undefined;
  constructor(mensaje: string, reintentable: boolean, estado?: number) {
    super(mensaje);
    this.name = 'ErrorModelo';
    this.reintentable = reintentable;
    this.estado = estado;
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── DeepSeek ─────────────────────────────────────────────────────────────────

export interface OpcionesDeepSeek {
  base: string;
  llave: string;
  modelo: string;
  maxTokens: number;
  tiempoMs: number;
  /** Reintentos tras el primer intento (corto: uno). */
  reintentos?: number;
  esperaReintentoMs?: number;
}

interface CuerpoRespuesta {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

export function crearDeepSeek(o: OpcionesDeepSeek): Proveedor {
  const reintentos = o.reintentos ?? 1;
  const espera = o.esperaReintentoMs ?? 1500;

  async function intento(mensajes: MensajeModelo[]): Promise<RespuestaModelo> {
    let res: Response;
    try {
      res = await fetch(`${o.base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${o.llave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: o.modelo,
          messages: mensajes,
          max_tokens: o.maxTokens,
          temperature: 0.3,
          stream: false,
          thinking: { type: 'disabled' },
        }),
        signal: AbortSignal.timeout(o.tiempoMs),
      });
    } catch (e) {
      const nombre = (e as Error)?.name;
      throw new ErrorModelo(nombre === 'TimeoutError' ? `sin respuesta en ${o.tiempoMs} ms` : `red: ${nombre}`, true);
    }
    if (!res.ok) {
      await res.text().catch(() => '');
      // 429 y 5xx se reintentan; 400/401/402 (saldo)/422 no: reintentar no los arregla.
      throw new ErrorModelo(`HTTP ${res.status}`, res.status === 429 || res.status >= 500, res.status);
    }
    const cuerpo = (await res.json().catch(() => ({}))) as CuerpoRespuesta;
    const eleccion = cuerpo.choices?.[0];
    const texto = eleccion?.message?.content ?? '';
    const u = cuerpo.usage ?? {};
    const cache = u.prompt_cache_hit_tokens ?? 0;
    const uso: Uso = {
      entradaCache: cache,
      entrada: u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens ?? 0) - cache),
      salida: u.completion_tokens ?? 0,
    };
    if (eleccion?.finish_reason === 'content_filter') return { texto: '', uso };
    return { texto, uso };
  }

  return {
    nombre: `deepseek:${o.modelo}`,
    async responder(mensajes) {
      let ultimo: unknown;
      for (let i = 0; i <= reintentos; i++) {
        try {
          return await intento(mensajes);
        } catch (e) {
          ultimo = e;
          if (!(e instanceof ErrorModelo) || !e.reintentable || i === reintentos) break;
          await esperar(espera);
        }
      }
      throw ultimo;
    },
  };
}

// ── Simulado ─────────────────────────────────────────────────────────────────
// Reglas fijas sobre el último mensaje y lo que el cliente ya dijo. Sirve para
// ver el circuito completo sin red y sin gastar; no pretende conversar bien.
// Cuenta tokens a razón de uno cada 4 caracteres, para que el tope de gasto
// también se ejercite.

function normalizar(t: string): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const DIAS = '(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)';
const MESES = '(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)';

function buscarFecha(textoOriginal: string): string | undefined {
  const n = normalizar(textoOriginal);
  const re = new RegExp(`(${DIAS}(?:\\s+\\d{1,2})?(?:\\s+de\\s+${MESES})?|\\d{1,2}\\s+de\\s+${MESES})(?:\\s+(?:en|por)\\s+la\\s+(?:manana|tarde))?`);
  const m = re.exec(n);
  if (!m) return undefined;
  // Se devuelve el fragmento con sus acentos originales.
  return textoOriginal.slice(m.index, m.index + m[0].length);
}

function buscarNombre(texto: string): string | undefined {
  const m = /(?:soy|me llamo|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/.exec(texto);
  return m?.[1];
}

export function crearSimulado(c: Conocimiento, humano = 'Pablo'): Proveedor {
  const paquetes = c.paquetes;

  function buscarPaquete(texto: string): string | undefined {
    const n = normalizar(texto);
    return paquetes.find((p) => n.includes(normalizar(p.nombre)))?.nombre;
  }

  function responderA(ultimo: string, delCliente: string[]): string {
    const n = normalizar(ultimo);
    const todo = delCliente.join('\n');
    const nombre = buscarNombre(todo);
    const paquete = buscarPaquete(todo);
    const fecha = [...delCliente].reverse().map(buscarFecha).find(Boolean);

    if (/\b(agendar|apartar|reservar)\b/.test(n)) {
      const faltan = [!nombre && 'tu nombre', !paquete && 'qué paquete te interesa', !fecha && 'qué fecha prefieres'].filter(Boolean);
      if (faltan.length) return `Va. Para pasarle la solicitud a ${humano} me falta ${faltan.join(' y ')}.`;
      return [
        `Listo, ${nombre}. Ya le pasé a ${humano} tu solicitud: paquete *${paquete}*, ${fecha}.`,
        `Él te confirma la disponibilidad y el anticipo por este mismo WhatsApp.`,
        `[[AGENDAR|nombre=${nombre}|sesion=${paquete}|fecha=${fecha}]]`,
      ].join('\n');
    }
    if (/\b(sesiones|sesion|paquetes?|precios?|cuestan?|costo|cuanto)\b/.test(n)) {
      const filas = paquetes.map((p) => `- *${p.nombre}*: ${p.precio} · ${p.fotos} fotos editadas · ${p.sesion} · ${p.looks} ${p.looks === '1' ? 'look' : 'looks'}`);
      return [
        'Hay tres paquetes, todos en el estudio de Coyoacán y con dirección de pose, iluminación de estudio y edición profesional:',
        ...filas,
        '',
        'Con credencial de estudiante vigente es 50% menos en cualquiera. Se aparta con 50% de anticipo y el resto se paga el día de la sesión.',
        'Los ves completos en https://www.ante.photo/#precios',
      ].join('\n');
    }
    if (fecha || /\b(disponib|horario|lugar|espacio)/.test(n)) {
      return [
        `La agenda no la veo desde aquí: la disponibilidad sólo la confirma ${humano}.`,
        `Si quieres apartar${fecha ? ` el ${fecha}` : ''}, dime tu nombre y qué paquete te interesa y le paso la solicitud.`,
      ].join(' ');
    }
    if (/\b(gracias|hasta luego|adios|bye|nos vemos)\b/.test(n)) {
      return `Gracias a ti. ${humano} te escribe por aquí para confirmar. Que estés muy bien.`;
    }
    if (/\b(hola|buenas?|buenos dias|buenas tardes|buenas noches|que tal)\b/.test(n)) {
      return '¿En qué te ayudo? Te puedo contar de los paquetes y precios, o pasar tu solicitud para apartar una sesión.';
    }
    return [
      `Eso no lo tengo a la mano. Se lo paso a ${humano} y él te escribe por aquí.`,
      `[[PASAR|motivo=${ultimo.replace(/[[\]|\n]/g, ' ').slice(0, 80)}]]`,
    ].join('\n');
  }

  return {
    nombre: 'simulado',
    async responder(mensajes) {
      const delCliente = mensajes.filter((m) => m.role === 'user').map((m) => m.content);
      const texto = responderA(delCliente.at(-1) ?? '', delCliente);
      const entrada = Math.ceil(mensajes.reduce((s, m) => s + m.content.length, 0) / 4);
      return { texto, uso: { entrada, entradaCache: 0, salida: Math.ceil(texto.length / 4) } };
    },
  };
}
