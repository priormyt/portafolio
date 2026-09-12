// El proveedor de DeepSeek contra un DeepSeek falso en 127.0.0.1: nunca se
// llama a la API real desde las pruebas.

import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { crearDeepSeek, ErrorModelo } from '../src/modelo.ts';

interface Llamada {
  auth: string | undefined;
  cuerpo: Record<string, unknown>;
}

async function deepseekFalso(respuestas: Array<{ estado: number; cuerpo?: unknown; demoraMs?: number }>) {
  const llamadas: Llamada[] = [];
  const servidor = http.createServer((req, res) => {
    let crudo = '';
    req.on('data', (b) => (crudo += b));
    req.on('end', () => {
      llamadas.push({ auth: req.headers.authorization, cuerpo: JSON.parse(crudo) });
      const r = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
      setTimeout(() => {
        res.writeHead(r.estado, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.cuerpo ?? {}));
      }, r.demoraMs ?? 0);
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
  const dir = servidor.address();
  return {
    base: `http://127.0.0.1:${typeof dir === 'object' && dir ? dir.port : 0}`,
    llamadas,
    cerrar: () => new Promise<void>((ok) => { servidor.closeAllConnections(); servidor.close(() => ok()); }),
  };
}

const OK = {
  choices: [{ message: { content: 'Hola, soy una respuesta.' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1200, completion_tokens: 30, prompt_cache_hit_tokens: 1000, prompt_cache_miss_tokens: 200, total_tokens: 1230 },
};

test('deepseek: manda modelo, max_tokens, thinking desactivado y Bearer; lee el uso con caché', async () => {
  const f = await deepseekFalso([{ estado: 200, cuerpo: OK }]);
  try {
    const p = crearDeepSeek({ base: f.base, llave: 'sk-falsa', modelo: 'deepseek-flash', maxTokens: 400, tiempoMs: 2000 });
    const r = await p.responder([{ role: 'system', content: 's' }, { role: 'user', content: 'hola' }]);
    assert.equal(r.texto, 'Hola, soy una respuesta.');
    assert.deepEqual(r.uso, { entrada: 200, entradaCache: 1000, salida: 30 });
    assert.equal(f.llamadas[0].auth, 'Bearer sk-falsa');
    assert.equal(f.llamadas[0].cuerpo.model, 'deepseek-flash');
    assert.equal(f.llamadas[0].cuerpo.max_tokens, 400);
    assert.equal(f.llamadas[0].cuerpo.stream, false);
    assert.deepEqual(f.llamadas[0].cuerpo.thinking, { type: 'disabled' });
  } finally {
    await f.cerrar();
  }
});

test('deepseek: un 500 se reintenta una vez (reintento corto)', async () => {
  const f = await deepseekFalso([{ estado: 500 }, { estado: 200, cuerpo: OK }]);
  try {
    const p = crearDeepSeek({ base: f.base, llave: 'k', modelo: 'm', maxTokens: 10, tiempoMs: 2000, esperaReintentoMs: 10 });
    assert.equal((await p.responder([{ role: 'user', content: 'x' }])).texto, 'Hola, soy una respuesta.');
    assert.equal(f.llamadas.length, 2);
  } finally {
    await f.cerrar();
  }
});

test('deepseek: 402 (sin saldo) no se reintenta', async () => {
  const f = await deepseekFalso([{ estado: 402, cuerpo: { error: { message: 'Insufficient Balance' } } }]);
  try {
    const p = crearDeepSeek({ base: f.base, llave: 'k', modelo: 'm', maxTokens: 10, tiempoMs: 2000, esperaReintentoMs: 10 });
    await assert.rejects(p.responder([{ role: 'user', content: 'x' }]), (e) => e instanceof ErrorModelo && e.estado === 402);
    assert.equal(f.llamadas.length, 1);
  } finally {
    await f.cerrar();
  }
});

test('deepseek: tiempo máximo por llamada — si no contesta, se corta (y se reintenta una vez)', async () => {
  const f = await deepseekFalso([{ estado: 200, cuerpo: OK, demoraMs: 2000 }]);
  try {
    const p = crearDeepSeek({ base: f.base, llave: 'k', modelo: 'm', maxTokens: 10, tiempoMs: 150, esperaReintentoMs: 10 });
    const t0 = Date.now();
    await assert.rejects(p.responder([{ role: 'user', content: 'x' }]), /sin respuesta en 150 ms/);
    assert.ok(Date.now() - t0 < 1500);
    assert.equal(f.llamadas.length, 2);
  } finally {
    await f.cerrar();
  }
});
