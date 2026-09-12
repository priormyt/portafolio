// Ficheros del agente. Todo síncrono a propósito: el volumen es de decenas de
// mensajes al día y así ninguna escritura se intercala con otra.
// Los ficheros nacen 0600 y los directorios 0700: dentro hay conversaciones.

import fs from 'node:fs';
import path from 'node:path';

export function asegurarDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Escribe a un temporal y renombra: un corte de luz deja el viejo o el nuevo, nunca medio. */
export function escribirAtomico(ruta: string, contenido: string): void {
  asegurarDir(path.dirname(ruta));
  const tmp = `${ruta}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contenido, { mode: 0o600 });
  fs.renameSync(tmp, ruta);
}

export function leerJson<T>(ruta: string, porOmision: T): T {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8')) as T;
  } catch {
    return porOmision;
  }
}

export function escribirJson(ruta: string, valor: unknown): void {
  escribirAtomico(ruta, JSON.stringify(valor, null, 2) + '\n');
}

export function anexarLinea(ruta: string, valor: unknown): void {
  asegurarDir(path.dirname(ruta));
  fs.appendFileSync(ruta, JSON.stringify(valor) + '\n', { mode: 0o600 });
}

/** Lee JSON Lines. Una línea rota (p. ej. un corte a media escritura) se salta, no tumba el resto. */
export function leerLineas<T>(ruta: string): T[] {
  let crudo: string;
  try {
    crudo = fs.readFileSync(ruta, 'utf8');
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const linea of crudo.split('\n')) {
    if (!linea.trim()) continue;
    try {
      out.push(JSON.parse(linea) as T);
    } catch {
      // línea incompleta: se ignora
    }
  }
  return out;
}

export function escribirLineas(ruta: string, valores: unknown[]): void {
  if (valores.length === 0) {
    fs.rmSync(ruta, { force: true });
    return;
  }
  escribirAtomico(ruta, valores.map((v) => JSON.stringify(v)).join('\n') + '\n');
}
