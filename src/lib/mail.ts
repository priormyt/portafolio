import type { Env } from './sesiones';

const RESEND_URL = 'https://api.resend.com/emails';

type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
};

/**
 * Envía un correo vía Resend. Si RESEND_API_KEY no está configurado, hace no-op
 * silencioso (los emails son nice-to-have, no deben romper el flujo).
 */
async function sendMail(env: Env, args: SendArgs): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log('[mail] RESEND_API_KEY no configurado, skip:', args.subject);
    return;
  }
  if (!env.MAIL_FROM) {
    console.warn('[mail] MAIL_FROM no configurado');
    return;
  }

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('[mail] Resend error:', res.status, txt);
  }
}

/**
 * Versión "fire and forget" — nunca lanza errores, los loguea.
 */
export function sendMailBackground(env: Env, args: SendArgs): void {
  sendMail(env, args).catch((err) => console.error('[mail] background fail:', err));
}

// ─── Templates ──────────────────────────────────────────────────

const baseStyle = `font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;line-height:1.6;color:#222;max-width:560px;margin:0 auto;padding:24px;`;
const labelStyle = `font-family:'DM Mono',monospace;font-size:11px;letter-spacing:0.18em;color:#888;text-transform:uppercase;`;

function shell(title: string, bodyHtml: string): string {
  return `<div style="${baseStyle}">
    <p style="${labelStyle}">ANTE Estudio</p>
    <h1 style="font-family:Georgia,serif;font-weight:300;font-size:22px;margin:8px 0 20px;">${title}</h1>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px;">
    <p style="${labelStyle}">Este correo fue enviado por el sistema de ANTE Estudio.</p>
  </div>`;
}

export function notifyAdminLeadNuevo(
  env: Env,
  args: {
    nombre: string;
    email: string;
    telefono?: string | null;
    handleIg?: string | null;
    paqueteNombre?: string | null;
    fechaPreferida?: string | null;
    origen?: string | null;
    notas?: string | null;
  },
): void {
  if (!env.ADMIN_EMAIL) return;
  const lines: string[] = [];
  lines.push(`<p><strong>${escapeHtml(args.nombre)}</strong> envió una solicitud por /agendar.</p>`);
  lines.push(`<table style="border-collapse:collapse;margin:16px 0;"><tbody>`);
  const row = (k: string, v: string | null | undefined) =>
    v ? `<tr><td style="padding:4px 16px 4px 0;${labelStyle}">${k}</td><td style="padding:4px 0;">${escapeHtml(v)}</td></tr>` : '';
  lines.push(row('Email', args.email));
  lines.push(row('Teléfono', args.telefono ?? null));
  lines.push(row('Instagram', args.handleIg ?? null));
  lines.push(row('Paquete', args.paqueteNombre ?? null));
  lines.push(row('Fecha pref.', args.fechaPreferida ?? null));
  lines.push(row('Origen', args.origen ?? null));
  lines.push(`</tbody></table>`);
  if (args.notas) {
    lines.push(`<p style="${labelStyle}">Notas</p><blockquote style="margin:8px 0;padding:12px;border-left:2px solid #ddd;color:#555;">${escapeHtml(args.notas)}</blockquote>`);
  }
  const adminUrl = (env.PUBLIC_SITE_URL ?? '').replace(/\/$/, '') + '/admin';
  if (adminUrl) {
    lines.push(`<p style="margin-top:24px;"><a href="${adminUrl}" style="background:#0d0d0b;color:#f5f2ed;padding:10px 20px;text-decoration:none;font-family:'DM Mono',monospace;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;">Convertir lead →</a></p>`);
  }

  sendMailBackground(env, {
    to: env.ADMIN_EMAIL,
    subject: `Nuevo lead · ${args.nombre}`,
    html: shell('Nuevo lead', lines.join('')),
    replyTo: args.email,
  });
}

export function notifyAdminConfirmacion(
  env: Env,
  args: {
    codigo: string;
    nombre: string;
    seleccionadas: number;
    extras: number;
    monto: number;
  },
): void {
  if (!env.ADMIN_EMAIL) return;
  const conExtras = args.extras > 0;
  const subject = conExtras
    ? `${args.codigo} confirmó · ${args.extras} extras · $${args.monto} MXN`
    : `${args.codigo} confirmó · sin extras`;
  const body =
    `<p><strong>${escapeHtml(args.nombre)}</strong> (${escapeHtml(args.codigo)}) confirmó su selección de <strong>${args.seleccionadas}</strong> foto${args.seleccionadas !== 1 ? 's' : ''}.</p>` +
    (conExtras
      ? `<p>Tiene <strong>${args.extras} extra${args.extras !== 1 ? 's' : ''}</strong> · monto a cobrar: <strong>$${args.monto} MXN</strong>. Marca como "Editando" cuando recibas el pago.</p>`
      : `<p>Sin extras. Pasa a "Editando" cuando empieces a editar.</p>`);

  sendMailBackground(env, {
    to: env.ADMIN_EMAIL,
    subject,
    html: shell('Selección confirmada', body),
  });
}

export function notifyClienteEntregada(
  env: Env,
  args: { email: string; nombre: string; codigo: string },
): void {
  if (!args.email) return;
  const galeriaUrl = `${(env.PUBLIC_SITE_URL ?? '').replace(/\/$/, '')}/clientes/${args.codigo}`;
  const body =
    `<p>Hola ${escapeHtml(args.nombre.split(' ')[0])},</p>` +
    `<p>Tus fotos ya están listas para descargar en alta resolución.</p>` +
    `<p style="margin:24px 0;"><a href="${galeriaUrl}" style="background:#0d0d0b;color:#f5f2ed;padding:14px 28px;text-decoration:none;font-family:'DM Mono',monospace;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;">Abrir mi galería</a></p>` +
    `<p style="${labelStyle};margin-top:24px">Tu código de acceso es <strong style="color:#222;font-family:monospace;">${escapeHtml(args.codigo)}</strong></p>` +
    `<p style="font-size:13px;color:#777;line-height:1.6;">Las fotos quedan disponibles 30 días. Si necesitas más tiempo, escríbenos antes para reactivarlas.</p>`;

  sendMailBackground(env, {
    to: args.email,
    subject: `Tus fotos están listas · ${args.codigo}`,
    html: shell('Tus fotos están listas', body),
    replyTo: env.ADMIN_EMAIL,
  });
}

export function notifyClienteArchivoProximo(
  env: Env,
  args: { email: string; nombre: string; codigo: string; diasRestantes: number },
): void {
  if (!args.email) return;
  const galeriaUrl = `${(env.PUBLIC_SITE_URL ?? '').replace(/\/$/, '')}/clientes/${args.codigo}`;
  const body =
    `<p>Hola ${escapeHtml(args.nombre.split(' ')[0])},</p>` +
    `<p>Tus fotos siguen disponibles en tu galería privada, pero <strong>se archivarán en ${args.diasRestantes} día${args.diasRestantes !== 1 ? 's' : ''}</strong> y dejarán de estar accesibles.</p>` +
    `<p>Si todavía no las descargaste, hazlo ahora:</p>` +
    `<p style="margin:24px 0;"><a href="${galeriaUrl}" style="background:#0d0d0b;color:#f5f2ed;padding:14px 28px;text-decoration:none;font-family:'DM Mono',monospace;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;">Descargar mis fotos</a></p>` +
    `<p style="font-size:13px;color:#777;line-height:1.6;">Si necesitas más tiempo, contéstanos este correo y lo arreglamos.</p>`;

  sendMailBackground(env, {
    to: args.email,
    subject: `Tus fotos se archivan en ${args.diasRestantes} días · ${args.codigo}`,
    html: shell('Aviso de archivado', body),
    replyTo: env.ADMIN_EMAIL,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}
