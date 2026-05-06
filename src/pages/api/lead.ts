export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database, SesionOrigen } from '../../lib/database.types';
import { readEnv } from '../../lib/sesiones';
import { syncSesionToNotionBackground } from '../../lib/notion';
import { notifyAdminLeadNuevo } from '../../lib/mail';

const ORIGENES: SesionOrigen[] = ['instagram', 'referido', 'web', 'google', 'tiktok', 'otro'];

export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  if (!env.PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'misconfigured' }, 500);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const nombre = String(body.nombre ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!nombre || !email) return json({ error: 'nombre y email son requeridos' }, 400);

  const origenRaw = String(body.origen ?? '').toLowerCase().trim();
  const origen: SesionOrigen | null = ORIGENES.includes(origenRaw as SesionOrigen)
    ? (origenRaw as SesionOrigen)
    : null;

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sesion, error } = await sb
    .from('sesiones')
    .insert({
      nombre_cliente: nombre,
      email_cliente: email,
      telefono: String(body.telefono ?? '').trim() || null,
      handle_ig: String(body.handle_ig ?? '').trim() || null,
      ubicacion: String(body.ubicacion ?? '').trim() || null,
      fecha_preferida: String(body.fecha_preferida ?? '') || null,
      paquete_id: String(body.paquete_id ?? '') || null,
      es_estudiante: !!body.es_estudiante,
      origen,
      notas_sesion: String(body.notas ?? '').trim() || null,
      estado: 'lead',
    })
    .select('id')
    .single();

  if (error || !sesion) {
    return json({ error: error?.message ?? 'error creando lead' }, 500);
  }

  await syncSesionToNotionBackground(env, sesion.id);

  // Resolver nombre del paquete para el correo (no bloqueante si falla)
  let paqueteNombre: string | null = null;
  if (body.paquete_id) {
    const { data: pq } = await sb.from('paquetes').select('nombre').eq('id', body.paquete_id).maybeSingle();
    paqueteNombre = pq?.nombre ?? null;
  }

  notifyAdminLeadNuevo(env, {
    nombre,
    email,
    telefono: String(body.telefono ?? '').trim() || null,
    handleIg: String(body.handle_ig ?? '').trim() || null,
    paqueteNombre,
    fechaPreferida: String(body.fecha_preferida ?? '') || null,
    origen,
    notas: String(body.notas ?? '').trim() || null,
  });

  return json({ ok: true });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
