// Investor Workspace Fase 3 (prompt 56), Bloco 2 — the investor's feed of
// round updates for an org they have active access to. Same access check
// as /api/portal/questions.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

async function hasActiveGrant(admin: SupabaseClient, orgId: string, email: string, personId: string | null) {
  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (personId) orParts.push(`person_id.eq.${personId}`);
  const { data: grants } = await admin.from('access_grants').select('confirmed_at, invited_email, revoked_at, expires_at')
    .eq('org_id', orgId).is('revoked_at', null).or(orParts.join(','));
  const now = new Date();
  return (grants ?? []).some((g) => (!g.expires_at || new Date(g.expires_at as string) > now) && (!g.invited_email || g.confirmed_at));
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('org_id');
  if (!orgId) return NextResponse.json({ error: 'org_id is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  if (!(await hasActiveGrant(admin, orgId, email, person?.id ?? null))) {
    return NextResponse.json({ error: 'No active access to this org.' }, { status: 403 });
  }

  const { data: updates } = await admin.from('round_updates').select('id, title, body, created_at')
    .eq('org_id', orgId).order('created_at', { ascending: false });
  return NextResponse.json({ updates: updates ?? [] });
}
