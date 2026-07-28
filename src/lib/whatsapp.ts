import type { Env } from './sesiones';

/**
 * Manda un WhatsApp al admin vía Twilio Sandbox (gratis) o número aprobado.
 *
 * Si TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM o ADMIN_WHATSAPP_TO
 * faltan, hace no-op silencioso (igual que mail.ts con Resend). Así nada rompe en
 * dev y producción sólo manda si está configurado.
 *
 * Setup mínimo (Twilio Sandbox):
 *  1. Crear cuenta en https://www.twilio.com
 *  2. Console → Messaging → Try it out → Send a WhatsApp message → activar sandbox
 *  3. El admin manda al número de sandbox un mensaje "join <code>" desde su WhatsApp
 *  4. Copiar Account SID y Auth Token (Console → Account → API keys & tokens)
 *  5. Secrets en Worker:
 *      TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxx
 *      TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxx
 *      TWILIO_WHATSAPP_FROM=whatsapp:+14155238886   (número de sandbox)
 *      ADMIN_WHATSAPP_TO=whatsapp:+525512388782
 *
 * Para producción real (no sandbox) hay que aprobar templates en Twilio.
 */
type SendArgs = {
  body: string;
  /** Si quieres mandar a un número distinto al ADMIN_WHATSAPP_TO. */
  to?: string;
};

async function send(env: Env, args: SendArgs): Promise<void> {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_WHATSAPP_FROM;
  const to = args.to ?? env.ADMIN_WHATSAPP_TO;

  if (!sid || !token || !from || !to) {
    console.log('[whatsapp] vars no configuradas, skip:', args.body.slice(0, 60));
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = btoa(`${sid}:${token}`);
  const body = new URLSearchParams({
    From: from,
    To: to,
    Body: args.body,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('[whatsapp] Twilio error:', res.status, txt);
  }
}

export function sendWhatsAppBackground(env: Env, args: SendArgs): Promise<void> {
  return send(env, args).catch((err) => console.error('[whatsapp] background fail:', err));
}

// ─── Templates ──────────────────────────────────────────────────

function adminLink(env: Env, path: string): string {
  return `${(env.PUBLIC_SITE_URL ?? '').replace(/\/$/, '')}${path}`;
}

export async function notifyAdminWALeadNuevo(
  env: Env,
  args: { nombre: string; email: string; telefono?: string | null },
): Promise<void> {
  const lines = [
    `🆕 Nuevo lead en ANTE`,
    ``,
    `Nombre: ${args.nombre}`,
    `Email: ${args.email}`,
    args.telefono ? `Tel: ${args.telefono}` : null,
    ``,
    `Convertir → ${adminLink(env, '/admin')}`,
  ].filter(Boolean).join('\n');
  return sendWhatsAppBackground(env, { body: lines });
}

export async function notifyAdminWAConfirmacion(
  env: Env,
  args: { codigo: string; nombre: string; seleccionadas: number; extras: number; monto: number },
): Promise<void> {
  const conExtras = args.extras > 0;
  const lines = [
    `✅ ${args.nombre} (${args.codigo}) confirmó selección`,
    `Fotos: ${args.seleccionadas}`,
    conExtras
      ? `Extras: ${args.extras} · A cobrar $${args.monto} MXN`
      : `Sin extras — pasa a "Editando" cuando empieces.`,
    ``,
    `Admin → ${adminLink(env, `/admin/clientes/${args.codigo}`)}`,
  ].join('\n');
  return sendWhatsAppBackground(env, { body: lines });
}

export async function notifyAdminWAComprobante(
  env: Env,
  args: { codigo: string; nombre: string; monto: number | null },
): Promise<void> {
  const lines = [
    `💸 ${args.nombre} (${args.codigo}) subió comprobante`,
    args.monto != null ? `Monto: $${args.monto} MXN` : null,
    `Verifica y pasa a "Editando".`,
    ``,
    `Admin → ${adminLink(env, `/admin/clientes/${args.codigo}`)}`,
  ].filter(Boolean).join('\n');
  return sendWhatsAppBackground(env, { body: lines });
}
