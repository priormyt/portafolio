export const prerender = false;

import type { APIRoute } from 'astro';
import { readEnv } from '../../../lib/sesiones';
import { verifyPassword, makeSessionCookie } from '../../../lib/admin-auth';

export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
    return json({ error: 'misconfigured' }, 500);
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const password = (body.password ?? '').trim();
  if (!password) return json({ error: 'falta contraseña' }, 400);

  const ok = await verifyPassword(env, password);
  if (!ok) return json({ error: 'contraseña incorrecta' }, 401);

  const cookie = await makeSessionCookie(env);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
    },
  });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
