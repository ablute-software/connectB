// IRM_SPEC §8d — kick off Gmail OAuth. Not env-configured yet: redirect
// back to settings with a message instead of erroring, so a stray link
// click degrades gracefully rather than 500ing.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { serverClient } from '@/lib/supabase-server';
import { googleOAuthConfigured, getAuthUrl } from '@/lib/google-oauth';

export async function GET(req: NextRequest) {
  const { origin } = new URL(req.url);
  if (!googleOAuthConfigured()) {
    return NextResponse.redirect(`${origin}/settings?gmail=not_configured`);
  }
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login?next=/settings`);

  // No separate state store: this is a same-browser redirect round-trip, so
  // the session cookie is what actually identifies the user at the callback.
  // `state` here is just a CSRF nonce Google echoes back, not a lookup key.
  const state = randomUUID();
  const res = NextResponse.redirect(getAuthUrl(origin, state));
  res.cookies.set('gmail_oauth_state', state, { httpOnly: true, secure: true, maxAge: 600, path: '/' });
  return res;
}
