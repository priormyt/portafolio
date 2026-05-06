import { createClient } from '@supabase/supabase-js';
import type { Database, Sesion, Foto, Seleccion, Paquete } from './database.types';

export type Env = {
  PUBLIC_SUPABASE_URL?: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  R2_PUBLIC_URL?: string;
  PUBLIC_R2_PUBLIC_URL?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  NOTION_TOKEN?: string;
  NOTION_DATABASE_ID?: string;
  NOTION_WEBHOOK_TOKEN?: string;
  PUBLIC_SITE_URL?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  ADMIN_EMAIL?: string;
};

/**
 * Lee env vars del runtime de Cloudflare Workers (Astro 6 API).
 * Cae a import.meta.env en dev local. Llamar dentro de handlers, no en módulo top-level.
 */
export async function readEnv(): Promise<Env> {
  let runtimeEnv: Env = {};
  try {
    const mod = await import('cloudflare:workers');
    runtimeEnv = (mod as any).env ?? {};
  } catch {
    // Fuera de Cloudflare runtime (dev local con node) — usa import.meta.env
  }
  const pick = (k: keyof Env) =>
    (runtimeEnv as any)[k] ?? (import.meta.env as any)[k];
  return {
    PUBLIC_SUPABASE_URL: pick('PUBLIC_SUPABASE_URL'),
    PUBLIC_SUPABASE_ANON_KEY: pick('PUBLIC_SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: pick('SUPABASE_SERVICE_ROLE_KEY'),
    R2_PUBLIC_URL: pick('R2_PUBLIC_URL'),
    PUBLIC_R2_PUBLIC_URL: pick('PUBLIC_R2_PUBLIC_URL'),
    R2_ACCOUNT_ID: pick('R2_ACCOUNT_ID'),
    R2_ACCESS_KEY_ID: pick('R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: pick('R2_SECRET_ACCESS_KEY'),
    R2_BUCKET_NAME: pick('R2_BUCKET_NAME'),
    ADMIN_PASSWORD: pick('ADMIN_PASSWORD'),
    ADMIN_SESSION_SECRET: pick('ADMIN_SESSION_SECRET'),
    NOTION_TOKEN: pick('NOTION_TOKEN'),
    NOTION_DATABASE_ID: pick('NOTION_DATABASE_ID'),
    NOTION_WEBHOOK_TOKEN: pick('NOTION_WEBHOOK_TOKEN'),
    PUBLIC_SITE_URL: pick('PUBLIC_SITE_URL'),
    RESEND_API_KEY: pick('RESEND_API_KEY'),
    MAIL_FROM: pick('MAIL_FROM'),
    ADMIN_EMAIL: pick('ADMIN_EMAIL'),
  };
}

function admin(env: Env) {
  const missing: string[] = [];
  if (!env.PUBLIC_SUPABASE_URL) missing.push('PUBLIC_SUPABASE_URL');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`);
  }
  return createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
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
