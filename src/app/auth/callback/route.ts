// OAuth / magic-link callback: exchange the code for a session cookie.
//
// Prompt 50 — the exchange's result used to be discarded entirely: on
// failure this redirected to `next` exactly as if it had succeeded, landing
// an unauthenticated user back on a blank sign-in form with zero indication
// anything went wrong ("loop back to the start"). Failure is the expected
// outcome, not an edge case, whenever the link is opened in a different
// browser/device than the one that called signInWithOtp — the PKCE
// code_verifier lives in a cookie scoped to that specific browser, so
// clicking a link from a phone's mail app after requesting it on a laptop
// (or an email client's link-scanner pre-fetching the link before the human
// clicks) fails here by design, not by bug. What WAS a bug: giving the user
// no way out except retyping their email from scratch, when the 6-digit
// code (verified through a completely different, device-independent path)
// still works. On failure this now redirects to `next` with `linkFailed=1`
// so the destination page can fall back straight to the code field instead.
//
// Prompt 72 — that fix only covered "code present but exchange fails". The
// more realistic failure mode reaches this route with NO code at all:
// Supabase's own /auth/v1/verify validates the token before ever handing
// control to the app, and on an expired/already-consumed link it redirects
// here with `error`/`error_description` params instead of a `code` (or, in
// some configurations, no params at all) — never entering the old
// `if (code && authEnabled)` block, and falling straight through to a
// silent, "successful-looking" redirect. Confirmed live: `code=` (empty)
// and no `code` param both landed on a bare `next` with no `linkFailed`.
// Now any request that reaches this route without a code it can actually
// exchange is treated as a failure, whether Supabase told us why or not.
import { NextResponse, type NextRequest } from 'next/server';
import { serverClient, authEnabled } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const supabaseError = searchParams.get('error') || searchParams.get('error_description');
  const next = searchParams.get('next') ?? '/pipeline';

  function failed() {
    const url = new URL(next, origin);
    url.searchParams.set('linkFailed', '1');
    return NextResponse.redirect(url);
  }

  if (!authEnabled) return NextResponse.redirect(`${origin}${next}`);

  // No usable code at all — either Supabase told us why (error param) or
  // just never issued one. There's no legitimate reason to land on this
  // route without a code to exchange, so treat both the same way.
  if (!code || supabaseError) return failed();

  const sb = await serverClient();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) return failed();

  return NextResponse.redirect(`${origin}${next}`);
}
