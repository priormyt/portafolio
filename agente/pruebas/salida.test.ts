import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aWhatsApp, extraerAcciones, filtrarEnlaces, LIMITE_TWILIO, montos, validarSalida } from '../src/salida.ts';

const PERMITIDOS = { montos: new Set([1800, 2400, 3000, 900, 1200, 1500]), porcentajes: new Set([50]) };

test('salida: Markdown se vuelve formato de WhatsApp', () => {
  const md = '# Paquetes\n\n**Básico**: $1,800 MXN\n* dos fotos\n+ un look\n\n__importante__ y ~~viejo~~\n\n[Ver precios](https://www.ante.photo/#precios)';
  const wa = aWhatsApp(md);
  assert.equal(
    wa,
    '*Paquetes*\n\n*Básico*: $1,800 MXN\n- dos fotos\n- un look\n\n_importante_ y ~viejo~\n\nVer precios: https://www.ante.photo/#precios',
  );
  assert.doesNotMatch(wa, /\*\*|^#|\]\(/m);
});

test('salida: las tablas de Markdown se aplanan', () => {
  const wa = aWhatsApp('| Paquete | Precio |\n|---|---|\n| Básico | $1,800 |');
  assert.equal(wa, 'Paquete · Precio\nBásico · $1,800');
});

test('salida: sólo sobreviven los enlaces de ante.photo', () => {
  const { texto, quitados } = filtrarEnlaces(
    'Mira https://www.ante.photo/galeria y https://ante.photo/agendar. También https://evil.example.com/x, www.otro.com, wa.me/5215500000000, bit.ly/abc y escribe a alguien@gmail.com o a hola@ante.photo.',
  );
  assert.match(texto, /https:\/\/www\.ante\.photo\/galeria/);
  assert.match(texto, /https:\/\/ante\.photo\/agendar/);
  assert.match(texto, /hola@ante\.photo/);
  for (const malo of ['evil.example.com', 'otro.com', 'wa.me', 'bit.ly', 'gmail.com']) assert.doesNotMatch(texto, new RegExp(malo.replace('.', '\\.')));
  assert.equal(quitados.length, 5);
});

test('salida: un dominio falso que termina en ante.photo no pasa', () => {
  const { texto } = filtrarEnlaces('Entra a https://ante.photo.evil.com/pago');
  assert.doesNotMatch(texto, /evil/);
});

test('salida: abreviaturas no se confunden con dominios', () => {
  const t = 'Llega 10 min antes, p.ej. a las 9 a.m. Gracias.';
  assert.equal(filtrarEnlaces(t).texto, t);
});

test('salida: se detectan montos en varias formas', () => {
  assert.deepEqual(montos('$1,800 MXN, $ 900, 2,400 pesos, $3000.00 y 1.500 MXN'), [1800, 900, 3000, 2400, 1500]);
});

test('salida: una cifra fuera del conocimiento descarta la respuesta entera', () => {
  const v = validarSalida('El Básico cuesta $1,500 y el Premium $4,500.', PERMITIDOS);
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(), /\$4500/);
  const p = validarSalida('Te hacemos 20% de descuento.', PERMITIDOS);
  assert.equal(p.ok, false);
  const bien = validarSalida('El Básico cuesta $1,800 MXN; estudiantes 50% menos: $900.', PERMITIDOS);
  assert.equal(bien.ok, true);
});

test('salida: se recorta al tope de Twilio (1600) sin cortar a media palabra si se puede', () => {
  const largo = Array.from({ length: 400 }, (_, i) => `Frase número ${i}.`).join(' ');
  const v = validarSalida(largo, PERMITIDOS);
  assert.equal(v.ok, true);
  assert.ok(v.texto.length <= LIMITE_TWILIO, `${v.texto.length}`);
  assert.ok(v.texto.endsWith('.…') || v.texto.endsWith('…'));
  const conTope = validarSalida(largo, PERMITIDOS, 300);
  assert.ok(conTope.texto.length <= 300);
});

test('salida: vacía o sólo marcador → no sale', () => {
  assert.equal(validarSalida('   ', PERMITIDOS).ok, false);
  assert.equal(validarSalida('[[PASAR|motivo=x]]', PERMITIDOS).ok, false);
});

test('salida: caracteres de control e invisibles se quitan', () => {
  const v = validarSalida(`Hola${String.fromCharCode(0x200b, 0x07)} qué${String.fromCharCode(0x202e)} tal`, PERMITIDOS);
  assert.equal(v.texto, 'Hola qué tal');
});

test('acciones: AGENDAR y PASAR se extraen y el cliente no los ve', () => {
  const r = extraerAcciones('Listo, se lo paso.\n[[AGENDAR|nombre=Laura Prueba|sesion=Estándar|fecha=sábado 19]]');
  assert.equal(r.texto, 'Listo, se lo paso.');
  assert.deepEqual(r.acciones, [{ tipo: 'agendar', nombre: 'Laura Prueba', sesion: 'Estándar', fecha: 'sábado 19' }]);
  const p = extraerAcciones('No lo sé.\n[[PASAR|motivo=bodas]]');
  assert.deepEqual(p.acciones, [{ tipo: 'pasar', motivo: 'bodas' }]);
});

test('acciones: un marcador incompleto o mal cerrado se vuelve «pasar a Pablo» y no se filtra al cliente', () => {
  const incompleto = extraerAcciones('Listo.\n[[AGENDAR|nombre=Laura]]');
  assert.equal(incompleto.acciones[0].tipo, 'pasar');
  assert.equal(incompleto.texto, 'Listo.');
  const roto = extraerAcciones('Listo.\n[[AGENDAR|nombre=Laura|sesion=Básico');
  assert.equal(roto.texto, 'Listo.');
  assert.equal(roto.acciones[0].tipo, 'pasar');
  const desconocido = extraerAcciones('Hola [[BORRAR_TODO]]');
  assert.equal(desconocido.texto, 'Hola');
  assert.equal(desconocido.acciones[0].tipo, 'pasar');
});
