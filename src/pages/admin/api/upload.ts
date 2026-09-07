export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database, FotoTipo } from '../../../lib/database.types';
import { readEnv } from '../../../lib/sesiones';
import { requireAdmin } from '../../../lib/admin-auth';
import { r2Put, tipoPermitido, TIPOS_FOTO } from '../../../lib/r2';

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
  const parentIdRaw = String(form.get('parent_id') ?? '').trim();
  const parentId = parentIdRaw || null;
  const file = form.get('file');

  if (!codigo || !tipo || !(file instanceof File)) {
    return json({ error: 'datos incompletos' }, 400);
  }
  if (tipo !== 'preview' && tipo !== 'final') {
    return json({ error: 'tipo inválido' }, 400);
  }
  if (parentId && tipo !== 'final') {
    return json({ error: 'parent_id solo aplica a fotos finales' }, 400);
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

  if (parentId) {
    const { data: parent } = await sb
      .from('fotos')
      .select('id, sesion_id, parent_foto_id')
      .eq('id', parentId)
      .maybeSingle();
    if (!parent || parent.sesion_id !== sesion.id) {
      return json({ error: 'parent_id inválido' }, 400);
    }
    if (parent.parent_foto_id) {
      return json({ error: 'no se permite alternativa de una alternativa' }, 400);
    }
  }

  // Sanitizar filename
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const folder = tipo === 'preview' ? 'previews' : parentId ? 'finales/alt' : 'finales';
  const r2Key = `clientes/${codigo}/${folder}/${safeName}`;
  const ct = tipoPermitido(safeName, TIPOS_FOTO);
  if (!ct) return json({ error: 'formato de imagen no permitido' }, 415);

  try {
    const buf = await file.arrayBuffer();
    await r2Put(env, r2Key, buf, ct);
  } catch (err) {
    return json({ error: `R2 upload failed: ${err instanceof Error ? err.message : err}` }, 500);
  }

  // Si ya existía una alternativa previa para este padre, la reemplazamos
  // (una sola subversión por foto principal).
  if (parentId) {
    await sb.from('fotos').delete().eq('parent_foto_id', parentId);
  }

  // Solo incluimos parent_foto_id cuando hay alt — así uploads normales
  // siguen funcionando aunque la migración 0004 aún no esté corrida en la BD.
  const payload: Record<string, unknown> = {
    sesion_id: sesion.id,
    r2_key: r2Key,
    tipo,
    orden: isNaN(orden) ? 0 : orden,
    original_filename: safeName,
  };
  if (parentId) payload.parent_foto_id = parentId;

  const { data: inserted, error: errFoto } = await sb
    .from('fotos')
    .upsert(payload, { onConflict: 'sesion_id,r2_key' })
    .select('id')
    .maybeSingle();

  if (errFoto) return json({ error: errFoto.message }, 500);

  return json({ ok: true, r2_key: r2Key, foto_id: inserted?.id ?? null });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
