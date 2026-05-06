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

  let body: { sesionId?: string; codigo?: string; paquete_id?: string; fecha_sesion?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const sesionId = (body.sesionId ?? '').trim();
  const codigo = (body.codigo ?? '').trim().toUpperCase();
  if (!sesionId || !codigo) return json({ error: 'sesionId y codigo son requeridos' }, 400);
  if (!/^[A-Z0-9]+$/.test(codigo)) return json({ error: 'codigo solo A-Z y 0-9' }, 400);

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing } = await sb
    .from('sesiones')
    .select('id')
    .eq('codigo', codigo)
    .maybeSingle();
  if (existing) return json({ error: `Ya existe un cliente con código ${codigo}` }, 409);

  // Resolver paquete y limite
  let limite: number | null = null;
  if (body.paquete_id) {
    const { data: pq } = await sb
      .from('paquetes')
      .select('fotos_incluidas')
      .eq('id', body.paquete_id)
      .maybeSingle();
    if (pq) limite = pq.fotos_incluidas;
  }

  const update: any = {
    codigo,
    estado: 'seleccion',
  };
  if (body.paquete_id) update.paquete_id = body.paquete_id;
  if (limite != null) update.limite_fotos = limite;
  if (body.fecha_sesion) update.fecha_sesion = body.fecha_sesion;

  const { error } = await sb
    .from('sesiones')
    .update(update)
    .eq('id', sesionId)
    .eq('estado', 'lead');
  if (error) return json({ error: error.message }, 500);

  await syncSesionToNotionBackground(env, sesionId);

  return json({ ok: true, codigo });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
