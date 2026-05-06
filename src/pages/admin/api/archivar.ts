export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/database.types';
import { readEnv } from '../../../lib/sesiones';
import { requireAdmin } from '../../../lib/admin-auth';
import { archivarSesion } from '../../../lib/archivado';

export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  const auth = await requireAdmin(env, request);
  if (!auth.ok) return json({ error: 'no autorizado' }, 401);

  let body: { codigo?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const codigo = (body.codigo ?? '').trim().toUpperCase();
  if (!codigo) return json({ error: 'codigo requerido' }, 400);

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sesion } = await sb
    .from('sesiones')
    .select('id')
    .eq('codigo', codigo)
    .maybeSingle();

  if (!sesion) return json({ error: 'sesion no existe' }, 404);

  try {
    const res = await archivarSesion(env, sesion.id);
    return json({ ok: true, ...res });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
