// MatchDeal QR pairing v2 — the PWA's own consume path. Same validation
// as supabase/functions/matchdeal-qr-pair, but for a browser session
// already signed in on this domain family (cookie auth), not a native
// app with a Bearer token. See consumePairingToken() in
// matchdeal-pairing.ts for why this isn't literally shared code with the
// Edge Function (different runtimes).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { consumePairingToken, resolveOwnMatchdealProfileId } from '@/lib/matchdeal-pairing';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { token, deviceId } = await req.json().catch(() => ({})) as { token?: string; deviceId?: string };
  if (!token || !deviceId) return NextResponse.json({ ok: false, error: 'token and deviceId are required.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const result = await consumePairingToken(admin, sb, token, user.id, deviceId);
  if (!result.ok) {
    const messages: Record<string, string> = {
      MATCHDEAL_TOKEN_INVALID: 'This code is no longer valid — generate a new one.',
      MATCHDEAL_TOKEN_EXPIRED: 'This code has expired — generate a new one.',
      MATCHDEAL_WRONG_ACCOUNT: 'This code belongs to a different account. Sign in with the same account you used on sherlockdeal.com.',
      MATCHDEAL_SERVER_ERROR: 'Something went wrong — try again.',
    };
    return NextResponse.json({ ok: false, error: messages[result.error] }, { status: 410 });
  }

  const ownProfileId = await resolveOwnMatchdealProfileId(admin, user.id, result.kind);
  return NextResponse.json({ ok: true, pairingId: result.pairingId, pairedAt: result.pairedAt, kind: result.kind, ownProfileId });
}
