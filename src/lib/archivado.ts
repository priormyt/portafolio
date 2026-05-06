import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { Env } from './sesiones';
import { r2Delete } from './r2';
import { upsertSesionToNotion } from './notion';

const DIAS_RETENCION = 30;

function admin(env: Env) {
  return createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Borra fotos (R2 + BD) de una sesión y la marca como 'archivada'.
 * No borra la sesión: solo libera storage y conserva histórico.
 */
export async function archivarSesion(env: Env, sesionId: string): Promise<{ borradas: number }> {
  const sb = admin(env);

  const { data: fotos } = await sb
    .from('fotos')
    .select('id, r2_key')
    .eq('sesion_id', sesionId);

  let borradas = 0;
  if (fotos && fotos.length > 0) {
    await Promise.allSettled(fotos.map((f) => r2Delete(env, f.r2_key)));
    const { error: errDel } = await sb.from('fotos').delete().eq('sesion_id', sesionId);
    if (errDel) throw errDel;
    borradas = fotos.length;
  }

  await sb
    .from('sesiones')
    .update({
      estado: 'archivada',
      fecha_archivado: new Date().toISOString(),
    })
    .eq('id', sesionId);

  upsertSesionToNotion(env, sesionId).catch((err) =>
    console.error('[notion sync archivar] fallo no fatal:', err),
  );

  return { borradas };
}

/**
 * Busca sesiones entregadas con fecha_entrega + 30 días < ahora y las archiva.
 * Se llama lazy desde /admin (index) y /admin/clientes/[codigo].
 * No bloquea el render: errores se loguean y siguen.
 */
export async function runDueArchives(env: Env): Promise<{ archivadas: number }> {
  if (!env.PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { archivadas: 0 };

  const sb = admin(env);
  const cutoff = new Date(Date.now() - DIAS_RETENCION * 24 * 60 * 60 * 1000).toISOString();

  const { data: vencidas } = await sb
    .from('sesiones')
    .select('id, codigo')
    .eq('estado', 'entregada')
    .not('fecha_entrega', 'is', null)
    .lt('fecha_entrega', cutoff);

  if (!vencidas || vencidas.length === 0) return { archivadas: 0 };

  let count = 0;
  for (const s of vencidas) {
    try {
      await archivarSesion(env, s.id);
      count++;
    } catch (err) {
      console.error(`[archivar lazy] fallo en ${s.codigo ?? s.id}:`, err);
    }
  }
  return { archivadas: count };
}

/**
 * Días que faltan para que una sesión entregada se archive automáticamente.
 * Negativo o 0 → ya está vencida y se archivará al próximo refresh de admin.
 */
export function diasParaArchivar(fechaEntrega: string | null): number | null {
  if (!fechaEntrega) return null;
  const entrega = new Date(fechaEntrega).getTime();
  const transcurridos = Math.floor((Date.now() - entrega) / (1000 * 60 * 60 * 24));
  return DIAS_RETENCION - transcurridos;
}
