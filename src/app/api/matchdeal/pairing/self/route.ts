// Prompt 75 — "Open MatchDeal on this device": the founder/investor's own
// browser is already signed in, so viewing the deck here doesn't need a
// QR/token pairing cycle at all — that flow exists for a DIFFERENT device
// to join. This route resolves the caller's own MatchDeal profile
// directly from their session, the same way resolveOwnMatchdealProfileId
// already does for a freshly-consumed token, just without consuming one.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveOwnMatchdealProfileId, touchLastSeenIfStale, startupDeckLimit, DEVICE_ID_COOKIE, DEVICE_ID_COOKIE_MAX_AGE } from '@/lib/matchdeal-pairing';
import { shareableCookieDomain } from '@/lib/supabase';

export async function GET(req: NextRequest) {
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
  const queryDeviceId = new URL(req.url).searchParams.get('deviceId');
  // Prompt 114 Fase 4.1 — the cookie is the resilient copy of device_id
  // (survives a localStorage clear); prefer it when both are present.
  const cookieDeviceId = req.cookies.get(DEVICE_ID_COOKIE)?.value ?? null;
  const effectiveDeviceId = cookieDeviceId ?? queryDeviceId;

  type MatchedPairing = { id: string; kind: 'startup' | 'investor'; last_seen_at: string | null };
  let preferredKind: 'startup' | 'investor' | null = null;
  let matchedPairing: MatchedPairing | null = null;

  if (effectiveDeviceId) {
    const { data: pairing } = await admin.from('matchdeal_pairings').select('id, kind, last_seen_at')
      .eq('user_id', user.id).eq('device_id', effectiveDeviceId).eq('status', 'active')
      .order('last_seen_at', { ascending: false }).limit(1).maybeSingle();
    if (pairing) matchedPairing = pairing as MatchedPairing;
  }

  // Prompt 114 Fase 4.2 — reconciliation, not a block. Neither cookie nor
  // localStorage's device_id matched an active pairing (both lost — Safari
  // ITP cleared the cookie AND the person cleared site data, or a fresh
  // browser profile). Reaching this route at all required a valid session,
  // which in the new design can only exist after a real token consume — so
  // silently adopting the one unambiguous active pairing is not a new hole,
  // it's recognizing a device that legitimately paired under a device_id it
  // can no longer produce. Ambiguous (0 or 2+ active rows) is left alone.
  if (!matchedPairing && queryDeviceId) {
    const { data: activeRows } = await admin.from('matchdeal_pairings')
      .select('id, kind, last_seen_at').eq('user_id', user.id).eq('status', 'active');
    if (activeRows && activeRows.length === 1) {
      const row = activeRows[0] as { id: string; kind: 'startup' | 'investor'; last_seen_at: string | null };
      await admin.from('matchdeal_pairings')
        .update({ device_id: queryDeviceId, last_seen_at: new Date().toISOString() }).eq('id', row.id);
      matchedPairing = { ...row, last_seen_at: new Date().toISOString() };
    }
  }

  preferredKind = matchedPairing?.kind ?? null;
  const order: ('startup' | 'investor')[] = preferredKind === 'investor' ? ['investor', 'startup'] : ['startup', 'investor'];

  for (const kind of order) {
    const profileId = await resolveOwnMatchdealProfileId(admin, user.id, kind);
    if (profileId) {
      // Fase 4.3 — throttled last_seen_at write, only for the pairing row
      // that actually resolved this kind (not the profile-existence
      // fallback below, which has nothing to do with pairing liveness).
      if (matchedPairing && matchedPairing.kind === kind) {
        await touchLastSeenIfStale(admin, matchedPairing.id, matchedPairing.last_seen_at);
      }
      const deckLimit = kind === 'startup' ? await startupDeckLimit(admin, profileId) : undefined;
      const response = NextResponse.json({ ok: true, kind, ownProfileId: profileId, deckLimit });
      // Reconcile the cookie itself if it was the one missing.
      if (!cookieDeviceId && queryDeviceId) {
        const domain = shareableCookieDomain(req.headers.get('host'));
        response.cookies.set(DEVICE_ID_COOKIE, queryDeviceId, {
          httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: DEVICE_ID_COOKIE_MAX_AGE,
          ...(domain ? { domain } : {}),
        });
      }
      return response;
    }
  }

  return NextResponse.json({ ok: true, kind: null, ownProfileId: null });
}
