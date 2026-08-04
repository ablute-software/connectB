// MatchDeal QR pairing v2 — the PWA's own consume path. No session check
// here at all (Prompt 114 Fase 1): the token itself is the authorization —
// its own row already carries which user/org/kind generated it, exactly
// the way a magic link works. This route hands the phone a real session
// for that user in the response; the client hydrates it with setSession()
// before doing anything else. Same validation order as
// supabase/functions/matchdeal-qr-pair otherwise — see consumePairingToken()
// in matchdeal-pairing.ts for why this isn't literally shared code with the
// Edge Function (different runtimes).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { consumePairingToken, resolveOwnMatchdealProfileId, startupDeckLimit, DEVICE_ID_COOKIE, DEVICE_ID_COOKIE_MAX_AGE } from '@/lib/matchdeal-pairing';
import { shareableCookieDomain } from '@/lib/supabase';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const { token, deviceId } = await req.json().catch(() => ({})) as { token?: string; deviceId?: string };
  if (!token || !deviceId) return NextResponse.json({ ok: false, error: 'token and deviceId are required.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const result = await consumePairingToken(admin, token, deviceId);
  if (!result.ok) {
    const messages: Record<string, string> = {
      MATCHDEAL_TOKEN_INVALID: 'This code is no longer valid — generate a new one.',
      MATCHDEAL_TOKEN_EXPIRED: 'This code has expired — generate a new one.',
      MATCHDEAL_SERVER_ERROR: 'Something went wrong — try again.',
    };
    return NextResponse.json({ ok: false, error: messages[result.error] }, { status: 410 });
  }

  const ownProfileId = await resolveOwnMatchdealProfileId(admin, result.userId, result.kind);
  const deckLimit = result.kind === 'startup' && ownProfileId ? await startupDeckLimit(admin, ownProfileId) : undefined;
  const response = NextResponse.json({
    ok: true, pairingId: result.pairingId, pairedAt: result.pairedAt, kind: result.kind, ownProfileId,
    deckLimit, session: result.session,
  });

  // Prompt 114 Fase 4.1 — device_id's resilient copy, set once here. Scoped
  // to the real sherlockdeal.com family only (a Domain attribute that
  // doesn't match the actual host is silently rejected by the browser, so
  // this omits Domain entirely on localhost/preview rather than breaking
  // there — same guard shareableCookieDomain's own callers already rely on).
  const domain = shareableCookieDomain(req.headers.get('host'));
  response.cookies.set(DEVICE_ID_COOKIE, deviceId, {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: DEVICE_ID_COOKIE_MAX_AGE,
    ...(domain ? { domain } : {}),
  });
  return response;
}
