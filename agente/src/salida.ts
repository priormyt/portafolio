// Lo que el modelo escribe no sale tal cual. Antes de mandarlo:
//   1. se sacan los marcadores de acción ([[AGENDAR|…]], [[PASAR|…]]);
//   2. se pasa de Markdown al formato de WhatsApp (*negrita*, _cursiva_, ~tachado~);
//   3. se quitan los enlaces y correos que no sean de ante.photo;
//   4. se revisa que toda cifra en pesos y todo porcentaje estén en el conocimiento
//      (un precio que no está ahí es un precio inventado: la respuesta no sale);
//   5. se recorta al tope de un mensaje de texto de WhatsApp.
//
// Tope: `text.body`, «Maximum 4096 characters» —
// https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/text-messages
// Se cuenta en unidades UTF-16 (String.length), que nunca es menos que los
// caracteres: un emoji pesa 2 aquí.

export const LIMITE_TEXTO = 4096;

// ── Marcadores de acción ──────────────────────────────────────────────────────

export type Accion =
  | { tipo: 'agendar'; nombre: string; sesion: string; fecha: string }
  | { tipo: 'pasar'; motivo: string };

function limpiarCampo(v: string | undefined): string {
  return (v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[[\]|]/g, '').trim().slice(0, 120);
}

/**
 * Saca TODO lo que esté entre [[ ]] del texto del cliente y lo interpreta.
 * Un marcador ilegible (tipo desconocido, AGENDAR sin sus tres campos) se vuelve
 * «pasar a Pablo»: ante la duda, lo ve una persona.
 */
export function extraerAcciones(texto: string): { texto: string; acciones: Accion[] } {
  const acciones: Accion[] = [];
  let limpio = texto.replace(/\[\[([\s\S]*?)\]\]/g, (_m, dentro: string) => {
    const [cabeza, ...resto] = dentro.split('|');
    const campos: Record<string, string> = {};
    for (const par of resto) {
      const i = par.indexOf('=');
      if (i > 0) campos[par.slice(0, i).trim().toLowerCase()] = limpiarCampo(par.slice(i + 1));
    }
    const tipo = cabeza.trim().toUpperCase();
    if (tipo === 'AGENDAR' && campos.nombre && campos.sesion && campos.fecha) {
      acciones.push({ tipo: 'agendar', nombre: campos.nombre, sesion: campos.sesion, fecha: campos.fecha });
    } else if (tipo === 'PASAR' || tipo === 'PASAR_A_PABLO') {
      acciones.push({ tipo: 'pasar', motivo: campos.motivo || 'sin motivo' });
    } else {
      acciones.push({ tipo: 'pasar', motivo: 'marcador ilegible del modelo' });
    }
    return '';
  });
  // Restos de marcadores mal cerrados: fuera también.
  if (/\[\[|\]\]/.test(limpio)) {
    limpio = limpio.replace(/\[\[[^\n]*$/gm, '').replace(/\[\[|\]\]/g, '');
    if (!acciones.length) acciones.push({ tipo: 'pasar', motivo: 'marcador ilegible del modelo' });
  }
  return { texto: limpio.trim(), acciones };
}

// ── Markdown → WhatsApp ──────────────────────────────────────────────────────

export function aWhatsApp(texto: string): string {
  let t = texto.replace(/\r\n?/g, '\n');
  t = t.replace(/^```[^\n]*$/gm, ''); // bloques de código: fuera las vallas
  t = t.replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*(\n|$)/gm, ''); // separador de tabla
  t = t.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, fila: string) =>
    fila.split('|').map((c) => c.trim()).filter(Boolean).join(' · '),
  );
  t = t.replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '*$1*'); // títulos → negrita
  t = t.replace(/\*\*(.+?)\*\*/g, '*$1*'); // **negrita** → *negrita*
  t = t.replace(/__(.+?)__/g, '_$1_'); // __cursiva__ → _cursiva_
  t = t.replace(/~~(.+?)~~/g, '~$1~');
  t = t.replace(/!?\[([^\]]+)\]\(([^)\s]+)\)/g, '$1: $2'); // [texto](url) → texto: url
  t = t.replace(/^([ \t]*)[*+•][ \t]+/gm, '$1- '); // viñetas → «- »
  t = t.replace(/^[ \t]*>[ \t]?/gm, ''); // citas
  t = t.replace(/\*{2,}/g, '*');
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// ── Enlaces ──────────────────────────────────────────────────────────────────

function hostPermitido(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'ante.photo' || h.endsWith('.ante.photo');
}

// Dominios «pelones» (sin http): sólo con terminaciones comunes, para no
// confundir «p.ej» o «a.m.» con un dominio.
const TLD = '(?:com|net|org|mx|photo|io|co|me|app|dev|info|biz|ly|gl|link|site|online|store|shop|xyz|es|us|ai|tv|page|to|gg)';
const RE_URL = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const RE_CORREO = /\b[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g;
const RE_DOMINIO = new RegExp(`(?<![@\\w.-])((?:[a-z0-9-]+\\.)+${TLD})(?![\\w-])(?:/[^\\s<>"'\`]*)?`, 'gi');

function quitarPuntuacionFinal(url: string): string {
  return url.replace(/[.,;:!?)\]]+$/, '');
}

/** Quita enlaces y correos ajenos. Devuelve el texto y lo que quitó. */
export function filtrarEnlaces(texto: string): { texto: string; quitados: string[] } {
  const quitados: string[] = [];
  let t = texto.replace(RE_URL, (crudo) => {
    const url = quitarPuntuacionFinal(crudo);
    const cola = crudo.slice(url.length);
    try {
      if (hostPermitido(new URL(url).hostname)) return crudo;
    } catch {
      // URL ilegible: se quita
    }
    quitados.push(url);
    return cola;
  });
  t = t.replace(RE_CORREO, (correo, dominio: string) => {
    if (hostPermitido(dominio)) return correo;
    quitados.push(correo);
    return '';
  });
  t = t.replace(RE_DOMINIO, (crudo, dominio: string, desplaz: number, todo: string) => {
    // Lo que ya es parte de una URL con esquema o de un correo se revisó arriba.
    const antes = todo.slice(Math.max(0, desplaz - 8), desplaz);
    if (/https?:\/\/$/i.test(antes)) return crudo;
    if (hostPermitido(dominio)) return crudo;
    quitados.push(quitarPuntuacionFinal(crudo));
    return '';
  });
  return { texto: t.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:])/g, '$1').trim(), quitados };
}

// ── Cifras ───────────────────────────────────────────────────────────────────

function aNumero(crudo: string): number {
  return Number(crudo.replace(/[,\s]/g, '').replace(/\.(?=\d{3}\b)/g, ''));
}

/** Toda cantidad de dinero que aparezca: «$1,800», «$ 900», «1800 pesos», «2,400 MXN». */
export function montos(texto: string): number[] {
  const out: number[] = [];
  for (const m of texto.matchAll(/\$\s?(\d{1,3}(?:[,.]\d{3})+|\d+)(?:\.\d{1,2})?/g)) out.push(aNumero(m[1]));
  for (const m of texto.matchAll(/(?<![$\d,.])(\d{1,3}(?:[,.]\d{3})+|\d{3,})\s*(?:pesos|mxn|m\.n\.)/gi)) {
    out.push(aNumero(m[1]));
  }
  return out;
}

export function porcentajes(texto: string): number[] {
  return [...texto.matchAll(/(\d{1,3})\s?%/g)].map((m) => Number(m[1]));
}

// ── Validación completa ─────────────────────────────────────────────────────

export interface Permitidos {
  montos: Set<number>;
  porcentajes: Set<number>;
}

export interface Validacion {
  ok: boolean;
  texto: string;
  problemas: string[];
}

function recortar(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const corte = texto.slice(0, limite - 1);
  const fin = Math.max(corte.lastIndexOf('\n\n'), corte.lastIndexOf('. '), corte.lastIndexOf('\n'));
  return (fin > limite * 0.5 ? corte.slice(0, fin + 1) : corte).trimEnd() + '…';
}

// Caracteres de control e invisibles (salvo el salto de línea), por rangos de
// código: así el fuente no lleva ningún carácter invisible.
const INVISIBLES = new RegExp(
  '[' +
    [[0x00, 0x09], [0x0b, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
      .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`)
      .join('') +
    ']',
  'g',
);

export function validarSalida(crudo: string, permitidos: Permitidos, limite: number = LIMITE_TEXTO): Validacion {
  const problemas: string[] = [];
  // Caracteres de control e invisibles (salvo el salto de línea).
  let t = crudo.replace(INVISIBLES, '');
  t = extraerAcciones(t).texto;
  const md = aWhatsApp(t);
  if (md !== t.trim()) problemas.push('markdown convertido');
  t = md;

  const enlaces = filtrarEnlaces(t);
  if (enlaces.quitados.length) problemas.push(`enlaces quitados: ${enlaces.quitados.length}`);
  t = enlaces.texto;

  const inventados = montos(t).filter((n) => !permitidos.montos.has(n));
  const pcts = porcentajes(t).filter((n) => !permitidos.porcentajes.has(n));
  if (inventados.length || pcts.length) {
    problemas.push(`cifras fuera del conocimiento: ${[...inventados.map((n) => `$${n}`), ...pcts.map((n) => `${n}%`)].join(', ')}`);
    return { ok: false, texto: '', problemas };
  }

  if (t.length > limite) {
    problemas.push(`recortado de ${t.length} a ${limite}`);
    t = recortar(t, limite);
  }
  if (!t.trim()) {
    problemas.push('vacío');
    return { ok: false, texto: '', problemas };
  }
  return { ok: true, texto: t, problemas };
}
