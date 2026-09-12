// Una Graph API falsa en 127.0.0.1, para el simulador y las pruebas. Imita lo
// justo de `POST /{versión}/{PHONE_NUMBER_ID}/messages`:
//   - exige `Authorization: Bearer <token>` y la versión y el phone_number_id
//     configurados (si no, 401/404 como haría Meta, con `error.code`);
//   - con `exigirVentana`, rechaza el TEXTO LIBRE a quien no haya escrito en las
//     últimas 24 h con el código 131047 («More than 24 hours have passed since
//     the recipient last replied to the sender number»), y deja pasar plantillas;
//   - responde como la Cloud API: `{messaging_product, contacts, messages:[{id}]}`.
// No sale a la red.

import crypto from 'node:crypto';
import http from 'node:http';

export interface EnvioFalso {
  id: string;
  /** `to` tal como llegó (E.164 con «+»). */
  to: string;
  tipo: 'text' | 'template';
  /** El texto, o «[plantilla nombre/idioma] parámetros» si es plantilla. */
  cuerpo: string;
  crudo: Record<string, unknown>;
}

export interface MetaFalso {
  url: string;
  envios: EnvioFalso[];
  rechazos: Array<{ to: string; codigo: number }>;
  /** Envíos aceptados a un número (acepta dígitos o E.164). */
  enviados(para?: string): EnvioFalso[];
  /** Apunta que `numero` escribió ahora: abre su ventana de 24 h. */
  abrirVentana(numero: string, t?: Date): void;
  fallarEnvios(n: number, estado: number): void;
  esperarEnviados(para: string, n: number, ms?: number): Promise<EnvioFalso[]>;
  peticiones: { enviar: number };
  cerrar(): Promise<void>;
}

const soloDigitos = (x: string) => x.replace(/\D/g, '');

export function nuevoWamid(): string {
  return 'wamid.' + crypto.randomBytes(24).toString('base64url');
}

export async function crearMetaFalso(o: { version: string; phoneNumberId: string; token: string; exigirVentana?: boolean }): Promise<MetaFalso> {
  const envios: EnvioFalso[] = [];
  const rechazos: Array<{ to: string; codigo: number }> = [];
  const ventanas = new Map<string, number>();
  const peticiones = { enviar: 0 };
  let fallos = { n: 0, estado: 500 };
  const ruta = `/${o.version}/${o.phoneNumberId}/messages`;

  const servidor = http.createServer((req, res) => {
    const json = (estado: number, cuerpo: unknown) => {
      res.writeHead(estado, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify(cuerpo));
    };
    const error = (estado: number, code: number, message: string) => json(estado, { error: { message, type: 'OAuthException', code } });
    let crudo = '';
    req.on('data', (b) => (crudo += b));
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method !== 'POST' || u.pathname !== ruta) return error(404, 100, 'Unsupported post request');
      if (req.headers.authorization !== `Bearer ${o.token}`) return error(401, 190, 'Invalid OAuth access token');
      peticiones.enviar += 1;
      if (fallos.n > 0) {
        fallos.n -= 1;
        return error(fallos.estado, 1, 'An unknown error occurred');
      }
      let c: Record<string, unknown>;
      try {
        c = JSON.parse(crudo);
      } catch {
        return error(400, 100, 'Invalid JSON');
      }
      const to = String(c.to ?? '');
      if (c.messaging_product !== 'whatsapp' || !/^\+?\d{8,15}$/.test(to)) return error(400, 100, 'Invalid parameter');
      const tipo = c.type === 'template' ? 'template' : 'text';
      let cuerpo: string;
      if (tipo === 'text') {
        cuerpo = String((c.text as { body?: string } | undefined)?.body ?? '');
        if (cuerpo.length > 4096) return error(400, 100, 'Param text[\'body\'] must be at most 4096 characters long');
        const ultima = ventanas.get(soloDigitos(to));
        if (o.exigirVentana && (ultima === undefined || Date.now() - ultima > 24 * 3_600_000)) {
          rechazos.push({ to, codigo: 131047 });
          return error(400, 131047, 'Re-engagement message');
        }
      } else {
        const t = c.template as { name?: string; language?: { code?: string }; components?: Array<{ parameters?: Array<{ text?: string }> }> };
        const params = (t.components ?? []).flatMap((x) => x.parameters ?? []).map((x) => x.text ?? '');
        cuerpo = `[plantilla ${t.name}/${t.language?.code}] ${params.join(' | ')}`;
      }
      const id = nuevoWamid();
      envios.push({ id, to, tipo, cuerpo, crudo: c });
      json(200, { messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: soloDigitos(to) }], messages: [{ id }] });
    });
  });

  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()));
  const dir = servidor.address();
  const puerto = typeof dir === 'object' && dir ? dir.port : 0;
  const enviados = (para?: string) => envios.filter((e) => !para || soloDigitos(e.to) === soloDigitos(para));

  return {
    url: `http://127.0.0.1:${puerto}`,
    envios,
    rechazos,
    peticiones,
    enviados,
    abrirVentana(numero, t = new Date()) {
      ventanas.set(soloDigitos(numero), t.getTime());
    },
    fallarEnvios(n, estado) {
      fallos = { n, estado };
    },
    async esperarEnviados(para, n, ms = 5000) {
      const fin = Date.now() + ms;
      while (enviados(para).length < n && Date.now() < fin) await new Promise((r) => setTimeout(r, 20));
      return enviados(para);
    },
    cerrar: () =>
      new Promise<void>((r) => {
        servidor.closeAllConnections();
        servidor.close(() => r());
      }),
  };
}
