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

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Prompt 84 addenda (2026-07-31) — a dual-role account (founder AND
  // investor, like nunomarujo@ablute.pt) has a real profile on BOTH sides,
  // and this route used to always try 'startup' first regardless of which
  // one the caller actually paired as — the PWA's manifest.json start_url
  // is a static "/pair" with no token, so every re-open of the installed
  // icon hit this exact branch. Confirmed live: that account paired via QR
  // as kind='investor', but reopening the icon silently handed them back
  // their (incomplete, invisible) startup profile instead — never showing
  // "isn't set up yet" for the reason they'd assume (it wasn't reading
  // is_complete at all, on either kind), but silently the WRONG kind.
  // deviceId (already computed client-side for the token-consume path) is
  // the actual signal for "which did this device pair as" — matchdeal_pairings
  // has the answer, so prefer that kind when we have it, before falling
  // back to the old startup-first default for a device with no pairing on
  // record at all (e.g. first-ever self-check).
  const deviceId = new URL(req.url).searchParams.get('deviceId');
  let preferredKind: 'startup' | 'investor' | null = null;
  if (deviceId) {
    const { data: pairing } = await admin.from('matchdeal_pairings').select('kind')
      .eq('user_id', user.id).eq('device_id', deviceId).eq('status', 'active')
      .order('last_seen_at', { ascending: false }).limit(1).maybeSingle();
    preferredKind = (pairing?.kind as 'startup' | 'investor' | undefined) ?? null;
  }
  const order: ('startup' | 'investor')[] = preferredKind === 'investor' ? ['investor', 'startup'] : ['startup', 'investor'];

  for (const kind of order) {
    const profileId = await resolveOwnMatchdealProfileId(admin, user.id, kind);
    if (profileId) return NextResponse.json({ ok: true, kind, ownProfileId: profileId });
  }

  return NextResponse.json({ ok: true, kind: null, ownProfileId: null });
}
