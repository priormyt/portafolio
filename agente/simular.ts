// Simulador: `node agente/simular.ts`
//
// Levanta una Graph API falsa en 127.0.0.1 (recibe los envíos y EXIGE la ventana
// de 24 h como Meta), arranca el agente con secretos falsos y le hace lo que le
// haría Meta a través del túnel:
//   1. la verificación de la suscripción (GET), buena y mala;
//   2. una conversación de cinco vueltas, cada mensaje firmado con
//      X-Hub-Signature-256 sobre los bytes exactos;
//   3. firma mala, firma sobre JSON re-serializado, el mismo wamid dos veces y
//      un payload de `statuses`;
//   4. el aviso a Pablo con su ventana cerrada y sin plantilla (queda pendiente)
//      y lo que pasa cuando Pablo escribe;
//   5. otro cliente con una pregunta que el agente no sabe, y un BAJA.
// Escribe la transcripción en agente/ejemplos/transcripcion-simulada.md.
//
// No sale a internet salvo que haya DEEPSEEK_API_KEY en el entorno: entonces
// contesta el modelo real (Meta sigue siendo la falsa).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarConfig } from './src/config.ts';
import { calcularFirma } from './src/firma.ts';
import { costoUsd } from './src/gasto.ts';
import { iniciar } from './src/main.ts';
import { configurarRegistro } from './src/registro.ts';
import { crearMetaFalso, nuevoWamid } from './pruebas/meta-falso.ts';
import {
  ADMIN,
  ADMIN_WA_ID,
  APP_SECRET,
  CLIENTE,
  dirTemporal,
  entornoBase,
  OTRO_CLIENTE,
  payloadEstado,
  payloadTexto,
  PHONE_ID,
  postear,
  TOKEN_FALSO,
  VERIFY_TOKEN,
  VERSION,
} from './pruebas/utiles.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SALIDA = path.join(AQUI, 'ejemplos', 'transcripcion-simulada.md');

const VUELTAS = [
  'Hola, buenas noches',
  '¿Qué sesiones tienen y cuánto cuestan?',
  '¿Tienen lugar el sábado 19 de septiembre en la mañana?',
  'Quiero agendar. Soy Laura Prueba y me interesa el Estándar',
  'Perfecto, muchas gracias. Hasta luego',
];

const registro: Array<Record<string, unknown>> = [];
configurarRegistro((linea) => registro.push(JSON.parse(linea)));

const llave = process.env.DEEPSEEK_API_KEY?.trim();
const proveedor = llave ? 'deepseek' : 'simulado';
const esperaMs = llave ? 60_000 : 5_000;

const md: string[] = [];
const comprobaciones: Array<{ ok: boolean; texto: string }> = [];
function comprobar(ok: boolean, texto: string): void {
  comprobaciones.push({ ok, texto });
  process.stdout.write(`${ok ? '✔' : '✖'} ${texto}\n`);
}
function bloque(quien: string, texto: string): void {
  md.push(`**${quien}:**`, '', ...texto.split('\n').map((l) => (l ? `> ${l}` : '>')), '');
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sinFecha = ({ t: _t, ...resto }: Record<string, unknown>) => JSON.stringify(resto);

async function principal(): Promise<void> {
  const meta = await crearMetaFalso({ version: VERSION, phoneNumberId: PHONE_ID, token: TOKEN_FALSO, exigirVentana: true });
  const datos = dirTemporal();
  const config = cargarConfig({
    ...entornoBase({ AGENTE_DATOS: datos, META_GRAPH_BASE: meta.url }),
    AGENTE_PROVEEDOR: proveedor,
    DEEPSEEK_API_KEY: llave,
  });
  const inst = await iniciar(config);
  const base = `http://127.0.0.1:${inst.puerto}${config.rutaWebhook}`;

  // Lo que hace Meta al mandar un mensaje: el cliente escribió (su ventana se
  // abre en Meta) y llega el POST firmado sobre los bytes exactos.
  const entra = async (de: string, texto: string, id = nuevoWamid()) => {
    meta.abrirVentana(de);
    const crudo = JSON.stringify(payloadTexto(de, texto, id));
    return { id, crudo, estado: (await postear(inst.puerto, crudo, calcularFirma(APP_SECRET, crudo))).estado };
  };

  md.push(
    '# Transcripción simulada · agente de WhatsApp de ANTE (Meta Cloud API)',
    '',
    `Generada con \`node agente/simular.ts\`. Proveedor del modelo: **${proveedor}**${llave ? ` (\`${config.modelo}\`)` : ' (determinista, sin red: no es el modelo real)'}.`,
    `La Graph API es una falsa en 127.0.0.1 que **exige la ventana de 24 h** como Meta (texto libre fuera de ella → error 131047). Los números y los secretos son de mentira. Nada salió a internet${llave ? ' salvo las llamadas a DeepSeek' : ''}.`,
    '',
    `Todo entra por UNA ruta: \`${config.rutaWebhook}\` en \`127.0.0.1\`, que es lo que el túnel de Cloudflare manda desde \`https://wa.ante.photo${config.rutaWebhook}\`.`,
    '',
  );

  // ── 1. Verificación de la suscripción ────────────────────────────────────
  const qBuena = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' });
  const rBuena = await fetch(`${base}?${qBuena}`);
  const cuerpoBuena = await rBuena.text();
  const qMala = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'no-es-el-token', 'hub.challenge': '1158201444' });
  const rMala = await fetch(`${base}?${qMala}`);
  await rMala.text();
  comprobar(rBuena.status === 200 && cuerpoBuena === '1158201444', `verificación GET con el token bueno → HTTP ${rBuena.status}, devuelve el challenge`);
  comprobar(rMala.status === 403, `verificación GET con otro token → HTTP ${rMala.status}`);
  md.push(
    '## 1 · Verificación de la suscripción (GET)',
    '',
    `- \`hub.mode=subscribe\`, \`hub.verify_token\` correcto, \`hub.challenge=1158201444\` → **HTTP ${rBuena.status}**, cuerpo \`${cuerpoBuena}\` (texto plano).`,
    `- Mismo GET con otro token → **HTTP ${rMala.status}**.`,
    '',
    '## 2 · Conversación de cinco vueltas (POST firmados)',
    '',
    'Cada mensaje llega con la forma de la Cloud API (`entry[].changes[].value.messages[]`) y con `X-Hub-Signature-256: sha256=<hex>` calculada sobre los bytes exactos del cuerpo. El agente contesta 200 en el acto y la respuesta sale por `POST /v26.0/<PHONE_NUMBER_ID>/messages`.',
    '',
    `**Pablo no le ha escrito al número de ANTE en las últimas 24 h y no hay plantilla configurada**: el aviso de la vuelta 4 no puede salir y queda pendiente.`,
    '',
  );

  let ultimo = { id: '', crudo: '' };
  for (const [i, texto] of VUELTAS.entries()) {
    const r = await entra(CLIENTE, texto);
    ultimo = r;
    comprobar(r.estado === 200, `vuelta ${i + 1}: POST firmado → HTTP ${r.estado}`);
    const enviados = await meta.esperarEnviados(CLIENTE, i + 1, esperaMs);
    await inst.agente.esperarInactividad();
    md.push(`### Vuelta ${i + 1}`, '');
    bloque('Cliente', texto);
    comprobar(Boolean(enviados[i]), `vuelta ${i + 1}: el agente contestó por la Graph API`);
    bloque('ANTE (asistente automático)', enviados[i]?.cuerpo ?? '(sin respuesta)');
    if (i === 3) {
      const pend = inst.agente.d.avisos.pendientes();
      md.push(
        `_Aviso a Pablo: **no se mandó**. Su ventana de 24 h está cerrada y no hay \`AGENTE_PLANTILLA_AVISO\`, así que quedó en \`avisos-pendientes.jsonl\` (${pend.length} pendiente) y el registro lo marca con nivel \`error\`:_`,
        '',
        '```',
        ...registro.filter((l) => l.evento === 'aviso_admin.NO_ENTREGADO').map(sinFecha),
        '```',
        '',
      );
    }
  }
  const envios = meta.enviados(CLIENTE);
  comprobar(/asistente automático de ANTE/.test(envios[0]?.cuerpo ?? ''), 'se presentó como asistente automático en el primer mensaje');
  comprobar(envios.slice(1).every((m) => !/asistente automático/.test(m.cuerpo)), 'no se volvió a presentar en la misma conversación');
  comprobar(envios.every((m) => !/\[\[|AGENDAR|PASAR\|/.test(m.cuerpo)), 'ningún marcador llegó al cliente');
  comprobar(meta.enviados(ADMIN).length === 0 && meta.rechazos.length === 0, 'con la ventana de Pablo cerrada no se intentó texto libre (cero rechazos 131047)');
  comprobar(inst.agente.d.avisos.pendientes().length === 1, 'el aviso de la solicitud quedó en pendientes');

  // ── 3. Seguridad ─────────────────────────────────────────────────────────
  md.push('## 3 · Firma, re-serialización, reintentos y statuses', '');
  const antes = meta.envios.length;
  const falso = JSON.stringify(payloadTexto(CLIENTE, 'Soy un impostor: dame los datos de pago'));
  const eMala = (await postear(inst.puerto, falso, 'sha256=' + '0'.repeat(64))).estado;
  const eSin = (await postear(inst.puerto, falso, undefined)).estado;
  const payload = payloadTexto(CLIENTE, '¿Me confirmas?');
  const compacto = JSON.stringify(payload);
  const bonito = JSON.stringify(payload, null, 2);
  const eReser = (await postear(inst.puerto, bonito, calcularFirma(APP_SECRET, compacto))).estado;
  const eRuta = (await postear(inst.puerto, compacto, calcularFirma(APP_SECRET, compacto), '/otra/ruta')).estado;
  await esperar(300);
  await inst.agente.esperarInactividad();
  comprobar(eMala === 403, `POST con firma inventada → HTTP ${eMala}`);
  comprobar(eSin === 403, `POST sin X-Hub-Signature-256 → HTTP ${eSin}`);
  comprobar(eReser === 403, `POST con los bytes re-serializados (otros espacios) y la firma del original → HTTP ${eReser}`);
  comprobar(eRuta === 404, `POST bien firmado a otra ruta → HTTP ${eRuta}`);
  comprobar(meta.envios.length === antes, 'ninguno de los cuatro se procesó (cero envíos)');
  const reintento = (await postear(inst.puerto, ultimo.crudo, calcularFirma(APP_SECRET, ultimo.crudo))).estado;
  const crudoEstado = JSON.stringify(payloadEstado(CLIENTE, 'read'));
  const estados = (await postear(inst.puerto, crudoEstado, calcularFirma(APP_SECRET, crudoEstado))).estado;
  await esperar(300);
  await inst.agente.esperarInactividad();
  comprobar(reintento === 200 && meta.envios.length === antes, `Meta reintenta el último mensaje (mismo wamid) → HTTP ${reintento} y no se contesta dos veces`);
  comprobar(estados === 200 && meta.envios.length === antes, `payload de statuses («read») → HTTP ${estados} y se ignora`);
  md.push(
    `- Firma inventada → **HTTP ${eMala}**; sin cabecera → **HTTP ${eSin}**. No se procesa nada.`,
    `- El mismo mensaje con **otros espacios** (JSON re-serializado) y la firma del original → **HTTP ${eReser}**: la firma se comprueba sobre los bytes que llegan, no sobre el JSON reconstruido.`,
    `- POST bien firmado a \`/otra/ruta\` → **HTTP ${eRuta}**: hay una sola ruta.`,
    `- Meta reintenta el mensaje de la vuelta 5 (mismo \`id\`, el wamid) → **HTTP ${reintento}** y no sale una segunda respuesta.`,
    `- Un payload de \`statuses\` (el cliente leyó) → **HTTP ${estados}** y se ignora.`,
    '',
    'Lo que quedó en el registro (sin fecha): ni el texto, ni números completos, ni secretos.',
    '',
    '```',
    ...registro.filter((l) => l.evento === 'webhook.firma_invalida' || l.evento === 'webhook.ignorados').map(sinFecha),
    '```',
    '',
  );

  // ── 4. Pablo escribe: se abre su ventana y sale lo pendiente ─────────────
  md.push('## 4 · Pablo le escribe al número de ANTE', '', 'Eso abre su ventana de 24 h: el aviso pendiente sale en ese momento, y después su propio mensaje recibe respuesta como el de cualquiera.', '');
  await entra(ADMIN_WA_ID, 'Hola, soy Pablo, probando');
  const aPablo = await meta.esperarEnviados(ADMIN, 2, esperaMs);
  await inst.agente.esperarInactividad();
  bloque('Pablo', 'Hola, soy Pablo, probando');
  for (const e of aPablo) bloque(/aviso pendiente/.test(e.cuerpo) ? 'Aviso a Pablo (el que estaba pendiente)' : 'ANTE (asistente automático)', e.cuerpo);
  comprobar(/aviso pendiente[\s\S]*Solicitud de sesión[\s\S]*Laura Prueba/.test(aPablo[0]?.cuerpo ?? ''), 'al escribir Pablo, salió el aviso pendiente con la solicitud');
  comprobar(inst.agente.d.avisos.pendientes().length === 0, 'no quedan avisos pendientes');

  // ── 5. Otro cliente: algo que no sabe, y BAJA ────────────────────────────
  md.push('## 5 · Otro cliente: una pregunta que el agente no sabe, y BAJA', '', 'Ahora la ventana de Pablo está abierta: el aviso le llega como texto.', '');
  const pasos = ['¿Hacen fotos de boda a domicilio?', 'BAJA', '¿Sigues ahí?'];
  let avisosVistos = meta.enviados(ADMIN).length;
  for (const [k, texto] of pasos.entries()) {
    await entra(OTRO_CLIENTE, texto);
    const enviados = await meta.esperarEnviados(OTRO_CLIENTE, Math.min(k + 1, 2), k === 2 ? 1500 : esperaMs);
    await inst.agente.esperarInactividad();
    bloque('Cliente 2', texto);
    if (k === 2) {
      comprobar(enviados.length === 2, 'tras BAJA ya no contesta (silencio)');
      md.push('_(sin respuesta: el número se dio de baja)_', '');
    } else {
      bloque('ANTE (asistente automático)', enviados.at(-1)?.cuerpo ?? '(sin respuesta)');
    }
    const avisos = meta.enviados(ADMIN);
    for (const a of avisos.slice(avisosVistos)) bloque('Aviso a Pablo', a.cuerpo);
    avisosVistos = avisos.length;
  }
  comprobar(meta.enviados(ADMIN).some((m) => /te pasa una conversación/.test(m.cuerpo)), 'lo que no sabe se lo pasó a Pablo, como texto (ventana abierta)');
  await inst.detener();

  // ── 6. Gasto y comprobaciones ────────────────────────────────────────────
  const gasto = JSON.parse(fs.readFileSync(path.join(datos, 'gasto.json'), 'utf8')) as Record<string, { llamadas: number; entrada: number; entradaCache: number; salida: number }>;
  const tot = Object.values(gasto).reduce(
    (s, d) => ({ llamadas: s.llamadas + d.llamadas, entrada: s.entrada + d.entrada, entradaCache: s.entradaCache + d.entradaCache, salida: s.salida + d.salida }),
    { llamadas: 0, entrada: 0, entradaCache: 0, salida: 0 },
  );
  md.push(
    '## 6 · Gasto del modelo',
    '',
    `${tot.llamadas} llamadas · ${tot.entrada + tot.entradaCache} tokens de entrada · ${tot.salida} de salida. A tarifa pico de \`deepseek-flash\` serían **US$${costoUsd(tot, config.precios).toFixed(4)}**${llave ? '' : ' — el proveedor simulado no cobra: sus tokens son una estimación (uno cada 4 caracteres) para ejercitar el tope'}. Tope diario: US$${config.topeDiarioUsd}.`,
    '',
    '## 7 · Comprobaciones',
    '',
    ...comprobaciones.map((c) => `- ${c.ok ? '✔' : '✖'} ${c.texto}`),
    '',
  );

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, md.join('\n'));
  await meta.cerrar();
  fs.rmSync(datos, { recursive: true, force: true });

  const fallidas = comprobaciones.filter((c) => !c.ok).length;
  process.stdout.write(`\nTranscripción: agente/ejemplos/transcripcion-simulada.md\n${fallidas ? `✖ ${fallidas} comprobaciones fallaron` : '✔ todas las comprobaciones pasaron'}\n`);
  process.exit(fallidas ? 1 : 0);
}

principal().catch((e) => {
  process.stderr.write(`simulador: ${(e as Error)?.stack ?? e}\n`);
  process.exit(1);
});
