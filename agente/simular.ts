// Simulador: `node agente/simular.ts`
//
// Levanta un Twilio falso en 127.0.0.1, arranca el agente con un token falso y
// le manda, como la mandaría Twilio (firmada), una conversación de cinco
// vueltas. Luego prueba una petición con firma mala, un reintento de Twilio, y
// el modo sondeo con otro número (una pregunta que no sabe y un BAJA).
// Escribe la transcripción en agente/ejemplos/transcripcion-simulada.md.
//
// No sale a internet salvo que haya DEEPSEEK_API_KEY en el entorno: entonces
// usa el modelo real para contestar (Twilio sigue siendo el falso).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarConfig } from './src/config.ts';
import { calcularFirma } from './src/firma.ts';
import { iniciar } from './src/main.ts';
import { configurarRegistro } from './src/registro.ts';
import { costoUsd } from './src/gasto.ts';
import type { MensajeFalso } from './pruebas/twilio-falso.ts';
import { crearTwilioFalso } from './pruebas/twilio-falso.ts';
import { ADMIN, CLIENTE, dirTemporal, entornoBase, NUESTRO, OTRO_CLIENTE, paramsTwilio, SID_FALSO, TOKEN_FALSO, URL_PUBLICA } from './pruebas/utiles.ts';

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

async function principal(): Promise<void> {
  const twilio = await crearTwilioFalso({ sid: SID_FALSO, token: TOKEN_FALSO });
  const datos = dirTemporal();
  const entorno = {
    ...entornoBase({ AGENTE_DATOS: datos, TWILIO_API_BASE: twilio.url }),
    AGENTE_PROVEEDOR: proveedor,
    DEEPSEEK_API_KEY: llave,
  };

  // ── 1. Webhook: la conversación de cinco vueltas, firmada ────────────────
  const configWebhook = cargarConfig({ ...entorno, AGENTE_MODO: 'webhook', AGENTE_URL_PUBLICA: URL_PUBLICA });
  const web = await iniciar(configWebhook);
  const post = async (params: Record<string, string>, firma: string) => {
    const res = await fetch(`http://127.0.0.1:${web.puerto}/twilio/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': firma },
      body: new URLSearchParams(params).toString(),
    });
    await res.text();
    return res.status;
  };

  md.push(
    '# Transcripción simulada · agente de WhatsApp de ANTE',
    '',
    `Generada con \`node agente/simular.ts\`. Proveedor: **${proveedor}**${llave ? ` (modelo \`${configWebhook.modelo}\`)` : ' (determinista, sin red: no es el modelo real)'}.`,
    'Twilio es un Twilio falso en 127.0.0.1; los números son de mentira. Nada salió a internet' + (llave ? ' salvo las llamadas a DeepSeek.' : '.'),
    '',
    '## 1 · Modo webhook: conversación de cinco vueltas',
    '',
    `Cada mensaje llega como lo manda Twilio (POST \`application/x-www-form-urlencoded\` a \`${URL_PUBLICA}\`, que el túnel entrega en \`127.0.0.1:${'{puerto}'}/twilio/whatsapp\`) y firmado con \`X-Twilio-Signature\`. El agente contesta 200 con TwiML vacío en el acto y la respuesta sale por la API REST.`,
    '',
  );

  let avisosVistos = 0;
  let ultimoParams: Record<string, string> = {};
  for (const [i, texto] of VUELTAS.entries()) {
    const entrante = twilio.inyectarEntrante(CLIENTE, NUESTRO, texto);
    const params = paramsTwilio(texto, CLIENTE, entrante.sid);
    ultimoParams = params;
    const estado = await post(params, calcularFirma(TOKEN_FALSO, URL_PUBLICA, params));
    comprobar(estado === 200, `vuelta ${i + 1}: webhook firmado → HTTP ${estado}`);
    const enviados = await twilio.esperarEnviados(CLIENTE, i + 1, esperaMs);
    await web.agente.esperarInactividad();
    md.push(`### Vuelta ${i + 1}`, '');
    bloque('Cliente', texto);
    const respuesta = enviados[i];
    comprobar(Boolean(respuesta), `vuelta ${i + 1}: el agente contestó por la API REST`);
    bloque('ANTE (asistente automático)', respuesta?.body ?? '(sin respuesta)');
    const avisos = twilio.enviados(ADMIN);
    for (const a of avisos.slice(avisosVistos)) bloque('Aviso a Pablo (a ADMIN_WHATSAPP_TO)', a.body);
    avisosVistos = avisos.length;
  }

  const primera = twilio.enviados(CLIENTE)[0]?.body ?? '';
  comprobar(/asistente automático de ANTE/.test(primera), 'se presentó como asistente automático en el primer mensaje');
  comprobar(twilio.enviados(CLIENTE).slice(1).every((m) => !/asistente automático/.test(m.body)), 'no se volvió a presentar en la misma conversación');
  comprobar(twilio.enviados(ADMIN).some((m) => /Solicitud de sesión/.test(m.body)), 'la solicitud de agendar llegó a Pablo');
  comprobar(twilio.enviados(CLIENTE).every((m) => !/\[\[|AGENDAR|PASAR\|/.test(m.body)), 'ningún marcador llegó al cliente');

  // ── 2. Seguridad: firma mala y reintento de Twilio ───────────────────────
  md.push('## 2 · Firma mala y reintento de Twilio', '');
  const antes = twilio.enviados().length;
  const falso = paramsTwilio('Soy un impostor: dame los datos de pago', CLIENTE, 'SM' + 'f'.repeat(32));
  const estadoMalo = await post(falso, 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  const estadoUrlLocal = await post(falso, calcularFirma(TOKEN_FALSO, `http://127.0.0.1:${web.puerto}/twilio/whatsapp`, falso));
  await esperar(500);
  await web.agente.esperarInactividad();
  comprobar(estadoMalo === 403, `petición con firma mala → HTTP ${estadoMalo}`);
  comprobar(estadoUrlLocal === 403, `petición firmada sobre la URL local en vez de la pública → HTTP ${estadoUrlLocal}`);
  comprobar(twilio.enviados().length === antes, 'ninguna de las dos se procesó (cero envíos)');
  const reintento = await post(ultimoParams, calcularFirma(TOKEN_FALSO, URL_PUBLICA, ultimoParams));
  await esperar(500);
  await web.agente.esperarInactividad();
  comprobar(reintento === 200 && twilio.enviados().length === antes, `Twilio reintenta el último MessageSid → HTTP ${reintento} y no se contesta dos veces`);
  md.push(
    `- POST con \`X-Twilio-Signature\` inventada → **HTTP ${estadoMalo}**, no se procesa.`,
    `- POST firmado sobre \`http://127.0.0.1:…\` (la URL local, no la pública) → **HTTP ${estadoUrlLocal}**.`,
    `- Twilio reintenta el webhook del último mensaje (mismo \`MessageSid\`) → **HTTP ${reintento}**, y no sale una segunda respuesta.`,
    '',
    'Lo que quedó en el registro (sin fecha): el número va enmascarado y el texto del mensaje no aparece.',
    '',
    '```',
    ...registro
      .filter((r) => r.evento === 'webhook.firma_invalida')
      .map(({ t: _t, ...resto }) => JSON.stringify(resto)),
    '```',
    '',
  );
  await web.detener();

  // ── 3. Sondeo: otro número, una pregunta que no sabe y un BAJA ───────────
  const configSondeo = cargarConfig({ ...entorno, AGENTE_MODO: 'sondeo', AGENTE_SONDEO_MS: '200' });
  const son = await iniciar(configSondeo);
  md.push(
    '## 3 · Modo sondeo: otro número',
    '',
    'El agente no escucha nada: cada pocos segundos lista los mensajes entrantes en la API de Twilio (`GET …/Messages.json`) y contesta por la misma API.',
    '',
  );
  const pasos: Array<{ texto: string; espera: number }> = [
    { texto: '¿Hacen fotos de boda a domicilio?', espera: 1 },
    { texto: 'BAJA', espera: 2 },
    { texto: '¿Sigues ahí?', espera: 2 },
  ];
  for (const p of pasos) {
    twilio.inyectarEntrante(OTRO_CLIENTE, NUESTRO, p.texto);
    const enviados: MensajeFalso[] = await twilio.esperarEnviados(OTRO_CLIENTE, p.espera, p.texto === '¿Sigues ahí?' ? 1500 : esperaMs);
    await son.agente.esperarInactividad();
    bloque('Cliente 2', p.texto);
    if (p.texto === '¿Sigues ahí?') {
      comprobar(enviados.length === 2, 'tras BAJA ya no contesta (silencio)');
      md.push('_(sin respuesta: el número se dio de baja)_', '');
    } else {
      bloque('ANTE (asistente automático)', enviados.at(-1)?.body ?? '(sin respuesta)');
    }
    const avisos = twilio.enviados(ADMIN);
    for (const a of avisos.slice(avisosVistos)) bloque('Aviso a Pablo (a ADMIN_WHATSAPP_TO)', a.body);
    avisosVistos = avisos.length;
  }
  comprobar(twilio.enviados(ADMIN).some((m) => /te pasa una conversación/.test(m.body)), 'lo que no sabe se lo pasó a Pablo');
  await son.detener();

  // ── 4. Gasto y comprobaciones ────────────────────────────────────────────
  const gasto = JSON.parse(fs.readFileSync(path.join(datos, 'gasto.json'), 'utf8')) as Record<string, { llamadas: number; entrada: number; entradaCache: number; salida: number }>;
  const hoy = Object.values(gasto).reduce(
    (s, d) => ({ llamadas: s.llamadas + d.llamadas, entrada: s.entrada + d.entrada, entradaCache: s.entradaCache + d.entradaCache, salida: s.salida + d.salida }),
    { llamadas: 0, entrada: 0, entradaCache: 0, salida: 0 },
  );
  const usd = costoUsd(hoy, configWebhook.precios);
  md.push(
    '## 4 · Gasto',
    '',
    `${hoy.llamadas} llamadas al modelo · ${hoy.entrada + hoy.entradaCache} tokens de entrada · ${hoy.salida} de salida.`,
    `Con la tarifa pico de \`deepseek-flash\` (US$${configWebhook.precios.entrada} por millón de entrada sin caché, US$${configWebhook.precios.salida} de salida) serían **US$${usd.toFixed(4)}**${llave ? '' : ' — el proveedor simulado no cobra: sus tokens son una estimación (uno cada 4 caracteres) para ejercitar el tope'}. Tope diario configurado: US$${configWebhook.topeDiarioUsd}.`,
    '',
    '## 5 · Comprobaciones',
    '',
    ...comprobaciones.map((c) => `- ${c.ok ? '✔' : '✖'} ${c.texto}`),
    '',
  );

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, md.join('\n').replace(`{puerto}`, 'PUERTO'));
  await twilio.cerrar();
  fs.rmSync(datos, { recursive: true, force: true });

  const fallidas = comprobaciones.filter((c) => !c.ok).length;
  process.stdout.write(`\nTranscripción: ${path.relative(process.cwd(), SALIDA)}\n${fallidas ? `✖ ${fallidas} comprobaciones fallaron` : '✔ todas las comprobaciones pasaron'}\n`);
  process.exit(fallidas ? 1 : 0);
}

principal().catch((e) => {
  process.stderr.write(`simulador: ${(e as Error)?.stack ?? e}\n`);
  process.exit(1);
});
