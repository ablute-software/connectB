// Prompt 75 — "Open MatchDeal on this device": the founder/investor's own
// browser is already signed in, so viewing the deck here doesn't need a
// QR/token pairing cycle at all — that flow exists for a DIFFERENT device
// to join. This route resolves the caller's own MatchDeal profile
// directly from their session, the same way resolveOwnMatchdealProfileId
// already does for a freshly-consumed token, just without consuming one.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveOwnMatchdealProfileId } from '@/lib/matchdeal-pairing';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // A dual-role account (founder AND investor, like the @ablute.pt QA
  // account) could have both — try startup first, same precedence the
  // rest of the app uses when a role must be picked (resolveRole).
  const startupProfileId = await resolveOwnMatchdealProfileId(admin, user.id, 'startup');
  if (startupProfileId) return NextResponse.json({ ok: true, kind: 'startup', ownProfileId: startupProfileId });

  const investorProfileId = await resolveOwnMatchdealProfileId(admin, user.id, 'investor');
  if (investorProfileId) return NextResponse.json({ ok: true, kind: 'investor', ownProfileId: investorProfileId });

  return NextResponse.json({ ok: true, kind: null, ownProfileId: null });
}
