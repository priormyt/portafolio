export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/database.types';
import { readEnv, fotoUrl } from '../../../lib/sesiones';
import { requireAdmin } from '../../../lib/admin-auth';
import { r2Put, contentTypeFor } from '../../../lib/r2';
import { syncSesionToNotionBackground } from '../../../lib/notion';

/**
 * Sube el comprobante del anticipo (50%) a R2 bajo
 * clientes/{codigo}/comprobantes/{filename} y guarda la URL pública en
 * sesiones.comprobante_50_url. Se sincroniza al campo "Comprobante 50%" de Notion.
 */
export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  const auth = await requireAdmin(env, request);
  if (!auth.ok) return json({ error: 'no autorizado' }, 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'invalid form data' }, 400);
  }

  const codigo = String(form.get('codigo') ?? '').trim().toUpperCase();
  const remove = form.get('remove') === '1';
  const file = form.get('file');
  if (!codigo) return json({ error: 'codigo requerido' }, 400);
  if (!remove && !(file instanceof File)) return json({ error: 'falta file o remove=1' }, 400);

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sesion } = await sb.from('sesiones').select('id').eq('codigo', codigo).maybeSingle();
  if (!sesion) return json({ error: 'sesion no existe' }, 404);

  if (remove) {
    const { error } = await sb.from('sesiones').update({ comprobante_50_url: null }).eq('id', sesion.id);
    if (error) return json({ error: error.message }, 500);
    await syncSesionToNotionBackground(env, sesion.id);
    return json({ ok: true, removed: true });
  }

  const f = file as File;
  const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const r2Key = `clientes/${codigo}/comprobantes/${safeName}`;
  const ct = f.type || contentTypeFor(safeName);

  try {
    await r2Put(env, r2Key, await f.arrayBuffer(), ct);
  } catch (err) {
    return json({ error: `R2 upload failed: ${err instanceof Error ? err.message : err}` }, 500);
  }

  const url = fotoUrl(env, r2Key);
  const { error } = await sb.from('sesiones').update({ comprobante_50_url: url }).eq('id', sesion.id);
  if (error) return json({ error: error.message }, 500);

  await syncSesionToNotionBackground(env, sesion.id);

  return json({ ok: true, url });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
