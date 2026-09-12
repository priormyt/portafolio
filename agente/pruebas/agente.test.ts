// El núcleo del agente contra la Graph API falsa, con proveedores de modelo de
// prueba (cuentan llamadas, fallan a propósito, inventan precios…).

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { Instancia } from '../src/main.ts';
import { iniciar } from '../src/main.ts';
import type { MensajeModelo, Proveedor } from '../src/modelo.ts';
import type { MensajeEntrante } from '../src/meta.ts';
import type { MetaFalso } from './meta-falso.ts';
import { crearMetaFalso, nuevoWamid } from './meta-falso.ts';
import { ADMIN, ADMIN_WA_ID, capturarRegistro, CLIENTE, configPrueba, PHONE_ID, TOKEN_FALSO, VERSION } from './utiles.ts';

capturarRegistro();

const abiertos: Array<{ i: Instancia; t: MetaFalso }> = [];
after(async () => {
  for (const { i, t } of abiertos) {
    await i.detener();
    await t.cerrar();
  }
});

function proveedorFijo(respuestas: string[] | ((m: MensajeModelo[]) => string)): Proveedor & { llamadas: MensajeModelo[][] } {
  const llamadas: MensajeModelo[][] = [];
  return {
    nombre: 'fijo',
    llamadas,
    async responder(m) {
      llamadas.push(m);
      const texto = typeof respuestas === 'function' ? respuestas(m) : respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
      return { texto, uso: { entrada: 1000, entradaCache: 0, salida: 50 } };
    },
  };
}

async function montar(proveedor?: Proveedor, extra: Record<string, string> = {}) {
  const t = await crearMetaFalso({ version: VERSION, phoneNumberId: PHONE_ID, token: TOKEN_FALSO });
  const config = configPrueba({ META_GRAPH_BASE: t.url, ...extra });
  const i = await iniciar(config, { proveedor });
  abiertos.push({ i, t });
  // Pablo escribió hace poco: su ventana de 24 h está abierta y los avisos le llegan
  // como texto (el caso de la ventana cerrada está en avisos.test.ts).
  i.agente.d.avisos.registrarEntrante(ADMIN_WA_ID);
  return { i, t, agente: i.agente };
}

function msj(cuerpo: string, de = CLIENTE, id = nuevoWamid(), tipo = 'text'): MensajeEntrante {
  return { id, de, tipo, cuerpo, fecha: new Date() };
}

test('agente: se presenta como asistente automático sólo en el primer mensaje de la conversación', async () => {
  const p = proveedorFijo(['Te cuento.', 'Claro.']);
  const { t, agente } = await montar(p);
  const r1 = await agente.recibir(msj('hola'));
  const r2 = await agente.recibir(msj('¿y luego?'));
  assert.match(r1.respuesta ?? '', /^Hola, soy el asistente automático de ANTE\./);
  assert.match(r1.respuesta ?? '', /Te cuento\.$/);
  assert.equal(r2.respuesta, 'Claro.');
  assert.equal(t.enviados(CLIENTE).length, 2);
  // El modelo recibe el historial: sistema + cliente + agente + cliente.
  assert.deepEqual(p.llamadas[1].map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.match(p.llamadas[0][0].content, /Es el primer mensaje/);
  assert.match(p.llamadas[1][0].content, /ya está en curso/);
});

test('agente: con AGENTE_PRESENTARSE=no no antepone la presentación', async () => {
  const { agente } = await montar(proveedorFijo(['Hola, ¿en qué te ayudo?']), { AGENTE_PRESENTARSE: 'no' });
  assert.equal((await agente.recibir(msj('hola'))).respuesta, 'Hola, ¿en qué te ayudo?');
});

test('deduplicación: el mismo wamid dos veces → una sola respuesta y una sola llamada al modelo', async () => {
  const p = proveedorFijo(['Va.']);
  const { t, agente } = await montar(p);
  const m = msj('hola');
  const [a, b] = await Promise.all([agente.recibir(m), agente.recibir({ ...m })]);
  assert.deepEqual([a.desenlace, b.desenlace].sort(), ['duplicado', 'respondido']);
  assert.equal(p.llamadas.length, 1);
  assert.equal(t.enviados(CLIENTE).length, 1);
});

test('BAJA: confirma una vez y deja de contestar; ALTA lo reactiva', async () => {
  const p = proveedorFijo(['Va.']);
  const { t, agente } = await montar(p);
  assert.equal((await agente.recibir(msj('BAJA'))).desenlace, 'baja');
  assert.match(t.enviados(CLIENTE)[0].cuerpo, /ya no te escribirá/);
  assert.equal((await agente.recibir(msj('¿sigues ahí?'))).desenlace, 'silencio_baja');
  assert.equal((await agente.recibir(msj('STOP'))).desenlace, 'silencio_baja', 'ya estaba de baja: no se vuelve a confirmar');
  assert.equal(t.enviados(CLIENTE).length, 1);
  assert.equal(p.llamadas.length, 0, 'el modelo nunca se llamó');
  assert.equal((await agente.recibir(msj('ALTA'))).desenlace, 'alta');
  assert.equal((await agente.recibir(msj('hola'))).desenlace, 'respondido');
});

test('BAJA/ALTA alternados no disparan envíos sin fin: cuentan para el límite, y la baja se respeta igual', async () => {
  const { t, agente } = await montar(proveedorFijo(['Va.']), { AGENTE_LIMITE_POR_NUMERO_HORA: '2' });
  const d: string[] = [];
  for (const texto of ['BAJA', 'ALTA', 'BAJA', 'ALTA', 'BAJA', 'ALTA']) d.push((await agente.recibir(msj(texto))).desenlace);
  assert.deepEqual(d, ['baja', 'alta', 'baja', 'limite_numero', 'silencio_baja', 'limite_numero']);
  assert.equal(t.enviados(CLIENTE).length, 2, 'sólo dos confirmaciones pagadas');
  assert.equal(agente.d.bajas.es(CLIENTE), true, 'la última palabra fue BAJA y quedó de baja');
});

test('tope de gasto: pasado el tope no se llama al modelo; mensaje fijo al cliente y aviso a Pablo', async () => {
  const p = proveedorFijo(['Va.']);
  // Tope minúsculo: ni la primera llamada cabe.
  const { t, agente } = await montar(p, { AGENTE_TOPE_DIARIO_USD: '0.000001' });
  const r = await agente.recibir(msj('¿Cuánto cuesta?'));
  assert.equal(r.desenlace, 'tope');
  assert.equal(p.llamadas.length, 0);
  assert.match(t.enviados(CLIENTE)[0].cuerpo, /no puedo contestarte en automático/);
  const avisos = t.enviados(ADMIN);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].cuerpo, /tope de gasto/);
  assert.match(avisos[0].cuerpo, /¿Cuánto cuesta\?/);
  // Un segundo mensaje del mismo número el mismo día: respuesta fija, sin repetir el aviso.
  await agente.recibir(msj('¿Hola?'));
  assert.equal(t.enviados(ADMIN).length, 1);
});

test('tope de gasto: se corta al llegar, contando lo que de verdad se gastó', async () => {
  const p = proveedorFijo(['Va.']);
  // Cada llamada gasta 1000×0.3/1e6 + 50×1.2/1e6 = 0.00036; el peor caso reservado es mayor.
  const { agente } = await montar(p, { AGENTE_TOPE_DIARIO_USD: '0.004', AGENTE_MAX_TOKENS: '100' });
  const desenlaces: string[] = [];
  for (let k = 0; k < 15; k++) desenlaces.push((await agente.recibir(msj(`mensaje ${k}`))).desenlace);
  const respondidos = desenlaces.filter((d) => d === 'respondido').length;
  assert.ok(respondidos >= 3 && respondidos < 15, desenlaces.join(','));
  assert.equal(desenlaces.at(-1), 'tope');
  assert.ok(agente.d.gasto.gastadoHoy() <= 0.004);
});

test('fallo del modelo: mensaje fijo al cliente y aviso a Pablo', async () => {
  const roto: Proveedor = { nombre: 'roto', responder: async () => { throw new Error('se cayó'); } };
  const { t, agente } = await montar(roto);
  assert.equal((await agente.recibir(msj('hola'))).desenlace, 'fallo_modelo');
  assert.match(t.enviados(CLIENTE)[0].cuerpo, /Tuve un problema/);
  assert.match(t.enviados(ADMIN)[0].cuerpo, /no pudo contestar/);
});

test('validación: una respuesta con un precio inventado no sale; pasa a Pablo', async () => {
  const { t, agente } = await montar(proveedorFijo(['El paquete Premium cuesta $4,500 MXN.']));
  const r = await agente.recibir(msj('¿Tienen algo más caro?'));
  assert.equal(r.desenlace, 'rechazado');
  assert.doesNotMatch(t.enviados(CLIENTE)[0].cuerpo, /4,500/);
  assert.match(t.enviados(CLIENTE)[0].cuerpo, /te lo confirme Pablo/);
  assert.match(t.enviados(ADMIN)[0].cuerpo, /descartada/);
});

test('validación: Markdown y enlaces ajenos se limpian antes de mandar', async () => {
  const { t, agente } = await montar(proveedorFijo(['**Básico**: $1,800 MXN. Mira [aquí](https://evil.example.com) o https://www.ante.photo/#precios']), { AGENTE_PRESENTARSE: 'no' });
  await agente.recibir(msj('precios'));
  assert.equal(t.enviados(CLIENTE)[0].cuerpo, '*Básico*: $1,800 MXN. Mira aquí: o https://www.ante.photo/#precios');
});

test('agendar: el marcador avisa a Pablo con los tres datos y el cliente no lo ve', async () => {
  const { t, agente } = await montar(proveedorFijo(['Listo, le paso tu solicitud a Pablo.\n[[AGENDAR|nombre=Laura Prueba|sesion=Estándar|fecha=sábado 19 de septiembre]]']));
  const r = await agente.recibir(msj('Quiero agendar'));
  assert.equal(r.desenlace, 'respondido');
  assert.doesNotMatch(t.enviados(CLIENTE)[0].cuerpo, /\[\[|AGENDAR/);
  const aviso = t.enviados(ADMIN)[0].cuerpo;
  assert.match(aviso, /Solicitud de sesión/);
  assert.match(aviso, /Nombre: Laura Prueba/);
  assert.match(aviso, /Sesión: Estándar/);
  assert.match(aviso, /Fecha preferida: sábado 19 de septiembre/);
  assert.match(aviso, new RegExp(CLIENTE.replace('+', '\\+')));
});

test('límite por número por hora: pasado el límite, silencio', async () => {
  const p = proveedorFijo(['Va.']);
  const { t, agente } = await montar(p, { AGENTE_LIMITE_POR_NUMERO_HORA: '2' });
  const d = [];
  for (let k = 0; k < 4; k++) d.push((await agente.recibir(msj(`m${k}`))).desenlace);
  assert.deepEqual(d, ['respondido', 'respondido', 'limite_numero', 'limite_numero']);
  assert.equal(t.enviados(CLIENTE).length, 2);
});

test('límite global por hora: silencio para todos y un aviso a Pablo', async () => {
  const { t, agente } = await montar(proveedorFijo(['Va.']), { AGENTE_LIMITE_GLOBAL_HORA: '1' });
  await agente.recibir(msj('hola'));
  assert.equal((await agente.recibir(msj('hola', '5215500000005'))).desenlace, 'limite_global');
  assert.equal((await agente.recibir(msj('hola', '5215500000006'))).desenlace, 'limite_global');
  assert.equal(t.enviados(ADMIN).length, 1);
});

test('número ilegible se ignora', async () => {
  const p = proveedorFijo(['Va.']);
  const { agente } = await montar(p);
  assert.equal((await agente.recibir(msj('hola', 'abc'))).desenlace, 'ignorado');
  assert.equal((await agente.recibir(msj('hola', '12'))).desenlace, 'ignorado');
  assert.equal(p.llamadas.length, 0);
});

test('no es texto: foto o audio → respuesta fija sin modelo; una reacción → nada', async () => {
  const p = proveedorFijo(['Va.']);
  const { t, agente } = await montar(p);
  assert.equal((await agente.recibir(msj('', CLIENTE, nuevoWamid(), 'image'))).desenlace, 'no_es_texto');
  assert.equal((await agente.recibir(msj('', CLIENTE, nuevoWamid(), 'audio'))).desenlace, 'no_es_texto');
  assert.equal((await agente.recibir(msj('', CLIENTE, nuevoWamid(), 'reaction'))).desenlace, 'ignorado');
  assert.equal(p.llamadas.length, 0);
  assert.equal(t.enviados(CLIENTE).length, 2);
});

test('Pablo escribe con avisos pendientes → salen antes que su respuesta', async () => {
  const { t, agente } = await montar(proveedorFijo(['Va.']));
  // Se cierra su ventana a mano y se genera un aviso: queda pendiente.
  (agente.d.avisos as unknown as { ventanas: Record<string, string> }).ventanas.admin = '2000-01-01T00:00:00Z';
  await agente.d.avisos.avisar('aviso de prueba');
  assert.equal(agente.d.avisos.pendientes().length, 1);
  assert.equal(t.enviados(ADMIN).length, 0);
  await agente.recibir(msj('hola', ADMIN_WA_ID));
  const a = t.enviados(ADMIN);
  assert.match(a[0].cuerpo, /aviso pendiente[\s\S]*aviso de prueba/);
  assert.match(a[1].cuerpo, /asistente automático/);
  assert.equal(agente.d.avisos.pendientes().length, 0);
});

test('Meta falla al enviar: se reintenta una vez', async () => {
  const { t, agente } = await montar(proveedorFijo(['Va.']), { AGENTE_PRESENTARSE: 'no' });
  t.fallarEnvios(1, 500);
  await agente.recibir(msj('hola'));
  assert.equal(t.enviados(CLIENTE).length, 1);
  assert.equal(t.peticiones.enviar, 2);
});
