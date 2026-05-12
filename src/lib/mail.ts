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

/** Versión "fire and forget" — nunca lanza errores, los loguea. */
export function sendMailBackground(env: Env, args: SendArgs): void {
  sendMail(env, args).catch((err) => console.error('[mail] background fail:', err));
}

// ─── Design tokens (mismos que el template hero existente) ──────
const C = {
  bgPage:    '#0b0b0b',
  bgCard:    '#111111',
  bgHeader:  '#000000',
  bgRow:     '#111111',
  bgRowSoft: '#171717',
  border:    '#262626',
  text:      '#f5f5e9',
  textDim:   '#d6d6cf',
  textMuted: '#9b9b95',
  textFaint: '#7a7a72',
  accent:    '#f5f5e9',
  divider:   '#444444',
  good:      '#9bc59b',
};

const FONT_SANS = 'Helvetica,Arial,sans-serif';
const FONT_SERIF = "'Marion','Times New Roman',serif";
const FONT_MONO = "'SFMono-Regular',Menlo,Monaco,Consolas,monospace";

// ─── Building blocks ────────────────────────────────────────────

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

function header(): string {
  return `<tr>
    <td align="center" style="padding:28px 24px 14px 24px;background-color:${C.bgHeader};">
      <a href="https://www.ante.photo" style="text-decoration:none;color:${C.text};display:inline-block;">
        <span style="font-family:${FONT_SERIF};font-size:26px;letter-spacing:0.35em;text-transform:uppercase;display:inline-block;">A&nbsp;N&nbsp;T&nbsp;E</span>
      </a>
    </td>
  </tr>`;
}

function dividerRow(): string {
  return `<tr>
    <td style="padding:0 24px;background-color:${C.bgHeader};">
      <div style="height:1px;width:100%;background:linear-gradient(90deg,transparent,${C.divider},transparent);"></div>
    </td>
  </tr>`;
}

function eyebrowRow(text: string): string {
  return `<tr>
    <td style="padding:24px 32px 0 32px;background-color:${C.bgCard};">
      <p style="margin:0;font-family:${FONT_SANS};font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${C.textDim};opacity:0.9;">${escapeHtml(text)}</p>
    </td>
  </tr>`;
}

function h1Row(text: string): string {
  return `<tr>
    <td style="padding:10px 32px 8px 32px;background-color:${C.bgCard};">
      <h1 style="margin:0;font-family:${FONT_SANS};font-size:24px;line-height:1.25;color:${C.text};font-weight:700;letter-spacing:-0.005em;">${escapeHtml(text)}</h1>
    </td>
  </tr>`;
}

function paragraphRow(html: string, opts?: { size?: 'sm' | 'md'; muted?: boolean; topPad?: number }): string {
  const size = opts?.size === 'sm' ? '13px' : '15px';
  const color = opts?.muted ? C.textDim : C.text;
  const top = opts?.topPad ?? 12;
  return `<tr>
    <td style="padding:${top}px 32px 0 32px;background-color:${C.bgCard};">
      <p style="margin:0;font-family:${FONT_SANS};font-size:${size};line-height:1.7;color:${color};">${html}</p>
    </td>
  </tr>`;
}

function buttonRow(url: string, label: string): string {
  return `<tr>
    <td align="center" style="padding:22px 32px 6px 32px;background-color:${C.bgCard};">
      <a href="${url}" style="display:inline-block;padding:13px 30px;border-radius:999px;background-color:${C.accent};color:${C.bgHeader};font-family:${FONT_SANS};font-size:13px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;text-decoration:none;">${escapeHtml(label)}</a>
    </td>
  </tr>`;
}

function codigoBlockRow(codigo: string): string {
  return `<tr>
    <td style="padding:20px 32px 0 32px;background-color:${C.bgCard};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:${C.bgRowSoft};border:1px solid ${C.border};border-radius:10px;">
        <tr>
          <td style="padding:14px 18px;">
            <p style="margin:0 0 4px 0;font-family:${FONT_SANS};font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:${C.textMuted};">Tu código de acceso</p>
            <p style="margin:0;font-family:${FONT_MONO};font-size:18px;letter-spacing:0.18em;color:${C.text};font-weight:700;">${escapeHtml(codigo)}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function timelineRow(estadoActual: 'seleccion' | 'pago_pendiente' | 'editando' | 'entregada'): string {
  const labels: Record<string, string> = {
    seleccion: 'Selección',
    pago_pendiente: 'Pago de extras',
    editando: 'Edición',
    entregada: 'Entrega',
  };
  const orden: Array<keyof typeof labels> = ['seleccion', 'pago_pendiente', 'editando', 'entregada'];
  const idx = orden.indexOf(estadoActual);

  const rows = orden.map((est, i) => {
    const done = i < idx;
    const actual = i === idx;
    const dotBg = actual ? C.accent : done ? C.textMuted : 'transparent';
    const dotBorder = actual ? C.accent : done ? C.textMuted : C.divider;
    const dotInner = actual
      ? `<span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${C.bgHeader};"></span>`
      : done
        ? `<span style="display:inline-block;color:${C.bgHeader};font-family:${FONT_SANS};font-size:11px;font-weight:700;line-height:1;">✓</span>`
        : '';
    const labelColor = actual ? C.text : done ? C.textDim : C.textFaint;
    const labelWeight = actual ? '700' : '400';
    const sublabel = actual
      ? `<span style="display:inline-block;margin-left:10px;padding:2px 8px;border-radius:999px;background:${C.accent};color:${C.bgHeader};font-family:${FONT_SANS};font-size:9px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;vertical-align:middle;">Ahora</span>`
      : '';
    const connector = i < orden.length - 1
      ? `<tr><td width="22" style="padding:0;"><div style="margin-left:9px;width:2px;height:18px;background:${i < idx ? C.textMuted : C.border};"></div></td><td></td></tr>`
      : '';
    return `<tr>
      <td width="22" valign="middle" style="padding:0;">
        <span style="display:inline-block;width:20px;height:20px;border-radius:999px;background:${dotBg};border:1.5px solid ${dotBorder};text-align:center;line-height:18px;vertical-align:middle;">${dotInner}</span>
      </td>
      <td valign="middle" style="padding:0 0 0 12px;font-family:${FONT_SANS};font-size:14px;color:${labelColor};font-weight:${labelWeight};line-height:1.4;">
        ${escapeHtml(labels[est])}${sublabel}
      </td>
    </tr>${connector}`;
  }).join('');

  return `<tr>
    <td style="padding:14px 32px 4px 32px;background-color:${C.bgCard};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows}</table>
    </td>
  </tr>`;
}

function infoBlockRow(items: Array<{ label: string; value: string }>): string {
  const rows = items.map((it) => `
    <tr>
      <td style="padding:6px 0;font-family:${FONT_SANS};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${C.textMuted};width:140px;vertical-align:top;">${escapeHtml(it.label)}</td>
      <td style="padding:6px 0;font-family:${FONT_SANS};font-size:14px;color:${C.text};line-height:1.5;">${it.value}</td>
    </tr>`).join('');
  return `<tr>
    <td style="padding:18px 32px 0 32px;background-color:${C.bgCard};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;border-top:1px solid ${C.border};">
        ${rows}
      </table>
    </td>
  </tr>`;
}

function smallNoteRow(html: string): string {
  return `<tr>
    <td style="padding:18px 32px 0 32px;background-color:${C.bgCard};">
      <p style="margin:0;font-family:${FONT_SANS};font-size:12px;line-height:1.7;color:${C.textMuted};">${html}</p>
    </td>
  </tr>`;
}

function signatureRow(): string {
  return `<tr>
    <td style="padding:22px 32px 4px 32px;background-color:${C.bgCard};">
      <p style="margin:0;font-family:${FONT_SANS};font-size:14px;line-height:1.6;color:${C.text};">
        Gracias por confiar en nosotros,<br>
        <span style="font-weight:600;letter-spacing:0.04em;">ANTE Estudio</span>
      </p>
    </td>
  </tr>`;
}

function spacerRow(h: number, bg = C.bgCard): string {
  return `<tr><td style="height:${h}px;background-color:${bg};line-height:${h}px;font-size:0;">&nbsp;</td></tr>`;
}

function footerRow(): string {
  return `<tr>
    <td style="padding:22px 32px 26px 32px;background-color:${C.bgHeader};border-top:1px solid ${C.border};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
        <tr>
          <td align="left" style="font-family:${FONT_SERIF};font-size:11px;letter-spacing:0.34em;text-transform:uppercase;color:${C.textDim};">A&nbsp;N&nbsp;T&nbsp;E · ESTUDIO</td>
        </tr>
        <tr><td style="height:10px;line-height:10px;font-size:0;">&nbsp;</td></tr>
        <tr>
          <td style="font-family:${FONT_SANS};font-size:11px;line-height:1.7;color:${C.textMuted};">
            WhatsApp <a href="https://wa.me/525951220554" style="color:${C.textDim};text-decoration:none;">+52 595 122 0554</a><br>
            Correo <a href="mailto:contacto@ante.photo" style="color:${C.textDim};text-decoration:none;">contacto@ante.photo</a><br>
            Ciudad de México · México
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

/** Envuelve filas en la tarjeta central y el shell HTML completo. */
function shell(opts: { title: string; rows: string }): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{margin:0;padding:0;background-color:${C.bgPage};} a{color:${C.text};}</style>
</head>
<body style="margin:0;padding:0;background-color:${C.bgPage};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:${C.bgPage};">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;border-collapse:collapse;background-color:${C.bgCard};border-radius:18px;border:1px solid ${C.border};box-shadow:0 22px 50px rgba(0,0,0,0.75);overflow:hidden;">
        ${opts.rows}
      </table>
      <p style="margin:18px 0 0 0;font-family:${FONT_SANS};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${C.textFaint};">Enviado por el sistema de ANTE Estudio</p>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ─── Templates: cliente ─────────────────────────────────────────

type Etapa = 'seleccion' | 'pago_pendiente' | 'editando' | 'entregada';

const ETAPAS: Record<Etapa, {
  titulo: string;
  eyebrow: string;
  resumen: string;
  tiempo: string;
  siguiente: string | null;
}> = {
  seleccion: {
    titulo: 'Ya puedes elegir tus fotos',
    eyebrow: 'Tu sesión privada · Selección',
    resumen: 'Tus previews están listos en tu galería privada. Entra cuando quieras y marca tus favoritas con calma; tu selección se guarda al momento.',
    tiempo: 'Tienes 7 días para hacer tu selección.',
    siguiente: 'Al confirmar, si elegiste fotos extra te enviamos el monto a pagar. Si no, pasamos directo a edición.',
  },
  pago_pendiente: {
    titulo: 'Esperando tu pago de extras',
    eyebrow: 'Tu sesión privada · Pago de extras',
    resumen: 'Recibimos tu selección. En cuanto confirmemos el pago de las fotos extra, comenzamos a editar tu entrega final.',
    tiempo: 'Normalmente confirmamos el pago en menos de 24 horas hábiles.',
    siguiente: 'Cuando se confirme, pasamos a edición (10 a 14 días hábiles).',
  },
  editando: {
    titulo: 'Empezamos a editar tus fotos',
    eyebrow: 'Tu sesión privada · Edición',
    resumen: 'Tu selección entró al flujo de edición. Cada foto pasa por revisión cromática, retoque y revisión final.',
    tiempo: 'La entrega final toma entre 10 y 14 días hábiles desde hoy.',
    siguiente: 'Te avisamos por este mismo correo en cuanto tu galería esté lista para descargar.',
  },
  entregada: {
    titulo: 'Tus fotos están listas',
    eyebrow: 'Galería privada · Entrega final',
    resumen: 'Las fotografías finales ya están disponibles en tu galería privada para verlas y descargarlas en alta resolución.',
    tiempo: 'Quedan disponibles 30 días desde hoy.',
    siguiente: 'Después de ese tiempo, la galería y los archivos se eliminan de manera segura.',
  },
};

export function buildClienteCambioEstadoEmail(
  env: Env,
  args: { nombre: string; codigo: string; estado: Etapa },
): { subject: string; html: string } {
  const etapa = ETAPAS[args.estado];
  const galeriaUrl = `${(env.PUBLIC_SITE_URL ?? '').replace(/\/$/, '')}/clientes/${args.codigo}`;
  const firstName = args.nombre.split(' ')[0] ?? args.nombre;

  const showCta = args.estado === 'seleccion' || args.estado === 'entregada';
  const ctaLabel = args.estado === 'entregada' ? 'Ver mi galería' : 'Elegir mis fotos';

  const rows = [
    header(),
    dividerRow(),
    eyebrowRow(etapa.eyebrow),
    h1Row(etapa.titulo),
    paragraphRow(`Hola <strong>${escapeHtml(firstName)}</strong>,`),
    paragraphRow(etapa.resumen),
    eyebrowRow('Etapa actual'),
    timelineRow(args.estado),
    paragraphRow(`<strong style="color:${C.text};">Tiempo estimado.</strong> <span style="color:${C.textDim};">${escapeHtml(etapa.tiempo)}</span>`, { size: 'sm', topPad: 16 }),
    etapa.siguiente
      ? paragraphRow(`<strong style="color:${C.text};">Siguiente paso.</strong> <span style="color:${C.textDim};">${escapeHtml(etapa.siguiente)}</span>`, { size: 'sm', topPad: 6 })
      : '',
    showCta ? buttonRow(galeriaUrl, ctaLabel) : '',
    showCta ? smallNoteRow(`Si el botón no abre, copia y pega este enlace:<br><a href="${galeriaUrl}" style="color:${C.textDim};text-decoration:underline;word-break:break-all;">${galeriaUrl}</a>`) : '',
    codigoBlockRow(args.codigo),
    signatureRow(),
    spacerRow(20),
    footerRow(),
  ].join('');

  return {
    subject: `${etapa.titulo} · ${args.codigo}`,
    html: shell({ title: etapa.titulo, rows }),
  };
}

export function notifyClienteCambioEstado(
  env: Env,
  args: { email: string; nombre: string; codigo: string; estado: Etapa },
): void {
  if (!args.email) return;
  const { subject, html } = buildClienteCambioEstadoEmail(env, args);
  sendMailBackground(env, { to: args.email, subject, html, replyTo: env.ADMIN_EMAIL });
}

export function buildClienteEntregadaEmail(
  env: Env,
  args: { nombre: string; codigo: string },
): { subject: string; html: string } {
  const galeriaUrl = `${(env.PUBLIC_SITE_URL ?? '').replace(/\/$/, '')}/clientes/${args.codigo}`;
  const firstName = args.nombre.split(' ')[0] ?? args.nombre;

  const rows = [
    header(),
    dividerRow(),
    eyebrowRow('Galería privada · Entrega final'),
    h1Row(`Hola ${firstName}, tus fotos ya están listas`),
    paragraphRow(`Gracias por confiar en <strong>ANTE</strong> para tu sesión. Preparamos tu <strong>galería privada</strong> con la selección final para que puedas verlas y descargarlas en alta resolución.`),
    paragraphRow('Esperamos que hayas disfrutado tanto del proceso como del resultado, y que estas fotografías te acompañen mucho tiempo.'),
    buttonRow(galeriaUrl, 'Ver mi galería'),
    smallNoteRow(`Si el botón no abre, copia y pega este enlace:<br><a href="${galeriaUrl}" style="color:${C.textDim};text-decoration:underline;word-break:break-all;">${galeriaUrl}</a>`),
    codigoBlockRow(args.codigo),
    smallNoteRow(`Las fotos quedan disponibles <strong style="color:${C.text};">30 días</strong> a partir de hoy. Después de ese tiempo, la galería y los archivos se eliminan de manera segura. Si necesitas más tiempo, contéstanos este correo antes del vencimiento.`),
    signatureRow(),
    spacerRow(20),
    footerRow(),
  ].join('');

  return {
    subject: `Tu galería está lista · ${args.codigo}`,
    html: shell({ title: 'Tu galería está lista', rows }),
  };
}

export function notifyClienteEntregada(
  env: Env,
  args: { email: string; nombre: string; codigo: string },
): void {
  if (!args.email) return;
  const { subject, html } = buildClienteEntregadaEmail(env, args);
  sendMailBackground(env, { to: args.email, subject, html, replyTo: env.ADMIN_EMAIL });
}

export function notifyClienteArchivoProximo(
  env: Env,
  args: { email: string; nombre: string; codigo: string; diasRestantes: number },
): void {
  if (!args.email) return;
  const galeriaUrl = `${(env.PUBLIC_SITE_URL ?? '').replace(/\/$/, '')}/clientes/${args.codigo}`;
  const firstName = args.nombre.split(' ')[0] ?? args.nombre;
  const dias = `${args.diasRestantes} día${args.diasRestantes !== 1 ? 's' : ''}`;

  const rows = [
    header(),
    dividerRow(),
    eyebrowRow('Galería privada · Aviso de archivado'),
    h1Row(`Tu galería se archiva en ${dias}`),
    paragraphRow(`Hola <strong>${escapeHtml(firstName)}</strong>,`),
    paragraphRow(`Tus fotos siguen disponibles en tu galería privada, pero <strong>se archivarán en ${dias}</strong> y dejarán de estar accesibles. Si aún no las descargaste, este es el momento.`),
    buttonRow(galeriaUrl, 'Descargar mis fotos'),
    smallNoteRow(`Si el botón no abre, copia y pega este enlace:<br><a href="${galeriaUrl}" style="color:${C.textDim};text-decoration:underline;word-break:break-all;">${galeriaUrl}</a>`),
    codigoBlockRow(args.codigo),
    smallNoteRow(`Si necesitas más tiempo, contéstanos este correo antes del vencimiento y lo arreglamos.`),
    signatureRow(),
    spacerRow(20),
    footerRow(),
  ].join('');

  sendMailBackground(env, {
    to: args.email,
    subject: `Tu galería se archiva en ${dias} · ${args.codigo}`,
    html: shell({ title: 'Aviso de archivado', rows }),
    replyTo: env.ADMIN_EMAIL,
  });
}

// ─── Templates: admin ───────────────────────────────────────────

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
  const adminUrl = (env.PUBLIC_SITE_URL ?? '').replace(/\/$/, '') + '/admin';

  const items: Array<{ label: string; value: string }> = [];
  items.push({ label: 'Email', value: `<a href="mailto:${args.email}" style="color:${C.text};text-decoration:underline;">${escapeHtml(args.email)}</a>` });
  if (args.telefono) items.push({ label: 'Teléfono', value: escapeHtml(args.telefono) });
  if (args.handleIg) items.push({ label: 'Instagram', value: escapeHtml(args.handleIg) });
  if (args.paqueteNombre) items.push({ label: 'Paquete', value: escapeHtml(args.paqueteNombre) });
  if (args.fechaPreferida) items.push({ label: 'Fecha pref.', value: escapeHtml(args.fechaPreferida) });
  if (args.origen) items.push({ label: 'Origen', value: escapeHtml(args.origen) });

  const notasBlock = args.notas
    ? paragraphRow(`<span style="display:inline-block;padding:12px 14px;background:${C.bgRowSoft};border:1px solid ${C.border};border-radius:8px;color:${C.textDim};font-style:italic;">${escapeHtml(args.notas)}</span>`, { size: 'sm', topPad: 14 })
    : '';

  const rows = [
    header(),
    dividerRow(),
    eyebrowRow('Nuevo lead · /agendar'),
    h1Row(args.nombre),
    paragraphRow(`<strong>${escapeHtml(args.nombre)}</strong> envió una solicitud por el formulario público.`),
    infoBlockRow(items),
    notasBlock,
    adminUrl ? buttonRow(adminUrl, 'Convertir lead →') : '',
    spacerRow(20),
    footerRow(),
  ].join('');

  sendMailBackground(env, {
    to: env.ADMIN_EMAIL,
    subject: `Nuevo lead · ${args.nombre}`,
    html: shell({ title: 'Nuevo lead', rows }),
    replyTo: args.email,
  });
}

export function notifyAdminConfirmacion(
  env: Env,
  args: { codigo: string; nombre: string; seleccionadas: number; extras: number; monto: number },
): void {
  if (!env.ADMIN_EMAIL) return;
  const conExtras = args.extras > 0;
  const subject = conExtras
    ? `${args.codigo} confirmó · ${args.extras} extras · $${args.monto} MXN`
    : `${args.codigo} confirmó · sin extras`;

  const items: Array<{ label: string; value: string }> = [
    { label: 'Cliente', value: escapeHtml(args.nombre) },
    { label: 'Código', value: `<span style="font-family:${FONT_MONO};letter-spacing:0.12em;">${escapeHtml(args.codigo)}</span>` },
    { label: 'Seleccionadas', value: String(args.seleccionadas) },
  ];
  if (conExtras) {
    items.push({ label: 'Fotos extra', value: String(args.extras) });
    items.push({ label: 'A cobrar', value: `<strong>$${args.monto} MXN</strong>` });
  }

  const accion = conExtras
    ? 'Marca la sesión como <strong>Editando</strong> cuando recibas el pago de extras.'
    : 'Sin extras. Pasa a <strong>Editando</strong> cuando empieces a editar.';

  const rows = [
    header(),
    dividerRow(),
    eyebrowRow('Selección confirmada'),
    h1Row(`${args.codigo} · ${args.nombre}`),
    paragraphRow(`<strong>${escapeHtml(args.nombre)}</strong> confirmó su selección de <strong>${args.seleccionadas}</strong> foto${args.seleccionadas !== 1 ? 's' : ''}.`),
    infoBlockRow(items),
    paragraphRow(accion, { topPad: 18 }),
    spacerRow(20),
    footerRow(),
  ].join('');

  sendMailBackground(env, {
    to: env.ADMIN_EMAIL,
    subject,
    html: shell({ title: 'Selección confirmada', rows }),
  });
}
