export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/database.types';

export const POST: APIRoute = async ({ request }) => {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return json({ error: 'misconfigured' }, 500);
  }

  let body: { sesionId?: string; fotoId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const { sesionId, fotoId } = body;
  if (!sesionId || !fotoId) {
    return json({ error: 'missing params' }, 400);
  }

  const sb = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Validar que la sesión esté en estado 'seleccion'
  const { data: sesion } = await sb
    .from('sesiones')
    .select('estado')
    .eq('id', sesionId)
    .maybeSingle();

  if (!sesion) return json({ error: 'sesion not found' }, 404);
  if (sesion.estado !== 'seleccion') {
    return json({ error: 'sesion locked' }, 403);
  }

  const { data: existing } = await sb
    .from('selecciones')
    .select('id')
    .eq('sesion_id', sesionId)
    .eq('foto_id', fotoId)
    .maybeSingle();

  if (existing) {
    await sb.from('selecciones').delete().eq('id', existing.id);
    return json({ seleccionada: false });
  }

  const { error } = await sb.from('selecciones').insert({
    sesion_id: sesionId,
    foto_id: fotoId,
  });
  if (error) return json({ error: error.message }, 500);
  return json({ seleccionada: true });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
