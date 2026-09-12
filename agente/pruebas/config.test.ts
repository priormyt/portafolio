import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cargarConfig, leerSecreto, resumenConfig } from '../src/config.ts';
import { registrar } from '../src/registro.ts';
import { APP_SECRET, capturarRegistro, dirTemporal, entornoBase, TOKEN_FALSO, VERIFY_TOKEN } from './utiles.ts';

test('secretos: $CREDENTIALS_DIRECTORY manda sobre el entorno', () => {
  const dir = dirTemporal();
  fs.writeFileSync(path.join(dir, 'META_APP_SECRET'), 'desde-credencial\n');
  assert.equal(leerSecreto('META_APP_SECRET', { CREDENTIALS_DIRECTORY: dir, META_APP_SECRET: 'desde-entorno' }), 'desde-credencial');
  assert.equal(leerSecreto('DEEPSEEK_API_KEY', { CREDENTIALS_DIRECTORY: dir, DEEPSEEK_API_KEY: 'sk-dev' }), 'sk-dev');
  assert.equal(leerSecreto('DEEPSEEK_API_KEY', { CREDENTIALS_DIRECTORY: dir }), undefined);
  assert.throws(() => leerSecreto('../etc/passwd', {}));
});

test('config: nada se ata fuera de loopback', () => {
  assert.throws(() => cargarConfig(entornoBase({ AGENTE_HOST: '0.0.0.0' })), /0\.0\.0\.0/);
  assert.throws(() => cargarConfig(entornoBase({ AGENTE_HOST: '192.168.1.10' })));
  assert.equal(cargarConfig(entornoBase({ AGENTE_HOST: '127.0.0.1' })).host, '127.0.0.1');
});

test('config: sin App Secret, verify token o phone_number_id no arranca', () => {
  assert.throws(() => cargarConfig(entornoBase({ META_APP_SECRET: undefined })), /META_APP_SECRET/);
  assert.throws(() => cargarConfig(entornoBase({ META_VERIFY_TOKEN: undefined })), /META_VERIFY_TOKEN/);
  assert.throws(() => cargarConfig(entornoBase({ META_VERIFY_TOKEN: 'corto' })), /demasiado corto/);
  assert.throws(() => cargarConfig(entornoBase({ META_PHONE_NUMBER_ID: undefined })), /META_PHONE_NUMBER_ID/);
  assert.throws(() => cargarConfig(entornoBase({ META_ACCESS_TOKEN: undefined })), /META_ACCESS_TOKEN/);
  assert.throws(() => cargarConfig(entornoBase({ META_GRAPH_VERSION: '26' })), /v26\.0/);
});

test('config: sin llave de DeepSeek cae en simulado, salvo que se exija deepseek', () => {
  assert.equal(cargarConfig(entornoBase({ AGENTE_PROVEEDOR: undefined })).proveedor, 'simulado');
  assert.throws(() => cargarConfig(entornoBase({ AGENTE_PROVEEDOR: 'deepseek' })), /DEEPSEEK_API_KEY/);
  assert.equal(cargarConfig(entornoBase({ AGENTE_PROVEEDOR: undefined, DEEPSEEK_API_KEY: 'sk-x-prueba' })).proveedor, 'deepseek');
});

test('config: ADMIN_WHATSAPP_TO en E.164; la plantilla va completa o no va', () => {
  assert.equal(cargarConfig(entornoBase({ ADMIN_WHATSAPP_TO: '+5215500000009' })).meta.admin, '5215500000009');
  assert.throws(() => cargarConfig(entornoBase({ ADMIN_WHATSAPP_TO: 'whatsapp:+5215500000009' })), /E\.164/);
  assert.throws(() => cargarConfig(entornoBase({ AGENTE_PLANTILLA_AVISO: 'aviso_asistente' })), /van juntas/);
  const c = cargarConfig(entornoBase({ AGENTE_PLANTILLA_AVISO: 'aviso_asistente', AGENTE_PLANTILLA_IDIOMA: 'es_MX' }));
  assert.deepEqual(c.meta.plantilla, { nombre: 'aviso_asistente', idioma: 'es_MX' });
});

test('config: valores por omisión del encargo', () => {
  const c = cargarConfig(entornoBase({ AGENTE_PUERTO: undefined, META_GRAPH_VERSION: undefined }));
  assert.equal(c.puerto, 9186);
  assert.equal(c.rutaWebhook, '/webhook/meta');
  assert.equal(c.meta.version, 'v26.0');
  assert.equal(c.meta.base, 'https://graph.facebook.com');
  assert.equal(c.modelo, 'deepseek-flash');
  assert.equal(c.retencionDias, 30);
  assert.equal(c.presentarse, true);
  assert.match(c.textoPresentacion, /asistente automático de ANTE/);
  assert.equal(cargarConfig(entornoBase({ AGENTE_PRESENTARSE: 'no' })).presentarse, false);
  assert.equal(cargarConfig(entornoBase({ AGENTE_RUTA: '/otra/ruta/' })).rutaWebhook, '/otra/ruta');
});

test('config: faltantes se listan por nombre, nunca por valor', () => {
  try {
    cargarConfig({ META_APP_SECRET: APP_SECRET });
    assert.fail('debió fallar');
  } catch (e) {
    const msg = (e as Error).message;
    assert.match(msg, /META_ACCESS_TOKEN/);
    assert.match(msg, /META_PHONE_NUMBER_ID/);
    assert.doesNotMatch(msg, new RegExp(APP_SECRET));
  }
});

test('registro: un secreto nunca llega a la salida, ni en el resumen ni dentro de un error', () => {
  const lineas = capturarRegistro();
  const c = cargarConfig(entornoBase({ DEEPSEEK_API_KEY: 'sk-secreto-de-prueba-123', AGENTE_PROVEEDOR: 'deepseek' }));
  registrar('info', 'arranque', resumenConfig(c));
  registrar('error', 'algo', { error: `falló con ${TOKEN_FALSO}, ${APP_SECRET}, ${VERIFY_TOKEN} y sk-secreto-de-prueba-123 para 5215500000009` });
  const todo = lineas.join('\n');
  for (const s of [TOKEN_FALSO, APP_SECRET, VERIFY_TOKEN, 'sk-secreto-de-prueba-123', '5215500000009']) {
    assert.doesNotMatch(todo, new RegExp(s.replace('+', '\\+')), s);
  }
  assert.match(todo, /«secreto»/);
});
