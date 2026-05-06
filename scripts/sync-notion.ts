/**
 * Sync inicial de sesiones a Notion. Uso one-shot:
 *
 *   npm run sync:notion
 *
 * Toma cada sesión en Supabase y crea/actualiza una página en la BD de Notion
 * "Clientes de ANTe". Al terminar, cada fila en Supabase queda con su notion_page_id.
 *
 * Requiere en .env.local:
 *   PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   NOTION_TOKEN, NOTION_DATABASE_ID
 *   PUBLIC_SITE_URL  (ej: https://www.ante.photo)
 *
 * Idempotente: si la sesión ya tiene notion_page_id, hace PATCH; si no, POST.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { Database, Sesion, Paquete, SesionEstado, SesionOrigen } from '../src/lib/database.types';

const NOTION_VERSION = '2022-06-28';

const SUPABASE_URL = mustEnv('PUBLIC_SUPABASE_URL');
const SUPABASE_SERVICE = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
const NOTION_TOKEN = mustEnv('NOTION_TOKEN');
const NOTION_DATABASE_ID = mustEnv('NOTION_DATABASE_ID');
const SITE_URL = process.env.PUBLIC_SITE_URL ?? 'https://www.ante.photo';

const ESTADO_TO_NOTION: Record<SesionEstado, string> = {
  lead: 'Solicitada',
  seleccion: 'En curso',
  pago_pendiente: 'Editando',
  editando: 'Editando',
  entregada: 'Entregada',
  archivada: 'Archivada',
};

const ORIGEN_TO_NOTION: Record<SesionOrigen, string> = {
  instagram: 'Instagram',
  referido: 'Referido',
  web: 'Web',
  google: 'Google',
  tiktok: 'TikTok',
  otro: 'Otro',
};

const sb = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function rt(text: string | null | undefined) {
  if (!text) return [];
  return [{ type: 'text', text: { content: text.slice(0, 2000) } }];
}

function dateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

async function notionFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`https://api.notion.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Notion ${init.method ?? 'GET'} ${path} → ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : {};
}

function buildProps(args: {
  sesion: Sesion;
  paquete: Paquete | null;
  fotosFinales: number;
  selecciones: number;
}): Record<string, any> {
  const { sesion, paquete, fotosFinales, selecciones } = args;

  const precioFinal =
    (paquete?.precio_base ? Number(paquete.precio_base) : 0) +
    (sesion.monto_extras ? Number(sesion.monto_extras) : 0);

  const fechaLimite = sesion.fecha_entrega
    ? new Date(new Date(sesion.fecha_entrega).getTime() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
    : null;

  const linkEntrega =
    sesion.codigo ? `${SITE_URL.replace(/\/$/, '')}/clientes/${sesion.codigo}` : null;

  const notasAdmin = sesion.notas_admin;

  const props: Record<string, any> = {
    Nombre: { title: rt(sesion.nombre_cliente) },
    'Código': { rich_text: rt(sesion.codigo) },
    Estado: { status: { name: ESTADO_TO_NOTION[sesion.estado] } },
    Email: { email: sesion.email_cliente || null },
    'Teléfono': { phone_number: sesion.telefono || null },
    'Handle IG': { rich_text: rt(sesion.handle_ig) },
    'Ubicación': { rich_text: rt(sesion.ubicacion) },
    'Fecha Preferida': { date: sesion.fecha_preferida ? { start: dateOnly(sesion.fecha_preferida)! } : null },
    'Fecha Sesión': { date: sesion.fecha_sesion ? { start: dateOnly(sesion.fecha_sesion)! } : null },
    'Fecha de Alta': { date: sesion.created_at ? { start: dateOnly(sesion.created_at)! } : null },
    'Fecha Límite Entrega': { date: fechaLimite ? { start: fechaLimite } : null },
    'Es Estudiante': { checkbox: !!sesion.es_estudiante },
    'Fotos Seleccionadas': { number: selecciones },
    'Fotos Entregadas': { number: fotosFinales },
    'Precio Final': { number: precioFinal > 0 ? precioFinal : null },
    'Notas': { rich_text: rt(notasAdmin) },
    'Notas Sesión': { rich_text: rt(sesion.notas_sesion) },
    'Notas Técnicas': { rich_text: rt(sesion.notas_tecnicas) },
    'Link de Entrega': { url: linkEntrega },
  };

  if (sesion.origen) {
    props['Origen'] = { select: { name: ORIGEN_TO_NOTION[sesion.origen] } };
  }

  return props;
}

async function syncOne(sesion: Sesion): Promise<{ pageId: string; created: boolean }> {
  const [paqueteRes, fotosRes, seleccionesRes] = await Promise.all([
    sesion.paquete_id
      ? sb.from('paquetes').select('*').eq('id', sesion.paquete_id).maybeSingle()
      : Promise.resolve({ data: null as Paquete | null }),
    sb.from('fotos').select('id, tipo').eq('sesion_id', sesion.id),
    sb.from('selecciones').select('id').eq('sesion_id', sesion.id),
  ]);

  const fotosFinales = (fotosRes.data ?? []).filter((f) => f.tipo === 'final').length;
  const selecciones = (seleccionesRes.data ?? []).length;

  const properties = buildProps({
    sesion,
    paquete: paqueteRes.data ?? null,
    fotosFinales,
    selecciones,
  });

  let pageId = sesion.notion_page_id;
  let created = false;

  if (pageId) {
    try {
      await notionFetch(`/v1/pages/${pageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      });
    } catch (err: any) {
      if (String(err?.message ?? '').includes('404')) {
        pageId = null;
      } else {
        throw err;
      }
    }
  }

  if (!pageId) {
    const page = await notionFetch('/v1/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        properties,
      }),
    });
    pageId = page.id;
    created = true;
    await sb.from('sesiones').update({ notion_page_id: pageId }).eq('id', sesion.id);
  }

  return { pageId: pageId!, created };
}

async function main() {
  console.log('🔄 Sync de sesiones a Notion...\n');

  const { data: sesiones, error } = await sb
    .from('sesiones')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  if (!sesiones || sesiones.length === 0) {
    console.log('No hay sesiones que sincronizar.');
    return;
  }

  console.log(`Encontradas ${sesiones.length} sesiones.\n`);

  let creadas = 0;
  let actualizadas = 0;
  let fallidas = 0;

  for (const s of sesiones) {
    try {
      const res = await syncOne(s as Sesion);
      if (res.created) {
        console.log(`  ✓ creada    ${s.codigo ?? '(lead)'} · ${s.nombre_cliente} → ${res.pageId}`);
        creadas++;
      } else {
        console.log(`  ✓ actualiz. ${s.codigo ?? '(lead)'} · ${s.nombre_cliente}`);
        actualizadas++;
      }
    } catch (err) {
      console.error(`  ✗ FALLO    ${s.codigo ?? '(lead)'} · ${s.nombre_cliente}:`, err instanceof Error ? err.message : err);
      fallidas++;
    }
    // Pequeño delay para no saturar Notion API (3 req/s)
    await new Promise((r) => setTimeout(r, 350));
  }

  console.log(`\n→ Creadas ${creadas} · Actualizadas ${actualizadas} · Fallidas ${fallidas}`);
}

function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v) {
    console.error(`Falta env var: ${k}`);
    process.exit(1);
  }
  return v;
}

main().catch((err) => {
  console.error('Sync falló:', err);
  process.exit(1);
});
