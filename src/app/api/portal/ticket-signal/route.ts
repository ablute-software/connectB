// Investor Workspace Fase 1 (prompt 54) — Zona 2 ticket selector. Append-only:
// every call INSERTs a new investor_ticket_signals row, never UPDATEs — the
// founder wants the evolution over time, not just the latest value (see
// migration 0055's own header comment). Same trust boundary as every other
// portal write route (/api/portal/view, /api/portal/confirm-identity):
// the email comes ONLY from the caller's own verified session, never from
// the request body.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({}));
  const { org_id, range_min_eur, range_max_eur, range_label } = body as {
    org_id?: string; range_min_eur?: number | null; range_max_eur?: number | null; range_label?: string;
  };
  if (!org_id || !range_label) return NextResponse.json({ ok: false, error: 'org_id and range_label are required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Prompt 54 Bloco 0/2 — @ablute.pt QA sessions can use the selector to
  // test the UI, but the signal must never reach the founder or count in
  // any metric. Same principle, same is_ablute_developer() check as
  // /api/portal/view — checked here, at the write, not trusted to the
  // client to simply not call this endpoint.
  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  // Confirm this session actually has active access to this org before
  // writing anything — an investor can only signal a ticket for a startup
  // whose data room they can actually see, not an arbitrary org_id.
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: grants } = await admin.from('access_grants').select('org_id, confirmed_at, invited_email, revoked_at, expires_at')
    .eq('org_id', org_id).is('revoked_at', null).or(orParts.join(','));
  const now = new Date();
  const hasActiveGrant = (grants ?? []).some((g) =>
    (!g.expires_at || new Date(g.expires_at as string) > now) && (!g.invited_email || g.confirmed_at));
  if (!hasActiveGrant) return NextResponse.json({ ok: false, error: 'No active access to this org.' }, { status: 403 });

  const { error } = await admin.from('investor_ticket_signals').insert({
    org_id, person_id: person?.id ?? null, investor_email: email,
    range_min_eur: range_min_eur ?? null, range_max_eur: range_max_eur ?? null, range_label,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
