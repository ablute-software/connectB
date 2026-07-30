// Investor Workspace Fase 3 (prompt 56), Bloco 1 — investor-side Q&A.
// Same access-check shape as /api/portal/ticket-signal: confirm this
// session actually has active access to the org before reading/writing
// anything, and the email comes only from the verified session, never the
// request body. Same @ablute.pt QA no-write guard as every other portal
// write route.
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
  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (!isAbluteQa && !(await hasActiveGrant(admin, orgId, email, person?.id ?? null))) {
    return NextResponse.json({ error: 'No active access to this org.' }, { status: 403 });
  }

  // Own questions (any status) + every FAQ, regardless of who asked it —
  // half of what an investor would ask has already been answered for
  // someone else.
  const { data: rows } = await admin.from('portal_questions').select('id, question, answer, answered_at, is_faq, created_at, asked_by_email')
    .eq('org_id', orgId).or(`asked_by_email.eq.${email},is_faq.eq.true`).order('created_at', { ascending: false });

  return NextResponse.json({ questions: rows ?? [] });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { org_id?: string; question?: string };
  const { org_id, question } = body;
  if (!org_id || !question?.trim()) return NextResponse.json({ ok: false, error: 'org_id and question are required.' }, { status: 400 });

  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  if (!(await hasActiveGrant(admin, org_id, email, person?.id ?? null))) {
    return NextResponse.json({ ok: false, error: 'No active access to this org.' }, { status: 403 });
  }

  const { error } = await admin.from('portal_questions').insert({ org_id, asked_by_email: email, question: question.trim() });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
