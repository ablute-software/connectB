// Prompt 350 §B — "Considering: Leading/Following/Both" and "Type of
// investment" (multi-select instruments), next to the ticket-range signal.
// Same shape and same trust boundary as /api/portal/ticket-signal: append-
// only insert, email comes only from the caller's own verified session,
// active-grant check before any write.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { isValidConsidering, sanitizeInstruments } from '@/lib/investor-deal-signal';

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
  const { org_id, considering, instruments } = body as { org_id?: string; considering?: string | null; instruments?: string[] };
  if (!org_id) return NextResponse.json({ ok: false, error: 'org_id is required.' }, { status: 400 });
  if (considering != null && !isValidConsidering(considering)) {
    return NextResponse.json({ ok: false, error: 'Invalid considering value.' }, { status: 400 });
  }
  const cleanInstruments = sanitizeInstruments(instruments);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: grants } = await admin.from('access_grants').select('org_id, confirmed_at, invited_email, revoked_at, expires_at')
    .eq('org_id', org_id).is('revoked_at', null).or(orParts.join(','));
  const now = new Date();
  const hasActiveGrant = (grants ?? []).some((g) =>
    (!g.expires_at || new Date(g.expires_at as string) > now) && (!g.invited_email || g.confirmed_at));
  if (!hasActiveGrant) return NextResponse.json({ ok: false, error: 'No active access to this org.' }, { status: 403 });

  const { error } = await admin.from('investor_deal_signals').insert({
    org_id, person_id: person?.id ?? null, investor_email: email,
    considering: considering ?? null, instruments: cleanInstruments,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
