export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database, SesionEstado, SesionOrigen } from '../../lib/database.types';
import { readEnv } from '../../lib/sesiones';
import { upsertSesionToNotion } from '../../lib/notion';
import { archivarSesion } from '../../lib/archivado';

const NOTION_VERSION = '2022-06-28';

// Bot ID de la integración "ante-portafolio". Si un evento es causado por
// este actor, lo disparamos nosotros mismos (push back) → ignorar para no loop.
const BOT_ID = '357aa7a3-5835-8106-840c-0027d8a80463';

// Estado: Notion status name → SesionEstado (lossy: Confirmada/Cancelada no mapean)
const NOTION_TO_ESTADO: Record<string, SesionEstado | null> = {
  Solicitada: 'lead',
  Confirmada: null,
  'En curso': 'seleccion',
  Editando: 'editando',
  Entregada: 'entregada',
  Archivada: 'archivada',
  Cancelada: null,
};

// Origen: Notion select name → SesionOrigen
const NOTION_TO_ORIGEN: Record<string, SesionOrigen | null> = {
  Instagram: 'instagram',
  Referido: 'referido',
  Web: 'web',
  Google: 'google',
  TikTok: 'tiktok',
  Otro: 'otro',
};

export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  const bodyText = await request.text();

  let body: any;
  try { body = JSON.parse(bodyText); } catch {
    return new Response('invalid json', { status: 400 });
  }

  // ─── 1) Verification flow ─────────────────────────────────────
  // Solo mientras el webhook no está configurado. Una vez hay token, esta
  // rama queda cerrada: si no, es un camino sin firma, abierto para siempre,
  // que además loguea lo que le manden.
  if (body.verification_token) {
    if (env.NOTION_WEBHOOK_TOKEN) {
      console.warn('[notion webhook] verification_token recibido con el webhook ya configurado; ignorado');
      return new Response('already configured', { status: 403 });
    }
    console.log('[notion webhook] ★ VERIFICATION TOKEN ★', body.verification_token);
    return jsonRes({ ok: true, hint: 'token logueado' });
  }

  // ─── 2) Verificar firma HMAC ──────────────────────────────────
  // Falla cerrado a propósito. Antes, si faltaba el token, se saltaba la
  // comprobación entera y se procesaba cualquier POST sin autenticar: este
  // endpoint cambia estados de sesión y puede disparar archivarSesion, que
  // borra las fotos de R2.
  if (!env.NOTION_WEBHOOK_TOKEN) {
    console.error('[notion webhook] NOTION_WEBHOOK_TOKEN sin configurar; no se procesa nada');
    return new Response('webhook not configured', { status: 503 });
  }
  const sigHeader = request.headers.get('X-Notion-Signature') ?? '';
  const computed = await hmacHex(env.NOTION_WEBHOOK_TOKEN, bodyText);
  if (!timingSafeEq(sigHeader, `sha256=${computed}`)) {
    console.warn('[notion webhook] firma inválida. recibida:', sigHeader);
    return new Response('invalid signature', { status: 401 });
  }

  // ─── 3) Filtros ──────────────────────────────────────────────
  if (body.type !== 'page.properties_updated') return jsonRes({ skip: 'tipo' });
  if (body.entity?.type !== 'page') return jsonRes({ skip: 'no page' });

  // Loop prevention: si todos los autores son nuestro bot → fue nuestro push back
  const authors = (body.authors ?? []) as Array<{ id: string }>;
  if (authors.length > 0 && authors.every((a) => a.id === BOT_ID)) {
    return jsonRes({ skip: 'self' });
  }

  const pageId = body.entity.id as string | undefined;
  if (!pageId) return jsonRes({ skip: 'no page id' });

  // ─── 4) Buscar la sesión ─────────────────────────────────────
  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sesion } = await sb
    .from('sesiones')
    .select('id, codigo, estado, fecha_entrega')
    .eq('notion_page_id', pageId)
    .maybeSingle();

  if (!sesion) {
    console.log(`[notion webhook] page ${pageId} no mapea a ninguna sesión`);
    return jsonRes({ skip: 'no row' });
  }

  // ─── 5) Fetch página y extraer todos los campos bilaterales ──
  const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
    },
  });
  if (!pageRes.ok) {
    console.error('[notion webhook] fetch page falló:', pageRes.status, await pageRes.text());
    return new Response('fetch fail', { status: 502 });
  }
  const page = (await pageRes.json()) as any;
  const p = page.properties ?? {};

  // ─── 6) Construir update + side effects ──────────────────────
  const update: Record<string, any> = {};

  // Texto y números directos
  const nombre = rtText(p.Nombre?.title);
  if (nombre) update.nombre_cliente = nombre;

  const codigoRaw = rtText(p['Código']?.rich_text);
  // Sólo aceptamos códigos válidos (A-Z 0-9). Si está vacío, lo dejamos null (lead).
  const codigoNorm = codigoRaw ? codigoRaw.toUpperCase().trim() : '';
  if (codigoNorm && /^[A-Z0-9]+$/.test(codigoNorm)) update.codigo = codigoNorm;
  else if (!codigoNorm) update.codigo = null;
  // si tiene chars inválidos, lo ignoramos (no overwriteamos)

  update.email_cliente = p.Email?.email || null;
  update.telefono = p['Teléfono']?.phone_number || null;
  update.handle_ig = rtText(p['Handle IG']?.rich_text);
  update.ubicacion = rtText(p['Ubicación']?.rich_text);
  update.fecha_preferida = p['Fecha Preferida']?.date?.start || null;
  update.fecha_sesion = p['Fecha Sesión']?.date?.start || null;
  update.notas_admin = rtText(p.Notas?.rich_text);
  update.notas_sesion = rtText(p['Notas Sesión']?.rich_text);
  update.notas_tecnicas = rtText(p['Notas Técnicas']?.rich_text);
  if (p['Es Estudiante']?.checkbox != null) update.es_estudiante = !!p['Es Estudiante'].checkbox;

  const origenName = p.Origen?.select?.name as string | undefined;
  update.origen = origenName ? (NOTION_TO_ORIGEN[origenName] ?? null) : null;

  // Estado con side effects
  let archivarPendiente = false;
  const estadoName = p.Estado?.status?.name as string | undefined;
  if (estadoName) {
    const newEstado = NOTION_TO_ESTADO[estadoName];
    if (newEstado === null) {
      console.log(`[notion webhook] estado "${estadoName}" sin mapeo, no toco estado`);
    } else if (newEstado === 'archivada' && sesion.estado !== 'archivada') {
      // No tocamos estado aquí: archivarSesion lo hace + borra fotos + sync back
      archivarPendiente = true;
    } else if (newEstado) {
      update.estado = newEstado;
      if (newEstado === 'entregada' && !sesion.fecha_entrega) {
        update.fecha_entrega = new Date().toISOString();
      }
    }
  }

  console.log(`[notion webhook] ${sesion.codigo ?? sesion.id}: aplicando ${Object.keys(update).length} cambios${archivarPendiente ? ' + archivar' : ''}`);

  const { error } = await sb.from('sesiones').update(update).eq('id', sesion.id);
  if (error) {
    console.error('[notion webhook] update Supabase falló:', error);
    return new Response('update fail', { status: 500 });
  }

  if (archivarPendiente) {
    try {
      await archivarSesion(env, sesion.id);
    } catch (err) {
      console.error('[notion webhook] archivar falló:', err);
    }
    return jsonRes({ ok: true, action: 'archived' });
  }

  // Push back para reflejar campos derivados (fecha_entrega → Fecha Límite, codigo → Link de Entrega).
  // El re-evento que esto genere se descarta por BOT_ID.
  // await para garantizar la sincronización antes de cerrar el isolate.
  try {
    await upsertSesionToNotion(env, sesion.id);
  } catch (e) {
    console.error('[notion webhook] sync back falló:', e);
  }

  return jsonRes({ ok: true, action: 'updated', fields: Object.keys(update).length });
};

function rtText(rt: any[] | undefined): string | null {
  if (!rt || rt.length === 0) return null;
  const out = rt.map((t: any) => t.plain_text ?? t.text?.content ?? '').join('').trim();
  return out || null;
}

function jsonRes(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
