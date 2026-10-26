export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/database.types';
import { readEnv } from '../../lib/sesiones';
import { r2Get, nombreDescarga } from '../../lib/r2';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: APIRoute = async ({ url }) => {
  const codigo = (url.searchParams.get('codigo') ?? '').trim().toUpperCase();
  const fotoId = (url.searchParams.get('foto') ?? '').trim();
  if (!codigo || !UUID.test(fotoId)) return notFound();

  const env = await readEnv();
  if (!env.PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return notFound();
  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sesion } = await sb
    .from('sesiones')
    .select('id, estado')
    .eq('codigo', codigo)
    .maybeSingle();
  if (!sesion || sesion.estado === 'lead' || sesion.estado === 'archivada') return notFound();

  const { data: foto } = await sb
    .from('fotos')
    .select('r2_key_original, original_filename, tipo')
    .eq('id', fotoId)
    .eq('sesion_id', sesion.id)
    .maybeSingle();
  if (!foto || foto.tipo !== 'favorita' || !foto.r2_key_original) return notFound();

  let up: Response;
  try {
    up = await r2Get(env, foto.r2_key_original);
  } catch {
    return notFound();
  }
  if (!up.ok || !up.body) return notFound();

  const base = nombreDescarga(`ANTE_Favorita_${foto.original_filename ?? 'foto'}`);
  const headers: Record<string, string> = {
    'Content-Type': 'image/jpeg',
    'Content-Disposition': `attachment; filename="${base}"; filename*=UTF-8''${encodeURIComponent(base)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const len = up.headers.get('Content-Length');
  if (len) headers['Content-Length'] = len;

  return new Response(up.body, { status: 200, headers });
};

function notFound(): Response {
  return new Response('No encontrada', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
