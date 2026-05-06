export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/database.types';
import { readEnv } from '../../lib/sesiones';
import { syncSesionToNotionBackground } from '../../lib/notion';
import { notifyAdminConfirmacion } from '../../lib/mail';

export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  const url = env.PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json({ error: 'misconfigured' }, 500);

  let body: { sesionId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const { sesionId } = body;
  if (!sesionId) return json({ error: 'missing sesionId' }, 400);

  const sb = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Cargar sesión + paquete + selecciones
  const { data: sesion, error: errSesion } = await sb
    .from('sesiones')
    .select('*, paquete:paquetes(*)')
    .eq('id', sesionId)
    .maybeSingle();

  if (errSesion || !sesion) return json({ error: 'sesion not found' }, 404);
  if (sesion.estado !== 'seleccion') {
    return json({ error: 'sesion already confirmed' }, 403);
  }

  const { count: numSelecciones } = await sb
    .from('selecciones')
    .select('*', { count: 'exact', head: true })
    .eq('sesion_id', sesionId);

  if (!numSelecciones || numSelecciones === 0) {
    return json({ error: 'no selections' }, 400);
  }

  const limite = sesion.limite_fotos ?? sesion.paquete?.fotos_incluidas ?? 0;
  const extras = Math.max(0, numSelecciones - limite);
  const monto = extras * Number(sesion.precio_extra ?? 0);

  // Si no hay extras → pasar directo a 'editando'
  if (extras === 0) {
    await sb
      .from('sesiones')
      .update({
        estado: 'editando',
        fecha_confirmacion: new Date().toISOString(),
      })
      .eq('id', sesionId);

    await syncSesionToNotionBackground(env, sesionId);
    notifyAdminConfirmacion(env, {
      codigo: sesion.codigo ?? sesionId,
      nombre: sesion.nombre_cliente,
      seleccionadas: numSelecciones,
      extras: 0,
      monto: 0,
    });
    return json({ ok: true, redirect: `/clientes/${sesion.codigo}` });
  }

  // Hay extras → pasar a 'pago_pendiente' y guardar monto
  await sb
    .from('sesiones')
    .update({
      estado: 'pago_pendiente',
      fecha_confirmacion: new Date().toISOString(),
      monto_extras: monto,
    })
    .eq('id', sesionId);

  await syncSesionToNotionBackground(env, sesionId);
  notifyAdminConfirmacion(env, {
    codigo: sesion.codigo ?? sesionId,
    nombre: sesion.nombre_cliente,
    seleccionadas: numSelecciones,
    extras,
    monto,
  });

  return json({
    ok: true,
    extras,
    monto,
    redirect: `/clientes/${sesion.codigo}`,
  });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
