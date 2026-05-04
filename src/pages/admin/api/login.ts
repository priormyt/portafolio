export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/database.types';
import { readEnv } from '../../../lib/sesiones';

export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'misconfigured' }, 500);
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const email = (body.email ?? '').trim().toLowerCase();
  if (!email) return json({ error: 'email requerido' }, 400);

  // Solo permitir emails registrados como admin
  const sbAdmin = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: admin } = await sbAdmin
    .from('admin_users')
    .select('email')
    .eq('email', email)
    .maybeSingle();

  if (!admin) {
    return json({ error: 'No autorizado' }, 403);
  }

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY);
  // shouldCreateUser:true porque la primera vez no existe en auth.users
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
