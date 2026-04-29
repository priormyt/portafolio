import { createClient } from '@supabase/supabase-js';
import type { Database, Sesion, Foto, Seleccion, Paquete } from './database.types';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

function admin() {
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase URL or service role key');
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function publicClient() {
  if (!url || !anonKey) {
    throw new Error('Missing Supabase URL or anon key');
  }
  return createClient<Database>(url, anonKey);
}

export const r2PublicUrl = (
  import.meta.env.R2_PUBLIC_URL ?? import.meta.env.PUBLIC_R2_PUBLIC_URL ?? ''
).replace(/\/$/, '');

export function fotoUrl(r2Key: string): string {
  return `${r2PublicUrl}/${r2Key}`;
}

export type SesionCompleta = {
  sesion: Sesion;
  paquete: Paquete | null;
  fotosFinales: Foto[];
  fotosPreview: Foto[];
  selecciones: Seleccion[];
};

export async function getSesionByCodigo(codigo: string): Promise<SesionCompleta | null> {
  const sb = admin();

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
  sesionId: string,
  fotoId: string,
): Promise<{ seleccionada: boolean }> {
  const sb = admin();
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

export { publicClient };
