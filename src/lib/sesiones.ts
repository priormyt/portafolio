import { createClient } from '@supabase/supabase-js';
import type { Database, Sesion, Foto, Seleccion, Paquete } from './database.types';

export type Env = {
  PUBLIC_SUPABASE_URL?: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  R2_PUBLIC_URL?: string;
  PUBLIC_R2_PUBLIC_URL?: string;
};

/**
 * Lee env vars priorizando el runtime (Cloudflare Workers) y cayendo a build-time.
 * El runtime se obtiene de Astro.locals.runtime.env o context.locals.runtime.env.
 */
export function readEnv(runtimeEnv?: Env): Env {
  return {
    PUBLIC_SUPABASE_URL:
      runtimeEnv?.PUBLIC_SUPABASE_URL ?? import.meta.env.PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY:
      runtimeEnv?.PUBLIC_SUPABASE_ANON_KEY ?? import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY:
      runtimeEnv?.SUPABASE_SERVICE_ROLE_KEY ?? import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
    R2_PUBLIC_URL:
      runtimeEnv?.R2_PUBLIC_URL ?? import.meta.env.R2_PUBLIC_URL,
    PUBLIC_R2_PUBLIC_URL:
      runtimeEnv?.PUBLIC_R2_PUBLIC_URL ?? import.meta.env.PUBLIC_R2_PUBLIC_URL,
  };
}

function admin(env: Env) {
  if (!env.PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase URL or service role key');
  }
  return createClient<Database>(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function fotoUrl(env: Env, r2Key: string): string {
  const base = (env.R2_PUBLIC_URL ?? env.PUBLIC_R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  return `${base}/${r2Key}`;
}

export type SesionCompleta = {
  sesion: Sesion;
  paquete: Paquete | null;
  fotosFinales: Foto[];
  fotosPreview: Foto[];
  selecciones: Seleccion[];
};

export async function getSesionByCodigo(
  env: Env,
  codigo: string,
): Promise<SesionCompleta | null> {
  const sb = admin(env);

  const { data: sesion, error } = await sb
    .from('sesiones')
    .select('*')
    .eq('codigo', codigo.toUpperCase())
    .maybeSingle();

  if (error) throw error;
  if (!sesion) return null;

  const [paqueteRes, fotosRes, seleccionesRes] = await Promise.all([
    sesion.paquete_id
      ? sb.from('paquetes').select('*').eq('id', sesion.paquete_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sb.from('fotos').select('*').eq('sesion_id', sesion.id).order('orden'),
    sb.from('selecciones').select('*').eq('sesion_id', sesion.id),
  ]);

  if (fotosRes.error) throw fotosRes.error;
  if (seleccionesRes.error) throw seleccionesRes.error;

  const fotos = fotosRes.data ?? [];

  return {
    sesion,
    paquete: paqueteRes.data ?? null,
    fotosFinales: fotos.filter((f) => f.tipo === 'final'),
    fotosPreview: fotos.filter((f) => f.tipo === 'preview'),
    selecciones: seleccionesRes.data ?? [],
  };
}

export async function toggleSeleccion(
  env: Env,
  sesionId: string,
  fotoId: string,
): Promise<{ seleccionada: boolean }> {
  const sb = admin(env);
  const { data: existing } = await sb
    .from('selecciones')
    .select('id')
    .eq('sesion_id', sesionId)
    .eq('foto_id', fotoId)
    .maybeSingle();

  if (existing) {
    await sb.from('selecciones').delete().eq('id', existing.id);
    return { seleccionada: false };
  }

  await sb.from('selecciones').insert({ sesion_id: sesionId, foto_id: fotoId });
  return { seleccionada: true };
}
