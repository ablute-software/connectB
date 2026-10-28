// Prompt 923 (A) — the router after every sign-in. The login pages used to send "Investor" straight to /portal and "Startup" to /pipeline whatever the person was; now they send everybody here and the server decides, with
// ONE rule (src/lib/areas.ts): what the person chose on the login page, otherwise the area they used last, otherwise the first area they have. An account with no area goes where it always went (a pending claim, a pending
// invitation, the public page). Not a public route: without a session the middleware sends the person to /login first, and this comes back after it.
import { NextResponse, type NextRequest } from 'next/server';
import { LAST_AREA_COOKIE, parseArea, parseIntent } from '@/lib/areas';
import { resolveAreaDestination } from '@/lib/areas-server';
import { authEnabled, serverClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const intent = parseIntent(searchParams.get('as'));
  if (!authEnabled) return NextResponse.redirect(`${origin}/pipeline`);
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    // Signed out (an expired or pre-fetched link brings people here with linkFailed=1): back to the sign-in form, on the investor side when that is where they came from, still offering the code.
    const back = new URLSearchParams();
    if (intent === 'investor') back.set('as', 'investor');
    if (searchParams.get('linkFailed') === '1') back.set('linkFailed', '1');
    return NextResponse.redirect(`${origin}/login${back.toString() ? `?${back}` : ''}`);
  }
  const last = parseArea(req.cookies.get(LAST_AREA_COOKIE)?.value);
  const dest = await resolveAreaDestination(user, sb, { intent, last });
  return NextResponse.redirect(`${origin}${dest.path ?? '/'}`);
}
