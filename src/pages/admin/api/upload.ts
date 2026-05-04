export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database, FotoTipo } from '../../../lib/database.types';
import { readEnv } from '../../../lib/sesiones';
import { requireAdmin } from '../../../lib/admin-auth';
import { r2Put, contentTypeFor } from '../../../lib/r2';

/**
 * Recibe multipart/form-data con: codigo, tipo, orden, file.
 * Sube el file a R2 bajo clientes/{codigo}/{tipo}s/{filename}
 * y registra la foto en la BD.
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
  const tipo = String(form.get('tipo') ?? '').trim() as FotoTipo;
  const orden = parseInt(String(form.get('orden') ?? '0'), 10);
  const file = form.get('file');

  if (!codigo || !tipo || !(file instanceof File)) {
    return json({ error: 'datos incompletos' }, 400);
  }
  if (tipo !== 'preview' && tipo !== 'final') {
    return json({ error: 'tipo inválido' }, 400);
  }

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sesion } = await sb
    .from('sesiones')
    .select('id')
    .eq('codigo', codigo)
    .maybeSingle();
  if (!sesion) return json({ error: 'sesion no existe' }, 404);

  // Sanitizar filename
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const folder = tipo === 'preview' ? 'previews' : 'finales';
  const r2Key = `clientes/${codigo}/${folder}/${safeName}`;
  const ct = file.type || contentTypeFor(safeName);

  try {
    const buf = await file.arrayBuffer();
    await r2Put(env, r2Key, buf, ct);
  } catch (err) {
    return json({ error: `R2 upload failed: ${err instanceof Error ? err.message : err}` }, 500);
  }

  const { error: errFoto } = await sb.from('fotos').upsert(
    {
      sesion_id: sesion.id,
      r2_key: r2Key,
      tipo,
      orden: isNaN(orden) ? 0 : orden,
      original_filename: safeName,
    },
    { onConflict: 'sesion_id,r2_key' },
  );

  if (errFoto) return json({ error: errFoto.message }, 500);

  return json({ ok: true, r2_key: r2Key });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
