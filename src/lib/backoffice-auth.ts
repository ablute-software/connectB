// BLOCO 3 — shared platform-admin gate for /api/backoffice/* routes.
// Defense in depth: middleware.ts already blocks non-admins from ever
// reaching these routes, but every route re-checks independently too, per
// "nunca só UI" — never trust a single layer for an admin boundary.
import 'server-only';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from './supabase-server';

export interface BackofficeAuth {
  admin: SupabaseClient;
  userId: string;
}

export async function requirePlatformAdmin(): Promise<BackofficeAuth | { error: NextResponse }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return { error: NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 }) };

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };

  const role = await resolveRole(user.id, user.email, sb);
  if (role !== 'developer') return { error: NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 }) };

  return { admin: createClient(url, service, { auth: { persistSession: false } }), userId: user.id };
}
