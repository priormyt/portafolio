export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/database.types';
import { readEnv, fotoUrl } from '../../lib/sesiones';
import { r2Put, contentTypeFor } from '../../lib/r2';
import { syncSesionToNotionBackground } from '../../lib/notion';
import { notifyAdminComprobante } from '../../lib/mail';
import { notifyAdminWAComprobante } from '../../lib/whatsapp';

/**
 * Endpoint público (sin admin auth) para que el CLIENTE suba su comprobante
 * de pago de fotos extra. Se valida por código + estado === 'pago_pendiente'.
 * Después de subir, notifica al admin (email + WhatsApp) para que verifique
 * y pase a 'editando' manualmente.
 */
export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  if (!env.PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'misconfigured' }, 500);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'invalid form data' }, 400);
  }

  const codigo = String(form.get('codigo') ?? '').trim().toUpperCase();
  const file = form.get('file');
  if (!codigo) return json({ error: 'codigo requerido' }, 400);
  if (!(file instanceof File)) return json({ error: 'falta el archivo' }, 400);
  if (file.size > 8 * 1024 * 1024) return json({ error: 'el archivo excede 8 MB' }, 400);

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sesion } = await sb
    .from('sesiones')
    .select('id, codigo, nombre_cliente, email_cliente, estado, monto_extras')
    .eq('codigo', codigo)
    .maybeSingle();
  if (!sesion) return json({ error: 'sesion no existe' }, 404);
  if (sesion.estado !== 'pago_pendiente') {
    return json({ error: 'esta sesión no espera comprobante' }, 409);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const r2Key = `clientes/${codigo}/comprobantes/${stamp}_${safeName}`;
  const ct = file.type || contentTypeFor(safeName);

  try {
    await r2Put(env, r2Key, await file.arrayBuffer(), ct);
  } catch (err) {
    return json({ error: `R2 upload failed: ${err instanceof Error ? err.message : err}` }, 500);
  }

  const url = fotoUrl(env, r2Key);
  const { error } = await sb
    .from('sesiones')
    .update({ comprobante_50_url: url })
    .eq('id', sesion.id);
  if (error) return json({ error: error.message }, 500);

  await syncSesionToNotionBackground(env, sesion.id);

  const adminArgs = {
    codigo: sesion.codigo ?? '',
    nombre: sesion.nombre_cliente,
    monto: sesion.monto_extras != null ? Number(sesion.monto_extras) : null,
  };
  notifyAdminComprobante(env, { ...adminArgs, comprobanteUrl: url });
  notifyAdminWAComprobante(env, adminArgs);

  return json({ ok: true, url });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
