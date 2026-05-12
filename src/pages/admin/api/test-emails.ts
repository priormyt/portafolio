export const prerender = false;

import type { APIRoute } from 'astro';
import { readEnv } from '../../../lib/sesiones';
import { requireAdmin } from '../../../lib/admin-auth';
import { buildClienteCambioEstadoEmail, buildClienteEntregadaEmail } from '../../../lib/mail';

const RESEND_URL = 'https://api.resend.com/emails';

const ESTADOS = ['seleccion', 'pago_pendiente', 'editando', 'entregada'] as const;
type Estado = (typeof ESTADOS)[number];

export const POST: APIRoute = async ({ request }) => {
  const env = await readEnv();
  // En dev local saltamos auth para poder probar templates sin ADMIN_PASSWORD.
  const auth = import.meta.env.DEV ? { ok: true } : await requireAdmin(env, request);
  if (!auth.ok) return json({ error: 'no autorizado' }, 401);

  let body: { email?: string };
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const to = (body.email ?? '').trim();
  if (!to) return json({ error: 'email requerido' }, 400);

  if (!env.RESEND_API_KEY) {
    return json({ ok: true, skipped: true, total: ESTADOS.length, sent: 0 });
  }
  if (!env.MAIL_FROM) return json({ error: 'MAIL_FROM no configurado' }, 500);

  const sample = { nombre: 'Javier Pérez (TEST)', codigo: 'DEMO99' };
  const emails = ESTADOS.map((estado): { estado: Estado; subject: string; html: string } => {
    const { subject, html } = estado === 'entregada'
      ? buildClienteEntregadaEmail(env, sample)
      : buildClienteCambioEstadoEmail(env, { ...sample, estado });
    return { estado, subject: `[TEST · ${estado}] ${subject}`, html };
  });

  const results = await Promise.allSettled(
    emails.map((e) =>
      fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to,
          subject: e.subject,
          html: e.html,
          ...(env.ADMIN_EMAIL ? { reply_to: env.ADMIN_EMAIL } : {}),
        }),
      }).then(async (r) => {
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          throw new Error(`${e.estado}: ${r.status} ${txt}`);
        }
        return e.estado;
      }),
    ),
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => String(r.reason));

  return json({ ok: errors.length === 0, sent, total: emails.length, errors });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
