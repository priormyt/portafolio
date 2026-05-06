export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database, SesionEstado } from '../../../lib/database.types';
import { readEnv } from '../../../lib/sesiones';
import { requireAdmin } from '../../../lib/admin-auth';
import { syncSesionToNotionBackground } from '../../../lib/notion';
import { notifyClienteEntregada } from '../../../lib/mail';

const ESTADOS_VALIDOS: SesionEstado[] = ['seleccion', 'pago_pendiente', 'editando', 'entregada'];

export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  const auth = await requireAdmin(env, request);
  if (!auth.ok) return json({ error: 'no autorizado' }, 401);

  let body: { codigo?: string; estado?: SesionEstado };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const codigo = (body.codigo ?? '').trim().toUpperCase();
  const estado = body.estado;
  if (!codigo || !estado) return json({ error: 'datos incompletos' }, 400);
  if (!ESTADOS_VALIDOS.includes(estado)) return json({ error: 'estado inválido' }, 400);

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const update: Partial<Database['public']['Tables']['sesiones']['Update']> = { estado };
  if (estado === 'entregada') update.fecha_entrega = new Date().toISOString();

  const { data: updated, error } = await sb
    .from('sesiones')
    .update(update)
    .eq('codigo', codigo)
    .select('id, nombre_cliente, email_cliente, codigo')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);

  if (updated) {
    await syncSesionToNotionBackground(env, updated.id);

    if (estado === 'entregada' && updated.email_cliente) {
      notifyClienteEntregada(env, {
        email: updated.email_cliente,
        nombre: updated.nombre_cliente,
        codigo: updated.codigo ?? '',
      });
    }
  }

  return json({ ok: true });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
