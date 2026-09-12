// Registro en una línea JSON por evento, a la salida estándar (en el servidor la
// recoge journald). Dos reglas que no se rompen aquí:
//   1. Nunca se imprime un secreto. `ocultarSecretos` registra sus valores y
//      cualquier aparición se reemplaza antes de escribir, por si un error de
//      terceros lo trae dentro.
//   2. Nunca se imprime el texto de un cliente ni su número completo: el número
//      va enmascarado y del mensaje sólo se anota la longitud.

export type Nivel = 'info' | 'aviso' | 'error';

type Salida = (linea: string) => void;

let salida: Salida = (linea) => process.stdout.write(linea + '\n');
const secretos = new Set<string>();

/** Para las pruebas: capturar el registro o silenciarlo. */
export function configurarRegistro(nueva: Salida): void {
  salida = nueva;
}

export function ocultarSecretos(valores: Array<string | undefined>): void {
  for (const v of valores) if (v && v.length >= 6) secretos.add(v);
}

function limpiar(texto: string): string {
  let t = texto;
  for (const s of secretos) t = t.split(s).join('«secreto»');
  return t;
}

export function registrar(nivel: Nivel, evento: string, datos: Record<string, unknown> = {}): void {
  const linea = JSON.stringify({ t: new Date().toISOString(), nivel, evento, ...datos });
  salida(limpiar(linea));
}

/** whatsapp:+5215512345678 → whatsapp:+521…5678. Suficiente para seguir un caso sin exponerlo. */
export function enmascarar(numero: string | undefined): string {
  if (!numero) return '(sin número)';
  const m = /^(whatsapp:)?\+?(\d+)$/.exec(numero.trim());
  if (!m) return '(número ilegible)';
  const d = m[2];
  if (d.length <= 7) return `${m[1] ?? ''}+…${d.slice(-2)}`;
  return `${m[1] ?? ''}+${d.slice(0, 3)}…${d.slice(-4)}`;
}
