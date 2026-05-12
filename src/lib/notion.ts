import { createClient } from '@supabase/supabase-js';
import type { Database, Sesion, Paquete, SesionEstado, SesionOrigen } from './database.types';
import type { Env } from './sesiones';

const NOTION_VERSION = '2022-06-28';

/**
 * Mapeo de estado interno → opción en Notion (campo "Estado", tipo status).
 * El status de Notion no se puede extender vía API, así que reusamos las
 * opciones existentes: Solicitada, Confirmada, En curso, Editando, Entregada, Cancelada.
 */
const ESTADO_TO_NOTION: Record<SesionEstado, string> = {
  lead:           'Solicitada',
  seleccion:      'En curso',
  pago_pendiente: 'Editando',
  editando:       'Editando',
  entregada:      'Entregada',
  archivada:      'Archivada',
};

const ORIGEN_TO_NOTION: Record<SesionOrigen, string> = {
  instagram: 'Instagram',
  referido:  'Referido',
  web:       'Web',
  google:    'Google',
  tiktok:    'TikTok',
  otro:      'Otro',
};

function admin(env: Env) {
  return createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function rt(text: string | null | undefined) {
  if (!text) return [];
  return [{ type: 'text', text: { content: text.slice(0, 2000) } }];
}

function dateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

async function notionFetch(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  if (!env.NOTION_TOKEN) throw new Error('NOTION_TOKEN no configurado');
  const res = await fetch(`https://api.notion.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`Notion ${init.method ?? 'GET'} ${path} → ${res.status}: ${txt}`);
  }
  return txt ? JSON.parse(txt) : {};
}

function buildProperties(args: {
  sesion: Sesion;
  paquete: Paquete | null;
  fotosFinales: number;
  selecciones: number;
  siteUrl: string | null;
}): Record<string, any> {
  const { sesion, paquete, fotosFinales, selecciones, siteUrl } = args;

  // precio_final manual gana sobre el cálculo. Si no hay override, sumamos paquete + extras.
  const precioCalculado =
    (paquete?.precio_base ? Number(paquete.precio_base) : 0) +
    (sesion.monto_extras ? Number(sesion.monto_extras) : 0);
  const precioFinal =
    sesion.precio_final != null ? Number(sesion.precio_final) : precioCalculado;

  const fechaLimite = sesion.fecha_entrega
    ? new Date(new Date(sesion.fecha_entrega).getTime() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
    : null;

  const linkEntrega =
    siteUrl && sesion.codigo ? `${siteUrl.replace(/\/$/, '')}/clientes/${sesion.codigo}` : null;

  const notasAdmin = sesion.notas_admin;

  const props: Record<string, any> = {
    Nombre:                { title: rt(sesion.nombre_cliente) },
    'Código':              { rich_text: rt(sesion.codigo) },
    Estado:                { status: { name: ESTADO_TO_NOTION[sesion.estado] } },
    Email:                 { email: sesion.email_cliente || null },
    'Teléfono':            { phone_number: sesion.telefono || null },
    'Handle IG':           { rich_text: rt(sesion.handle_ig) },
    'Ubicación':           { rich_text: rt(sesion.ubicacion) },
    'Fecha Preferida':     { date: sesion.fecha_preferida ? { start: dateOnly(sesion.fecha_preferida)! } : null },
    'Fecha Sesión':        { date: sesion.fecha_sesion ? { start: dateOnly(sesion.fecha_sesion)! } : null },
    'Fecha de Alta':       { date: sesion.created_at ? { start: dateOnly(sesion.created_at)! } : null },
    'Fecha Límite Entrega':{ date: fechaLimite ? { start: fechaLimite } : null },
    'Es Estudiante':       { checkbox: !!sesion.es_estudiante },
    'Fotos Seleccionadas': { number: selecciones },
    'Fotos Entregadas':    { number: fotosFinales },
    'Precio Final':        { number: precioFinal > 0 ? precioFinal : null },
    'Notas':               { rich_text: rt(notasAdmin) },
    'Notas Sesión':        { rich_text: rt(sesion.notas_sesion) },
    'Notas Técnicas':      { rich_text: rt(sesion.notas_tecnicas) },
    'Link de Entrega':     { url: linkEntrega },
    'Comprobante 50%':     {
      files: sesion.comprobante_50_url
        ? [{ name: 'comprobante.jpg', type: 'external', external: { url: sesion.comprobante_50_url } }]
        : [],
    },
  };

  if (sesion.origen) {
    props['Origen'] = { select: { name: ORIGEN_TO_NOTION[sesion.origen] } };
  }

  return props;
}

/**
 * Upsert de una sesión a Notion. Si ya existe (notion_page_id guardado), hace PATCH.
 * Si no, hace POST y guarda el page_id de regreso en Supabase.
 *
 * Es safe llamarla en background (no bloqueante): los errores se loguean y se descartan.
 * Si NOTION_TOKEN no está configurado, hace no-op silencioso.
 */
export async function upsertSesionToNotion(env: Env, sesionId: string): Promise<{ pageId: string } | null> {
  if (!env.NOTION_TOKEN || !env.NOTION_DATABASE_ID) return null;

  const sb = admin(env);

  const { data: sesion } = await sb.from('sesiones').select('*').eq('id', sesionId).maybeSingle();
  if (!sesion) return null;

  const [paqueteRes, fotosRes, seleccionesRes] = await Promise.all([
    sesion.paquete_id
      ? sb.from('paquetes').select('*').eq('id', sesion.paquete_id).maybeSingle()
      : Promise.resolve({ data: null as Paquete | null }),
    sb.from('fotos').select('id, tipo, parent_foto_id').eq('sesion_id', sesion.id),
    sb.from('selecciones').select('id').eq('sesion_id', sesion.id),
  ]);

  // Para Notion contamos solo las fotos principales: las subversiones (parent_foto_id != null)
  // son variantes de la misma entrega y no inflan el conteo.
  const fotosFinales = (fotosRes.data ?? []).filter((f) => f.tipo === 'final' && !f.parent_foto_id).length;
  const selecciones = (seleccionesRes.data ?? []).length;

  const properties = buildProperties({
    sesion: sesion as Sesion,
    paquete: paqueteRes.data ?? null,
    fotosFinales,
    selecciones,
    siteUrl: env.PUBLIC_SITE_URL ?? null,
  });

  let pageId = sesion.notion_page_id;

  if (pageId) {
    // Update
    try {
      await notionFetch(env, `/v1/pages/${pageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      });
    } catch (err: any) {
      // Si la página fue borrada en Notion, recreamos
      if (String(err?.message ?? '').includes('404')) {
        pageId = null;
      } else {
        throw err;
      }
    }
  }

  if (!pageId) {
    const created = await notionFetch(env, '/v1/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: env.NOTION_DATABASE_ID },
        properties,
      }),
    });
    pageId = created.id;
    await sb.from('sesiones').update({ notion_page_id: pageId }).eq('id', sesion.id);
  }

  return pageId ? { pageId } : null;
}

/**
 * Hace upsert a Notion y absorbe errores para no romper al caller.
 *
 * Importante: sí hace `await`. En Cloudflare Workers una promise sin await
 * (fire-and-forget) puede ser cancelada cuando el handler retorna su Response,
 * porque el isolate se cierra. Por eso awaiteamos aquí y el caller también
 * debe await esta función para garantizar la sincronización antes de responder.
 */
export async function syncSesionToNotionBackground(env: Env, sesionId: string): Promise<void> {
  try {
    await upsertSesionToNotion(env, sesionId);
  } catch (err) {
    console.error('[notion sync] fallo no fatal:', err);
  }
}
