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

  let body: {
    codigo?: string;
    nombre_cliente?: string;
    email_cliente?: string;
    paquete_id?: string;
    limite_fotos?: number;
    fecha_sesion?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const codigo = (body.codigo ?? '').trim().toUpperCase();
  const nombre = (body.nombre_cliente ?? '').trim();
  if (!codigo || !nombre) return json({ error: 'codigo y nombre son requeridos' }, 400);
  if (!/^[A-Z0-9]+$/.test(codigo)) return json({ error: 'el código solo puede tener A-Z y 0-9' }, 400);

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verificar que no exista
  const { data: existing } = await sb.from('sesiones').select('id').eq('codigo', codigo).maybeSingle();
  if (existing) return json({ error: `Ya existe un cliente con código ${codigo}` }, 409);

  // Resolver paquete (necesario para limite_fotos default)
  let limite = body.limite_fotos ?? null;
  if (body.paquete_id && limite == null) {
    const { data: pq } = await sb
      .from('paquetes')
      .select('fotos_incluidas')
      .eq('id', body.paquete_id)
      .maybeSingle();
    if (pq) limite = pq.fotos_incluidas;
  }

  const { data: sesion, error } = await sb
    .from('sesiones')
    .insert({
      codigo,
      nombre_cliente: nombre,
      email_cliente: body.email_cliente?.trim() || null,
      paquete_id: body.paquete_id || null,
      limite_fotos: limite,
      fecha_sesion: body.fecha_sesion || null,
      estado: 'seleccion',
    })
    .select()
    .single();

  if (error || !sesion) return json({ error: error?.message ?? 'error creando sesión' }, 500);

  await syncSesionToNotionBackground(env, sesion.id);

  return json({ ok: true, sesion });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
