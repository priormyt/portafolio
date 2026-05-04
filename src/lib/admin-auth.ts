import type { Env } from './sesiones';

type AdminEnv = Env & {
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
};

const COOKIE_NAME = 'ante_admin';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

/**
 * Devuelve { ok: true } si la cookie de admin es válida y no expiró.
 */
export async function requireAdmin(
  env: AdminEnv,
  request: Request,
): Promise<{ ok: true } | { ok: false }> {
  if (!env.ADMIN_SESSION_SECRET) return { ok: false };

  const cookies = parseCookies(request.headers.get('cookie') ?? '');
  const cookie = cookies[COOKIE_NAME];
  if (!cookie) return { ok: false };

  const valid = await verifySession(env.ADMIN_SESSION_SECRET, cookie, SESSION_MAX_AGE_MS);
  return valid ? { ok: true } : { ok: false };
}

export async function verifyPassword(env: AdminEnv, attempt: string): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false;
  return timingSafeEq(env.ADMIN_PASSWORD, attempt);
}

export async function makeSessionCookie(env: AdminEnv): Promise<string> {
  if (!env.ADMIN_SESSION_SECRET) throw new Error('Missing ADMIN_SESSION_SECRET');
  const ts = Date.now();
  const payload = String(ts);
  const sig = await hmacHex(env.ADMIN_SESSION_SECRET, payload);
  const value = `${payload}.${sig}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function verifySession(
  secret: string,
  cookie: string,
  maxAgeMs: number,
): Promise<boolean> {
  const idx = cookie.lastIndexOf('.');
  if (idx === -1) return false;
  const payload = cookie.slice(0, idx);
  const sig = cookie.slice(idx + 1);
  const expected = await hmacHex(secret, payload);
  if (!timingSafeEq(sig, expected)) return false;
  const ts = parseInt(payload, 10);
  if (isNaN(ts)) return false;
  if (Date.now() - ts > maxAgeMs) return false;
  return true;
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

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}
