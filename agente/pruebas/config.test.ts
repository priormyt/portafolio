import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cargarConfig, leerSecreto, resumenConfig } from '../src/config.ts';
import { registrar } from '../src/registro.ts';
import { capturarRegistro, dirTemporal, entornoBase, TOKEN_FALSO } from './utiles.ts';

test('secretos: $CREDENTIALS_DIRECTORY manda sobre el entorno', () => {
  const dir = dirTemporal();
  fs.writeFileSync(path.join(dir, 'TWILIO_AUTH_TOKEN'), 'desde-credencial\n');
  assert.equal(leerSecreto('TWILIO_AUTH_TOKEN', { CREDENTIALS_DIRECTORY: dir, TWILIO_AUTH_TOKEN: 'desde-entorno' }), 'desde-credencial');
  assert.equal(leerSecreto('DEEPSEEK_API_KEY', { CREDENTIALS_DIRECTORY: dir, DEEPSEEK_API_KEY: 'sk-dev' }), 'sk-dev');
  assert.equal(leerSecreto('DEEPSEEK_API_KEY', { CREDENTIALS_DIRECTORY: dir }), undefined);
  assert.throws(() => leerSecreto('../etc/passwd', {}));
});

test('config: nada se ata fuera de loopback', () => {
  assert.throws(() => cargarConfig(entornoBase({ AGENTE_HOST: '0.0.0.0' })), /0\.0\.0\.0/);
  assert.throws(() => cargarConfig(entornoBase({ AGENTE_HOST: '192.168.1.10' })));
  assert.equal(cargarConfig(entornoBase({ AGENTE_HOST: '127.0.0.1' })).host, '127.0.0.1');
});

test('config: webhook sin URL pública no arranca; sin llave de DeepSeek cae en simulado', () => {
  assert.throws(() => cargarConfig(entornoBase({ AGENTE_MODO: 'webhook' })), /AGENTE_URL_PUBLICA/);
  const c = cargarConfig(entornoBase({ AGENTE_PROVEEDOR: undefined }));
  assert.equal(c.proveedor, 'simulado');
  assert.throws(() => cargarConfig(entornoBase({ AGENTE_PROVEEDOR: 'deepseek' })), /DEEPSEEK_API_KEY/);
  assert.equal(cargarConfig(entornoBase({ AGENTE_PROVEEDOR: undefined, DEEPSEEK_API_KEY: 'sk-x-prueba' })).proveedor, 'deepseek');
});

test('config: valores por omisión del encargo', () => {
  const c = cargarConfig(entornoBase({ AGENTE_PUERTO: undefined, AGENTE_ENVIO_INTERVALO_MS: undefined }));
  assert.equal(c.modo, 'sondeo');
  assert.equal(c.puerto, 9186);
  assert.equal(c.modelo, 'deepseek-flash');
  assert.equal(c.retencionDias, 30);
  assert.equal(c.twilio.intervaloEnvioMs, 3000);
  assert.equal(c.presentarse, true);
  assert.match(c.textoPresentacion, /asistente automático de ANTE/);
  assert.equal(cargarConfig(entornoBase({ AGENTE_PRESENTARSE: 'no' })).presentarse, false);
});

test('config: faltantes se listan por nombre, nunca por valor', () => {
  try {
    cargarConfig({ TWILIO_AUTH_TOKEN: TOKEN_FALSO });
    assert.fail('debió fallar');
  } catch (e) {
    const msg = (e as Error).message;
    assert.match(msg, /TWILIO_ACCOUNT_SID/);
    assert.match(msg, /TWILIO_WHATSAPP_FROM/);
    assert.doesNotMatch(msg, new RegExp(TOKEN_FALSO));
  }
});

test('registro: un secreto nunca llega a la salida, ni en el resumen ni dentro de un error', () => {
  const lineas = capturarRegistro();
  const c = cargarConfig(entornoBase({ DEEPSEEK_API_KEY: 'sk-secreto-de-prueba-123', AGENTE_PROVEEDOR: 'deepseek' }));
  registrar('info', 'arranque', resumenConfig(c));
  registrar('error', 'algo', { error: `falló con token ${TOKEN_FALSO} y llave sk-secreto-de-prueba-123` });
  const todo = lineas.join('\n');
  assert.doesNotMatch(todo, new RegExp(TOKEN_FALSO));
  assert.doesNotMatch(todo, /sk-secreto-de-prueba-123/);
  assert.doesNotMatch(todo, /5215500000009/, 'el número del admin tampoco');
  assert.match(todo, /«secreto»/);
});
