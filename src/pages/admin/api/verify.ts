export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/database.types';
import { readEnv } from '../../../lib/sesiones';
import { setAuthCookies } from '../../../lib/admin-auth';

export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'misconfigured' }, 500);
  }

  let body: { email?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const code = (body.code ?? '').trim();
  if (!email || !code) return json({ error: 'datos incompletos' }, 400);

  // Validar admin antes de gastar verifyOtp
  const sbAdmin = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: admin } = await sbAdmin
    .from('admin_users')
    .select('email')
    .eq('email', email)
    .maybeSingle();
  if (!admin) return json({ error: 'No autorizado' }, 403);

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await sb.auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  });

  if (error || !data?.session) {
    return json({ error: error?.message ?? 'Código incorrecto' }, 401);
  }

  const cookies = setAuthCookies(data.session.access_token, data.session.refresh_token);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const c of cookies) headers.append('Set-Cookie', c);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
