export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/database.types';
import { readEnv } from '../../../lib/sesiones';
import { requireAdmin } from '../../../lib/admin-auth';
import { r2Delete } from '../../../lib/r2';

export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  const auth = await requireAdmin(env, request);
  if (!auth.ok) return json({ error: 'no autorizado' }, 401);

  let body: { codigo?: string; fotoId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const codigo = (body.codigo ?? '').trim().toUpperCase();
  const fotoId = (body.fotoId ?? '').trim();
  if (!codigo || !fotoId) return json({ error: 'datos incompletos' }, 400);

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sesion } = await sb.from('sesiones').select('id').eq('codigo', codigo).maybeSingle();
  if (!sesion) return json({ error: 'sesion no existe' }, 404);

  const { data: foto } = await sb
    .from('fotos')
    .select('id, r2_key, r2_key_original, tipo')
    .eq('id', fotoId)
    .eq('sesion_id', sesion.id)
    .maybeSingle();
  if (!foto || foto.tipo !== 'favorita') return json({ error: 'favorita no encontrada' }, 404);

  const keys = [foto.r2_key, foto.r2_key_original].filter((k): k is string => !!k);
  const res = await Promise.allSettled(keys.map((k) => r2Delete(env, k)));
  if (res.some((r) => r.status === 'rejected')) {
    return json({ error: 'no se pudo borrar de R2' }, 500);
  }

  const { error } = await sb.from('fotos').delete().eq('id', foto.id);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
