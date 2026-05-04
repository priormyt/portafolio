import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { Env } from './sesiones';

/**
 * Verifica que la cookie 'sb-access-token' corresponda a un usuario válido
 * Y que el email de ese usuario esté en la tabla admin_users.
 *
 * Devuelve { ok: true, email } o { ok: false, redirect: '/admin/login' }.
 */
export async function requireAdmin(
  env: Env,
  request: Request,
): Promise<{ ok: true; email: string } | { ok: false }> {
  if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY) return { ok: false };

  const cookies = parseCookies(request.headers.get('cookie') ?? '');
  const accessToken = cookies['sb-access-token'];
  if (!accessToken) return { ok: false };

  const sb = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: userRes, error } = await sb.auth.getUser(accessToken);
  if (error || !userRes?.user?.email) return { ok: false };

  const email = userRes.user.email;

  // Validar contra admin_users con service role
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false };
  const sbAdmin = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: admin } = await sbAdmin
    .from('admin_users')
    .select('email')
    .eq('email', email)
    .maybeSingle();

  if (!admin) return { ok: false };

  return { ok: true, email };
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

export function setAuthCookies(accessToken: string, refreshToken: string): string[] {
  const opts = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
  return [
    `sb-access-token=${encodeURIComponent(accessToken)}; ${opts}`,
    `sb-refresh-token=${encodeURIComponent(refreshToken)}; ${opts}`,
  ];
}

export function clearAuthCookies(): string[] {
  const opts = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  return [`sb-access-token=; ${opts}`, `sb-refresh-token=; ${opts}`];
}
