export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/database.types';
import { readEnv } from '../../../lib/sesiones';
import { requireAdmin } from '../../../lib/admin-auth';
import { syncSesionToNotionBackground } from '../../../lib/notion';

export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  const auth = await requireAdmin(env, request);
  if (!auth.ok) return json({ error: 'no autorizado' }, 401);

  let body: { codigo?: string; precio_final?: number | null };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const codigo = (body.codigo ?? '').trim().toUpperCase();
  if (!codigo) return json({ error: 'codigo requerido' }, 400);

  const precioFinal =
    body.precio_final === null || body.precio_final === undefined || body.precio_final === ('' as any)
      ? null
      : Number(body.precio_final);
  if (precioFinal !== null && (isNaN(precioFinal) || precioFinal < 0)) {
    return json({ error: 'precio_final inválido' }, 400);
  }

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: updated, error } = await sb
    .from('sesiones')
    .update({ precio_final: precioFinal })
    .eq('codigo', codigo)
    .select('id')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!updated) return json({ error: 'no encontrado' }, 404);

  syncSesionToNotionBackground(env, updated.id);

  return json({ ok: true, precio_final: precioFinal });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
