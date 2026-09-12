// Un Twilio falso en 127.0.0.1, para el simulador y las pruebas. Imita lo justo
// del recurso Messages de la API 2010-04-01:
//   POST …/Messages.json  → apunta el envío (direction outbound-api) y responde 201
//   GET  …/Messages.json  → lista, del más reciente al más viejo, con DateSent>,
//                            To, From, PageSize y next_page_uri
// Exige Basic auth con el SID y el token que se le den. No sale a la red.

import crypto from 'node:crypto';
import http from 'node:http';

export interface MensajeFalso {
  sid: string;
  account_sid: string;
  from: string;
  to: string;
  body: string;
  direction: 'inbound' | 'outbound-api';
  status: string;
  num_media: string;
  date_sent: string;
  date_created: string;
}

export interface TwilioFalso {
  url: string;
  mensajes: MensajeFalso[];
  enviados(para?: string): MensajeFalso[];
  inyectarEntrante(de: string, para: string, cuerpo: string, fecha?: Date): MensajeFalso;
  /** Los próximos `n` envíos fallan con `estado` (para probar reintentos). */
  fallarEnvios(n: number, estado: number): void;
  /** Espera hasta que haya `n` envíos a `para` (o se agote el tiempo). */
  esperarEnviados(para: string, n: number, ms?: number): Promise<MensajeFalso[]>;
  peticiones: { listar: number; enviar: number };
  cerrar(): Promise<void>;
}

export function nuevoSid(prefijo = 'SM'): string {
  return prefijo + crypto.randomBytes(16).toString('hex');
}

export async function crearTwilioFalso(o: { sid: string; token: string }): Promise<TwilioFalso> {
  const mensajes: MensajeFalso[] = [];
  const peticiones = { listar: 0, enviar: 0 };
  let fallos = { n: 0, estado: 500 };
  const auth = 'Basic ' + Buffer.from(`${o.sid}:${o.token}`).toString('base64');
  const ruta = `/2010-04-01/Accounts/${o.sid}/Messages.json`;

  function nuevo(m: Omit<MensajeFalso, 'sid' | 'account_sid' | 'date_sent' | 'date_created'>, fecha = new Date()): MensajeFalso {
    const f = fecha.toUTCString().replace('GMT', '+0000'); // RFC 2822, como Twilio
    const x: MensajeFalso = { sid: nuevoSid(), account_sid: o.sid, date_sent: f, date_created: f, ...m };
    mensajes.push(x);
    return x;
  }

  const servidor = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const json = (estado: number, cuerpo: unknown) => {
      // Sin keep-alive: con conexiones reusadas tras una espera, undici tardaba 2 s de más en el reintento.
      res.writeHead(estado, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify(cuerpo));
    };
    if (u.pathname !== ruta) return json(404, { code: 20404, message: 'The requested resource was not found' });
    if (req.headers.authorization !== auth) return json(401, { code: 20003, message: 'Authenticate' });

    if (req.method === 'GET') {
      peticiones.listar += 1;
      const q = u.searchParams;
      const dia = q.get('DateSent>');
      const tamano = Math.min(Number(q.get('PageSize') ?? 50), 1000);
      const pagina = Number(q.get('Page') ?? 0);
      let lista = [...mensajes].sort((a, b) => Date.parse(b.date_sent) - Date.parse(a.date_sent));
      if (dia) lista = lista.filter((m) => new Date(m.date_sent).toISOString().slice(0, 10) >= dia);
      if (q.get('To')) lista = lista.filter((m) => m.to === q.get('To'));
      if (q.get('From')) lista = lista.filter((m) => m.from === q.get('From'));
      const trozo = lista.slice(pagina * tamano, (pagina + 1) * tamano);
      let siguiente: string | null = null;
      if ((pagina + 1) * tamano < lista.length) {
        const q2 = new URLSearchParams(q);
        q2.set('Page', String(pagina + 1));
        siguiente = `${ruta}?${q2.toString()}`;
      }
      return json(200, { messages: trozo, next_page_uri: siguiente, page: pagina, page_size: tamano });
    }

    if (req.method === 'POST') {
      let crudo = '';
      req.on('data', (b) => (crudo += b));
      req.on('end', () => {
        peticiones.enviar += 1;
        if (fallos.n > 0) {
          fallos.n -= 1;
          return json(fallos.estado, { code: 20500, message: 'Internal Server Error' });
        }
        const p = new URLSearchParams(crudo);
        const body = p.get('Body') ?? '';
        if (body.length > 1600) return json(400, { code: 21617, message: 'The concatenated message body exceeds the 1600 character limit' });
        const m = nuevo({ from: p.get('From') ?? '', to: p.get('To') ?? '', body, direction: 'outbound-api', status: 'queued', num_media: '0' });
        json(201, m);
      });
      return;
    }
    json(405, { code: 20004, message: 'Method not allowed' });
  });

  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()));
  const dir = servidor.address();
  const puerto = typeof dir === 'object' && dir ? dir.port : 0;

  const enviados = (para?: string) => mensajes.filter((m) => m.direction === 'outbound-api' && (!para || m.to === para));

  return {
    url: `http://127.0.0.1:${puerto}`,
    mensajes,
    peticiones,
    enviados,
    inyectarEntrante(de, para, cuerpo, fecha) {
      return nuevo({ from: de, to: para, body: cuerpo, direction: 'inbound', status: 'received', num_media: '0' }, fecha);
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
