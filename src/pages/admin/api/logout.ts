export const prerender = false;

import type { APIRoute } from 'astro';
import { clearAuthCookies } from '../../../lib/admin-auth';

export const POST: APIRoute = async () => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const c of clearAuthCookies()) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
