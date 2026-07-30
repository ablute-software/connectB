// MatchDeal QR pairing — web-side disconnect (spec Section 7.3). Revokes
// the app's access immediately; does not touch the MatchDeal profile,
// swipes, or match history.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { logEvent } from '@/lib/analytics-events';
import { resolveCallerOrgId, type PairingKind } from '@/lib/matchdeal-pairing';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { pairingId, kind } = await req.json().catch(() => ({})) as { pairingId?: string; kind?: PairingKind };
  if (!pairingId || (kind !== 'startup' && kind !== 'investor')) {
    return NextResponse.json({ ok: false, error: 'pairingId and kind are required.' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const orgId = await resolveCallerOrgId(sb, admin, user.id, kind);
  if (!orgId) return NextResponse.json({ ok: false, error: 'No linked organization for this account.' }, { status: 403 });

  // org_id in the WHERE is the actual authorization check — a pairing row
  // that doesn't belong to the caller's own org is simply not matched,
  // not fetched-then-checked.
  const { data: updated, error } = await admin.from('matchdeal_pairings')
    .update({ status: 'disconnected', disconnected_at: new Date().toISOString() })
    .eq('id', pairingId).eq('org_id', orgId).eq('kind', kind).eq('status', 'active')
    .select('id').maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ ok: false, error: 'Pairing not found.' }, { status: 404 });

  await logEvent(admin, { organizationId: orgId, organizationType: kind, eventType: 'matchdeal_disconnected', sourceOfAction: 'manual' });
  return NextResponse.json({ ok: true });
}
