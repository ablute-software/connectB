// Auth gate. If Supabase env is configured, unauthenticated users are sent to /login.
// Public routes: '/' and '/investors' (the marketing landing, Startup and
// Investor sides of the toggle), /login, /signup, /auth/*, /portal (investor
// magic-link area), static assets.
//
// Note on '/': the entry `'/'` matches only the root (isPublicPath in src/lib/route-zones.ts) — so
// adding it does NOT open up the rest of the app. (Until Prompt 933 it was read as a prefix like the others, `startsWith('//')`, which
// a path beginning with a doubled slash satisfies. Next redirects such a path (308) before the middleware runs, so it was not reachable; the rule no longer depends on that.)
//
// Prompt 933: the login redirect is for paths that are behind a session. A path nothing in the app answers (a mistyped address, a stale link, /api/isto-nao-existe) is not: a page path
// goes on to Next's 404, an /api path is answered 404 as JSON here. What is public, protected or unknown is decided by src/lib/route-zones.ts.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { shareableCookieDomain } from '@/lib/supabase';
import { VIEWER_ORG_COOKIE, VIEWER_READ_ONLY_CODE, VIEWER_READ_ONLY_MESSAGE } from '@/lib/developer-viewer-shape';
import { viewerWriteVerdict } from '@/lib/viewer-write-gate';
import { isLiveFounderOrg } from '@/lib/founder-hat';
import { isApiPath, isPublicPath, isUnknownPath } from '@/lib/route-zones';
import { isCronTickRequest } from '@/lib/cron-auth';

// Prompt 933 (06/11/2026) — the public list, with the reason behind every entry, moved to src/lib/route-zones.ts, next to the two lists that say which paths are behind a session
// (PROTECTED_PAGE_ZONES, API_ZONES) and the test that keeps them equal to the folders of src/app. The middleware reads it from there.

// Where a signed-in user belongs. '/' is the public landing now, so the app
// home is the pipeline.
const APP_HOME = '/pipeline';

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Demo mode (no backend) — let everything through.
  if (!url || !anon) return NextResponse.next();

  const { pathname } = req.nextUrl;
  // 22/10/2026 — the platform's own cron. vercel.json calls GET /api/automations once a day and a cron call has no session, so for as long as this gate sent it to /login (307) the
  // daily job never ran on its own: it ran only when somebody opened the route by hand with a session (see cron-auth.ts for the evidence). The path is NOT made public — anyone could
  // then run the tick — it lets through exactly one request: that path, carrying `Authorization: Bearer <CRON_SECRET>`, which Vercel adds to every cron call when the project has the
  // variable. Without the variable (or with a short one) nothing is let through: the gate below is exactly what it was.
  if (isCronTickRequest(pathname, req.headers.get('authorization'), process.env.CRON_SECRET)) return NextResponse.next();
  const isPublic = isPublicPath(pathname);
  // Prompt 933 — a path nothing in the app answers (src/lib/route-zones.ts) is not a reason to ask for a session. Until 06/11/2026 every path that was not on the public list went to /login, so a mistyped
  // address, a stale link or a bot's probe ended on the sign-in screen and a visitor with no session could never reach a 404. An unknown /api path is answered here, as JSON, session or not: no route could
  // answer it, and the redirect used to hand a program a whole HTML page. An unknown page path goes on to Next, which answers 404 with src/app/not-found.tsx. Everything behind a session is as it was.
  const unknown = isUnknownPath(pathname);
  if (unknown && isApiPath(pathname)) {
    return NextResponse.json({ ok: false, error: 'not_found', message: 'There is no such API route.' }, { status: 404 });
  }

  let res = NextResponse.next({ request: req });
  const cookieDomain = shareableCookieDomain(req.headers.get('host'));
  const supabase = createServerClient(url, anon, {
    cookieOptions: cookieDomain ? { domain: cookieDomain } : undefined,
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  // Prompt 123 Block C.2 / 244/245 — server-side login gate for suspended/
  // deleted accounts (migration 0121) AND blocked emails (migration 0180),
  // in one round-trip via account_access_state() (replaces the old
  // is_account_suspended()-only RPC call — that function still exists and
  // still works, account_access_state() just wraps it). A missing-function
  // error is treated as "active" (fail open) so this never breaks sign-in
  // if migrations somehow lag behind deploy — same capability-gated-degrade
  // convention as every other migration-gated feature, just without the
  // usual server-only probe module since middleware can't import
  // 'server-only' code.
  // Prompt 602 §C — a fourth state, 'closed' (the owner closed the account;
  // migration 0338), with its own page: "closed by its owner, kept until".
  if (user && pathname !== '/suspended' && pathname !== '/blocked' && pathname !== '/closed' && !pathname.startsWith('/api/')) {
    const { data: state } = await supabase.rpc('account_access_state');
    if (state === 'blocked' || state === 'suspended' || state === 'closed') {
      const redirect = req.nextUrl.clone();
      redirect.pathname = state === 'blocked' ? '/blocked' : state === 'closed' ? '/closed' : '/suspended';
      redirect.search = '';
      return NextResponse.redirect(redirect);
    }
  }

  if (!user && !isPublic && !unknown) {
    const redirect = req.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('next', pathname);
    return NextResponse.redirect(redirect);
  }
  // Prompt 904 — Developer Viewer is READ-ONLY for the whole API, by default. Every founder route refuses a
  // write in a viewer session through withActingOrg()/withoutViewer() (src/lib/acting-org.ts, enforced by
  // acting-org-guard.test.ts); this is the independent net under them, so a write route that was never
  // wrapped is still refused. Only a request that carries the viewer cookie AND really comes from a
  // developer is touched (the cookie is unsigned; is_ablute_developer() is the check that matters), and what
  // may still write is the short list in viewer-write-gate.ts. Beacons are acknowledged and dropped.
  if (user && pathname.startsWith('/api/') && req.cookies.has(VIEWER_ORG_COOKIE)) {
    const verdict = viewerWriteVerdict(req.method, pathname);
    if (verdict !== 'pass') {
      const { data: isDeveloper } = await supabase.rpc('is_ablute_developer');
      if (isDeveloper === true) {
        return verdict === 'ignore'
          ? NextResponse.json({ ok: true, ignored: 'viewer' })
          : NextResponse.json({ ok: false, error: VIEWER_READ_ONLY_CODE, message: VIEWER_READ_ONLY_MESSAGE }, { status: 403 });
      }
    }
  }
  if (user && (pathname === '/login' || pathname === '/signup')) {
    // Prompt 923 (A) — a signed-in visitor on /login or /signup goes through /go, the one router that knows every area the person has (src/lib/areas.ts). It used to decide here with a lighter copy of the rule
    // (Prompt 680/682), which sent every founder to /pipeline and every other account to /portal whatever else they were — the same fixed destinations that put a firm member on an empty data-room page.
    const home = req.nextUrl.clone();
    home.pathname = '/go';
    home.search = req.nextUrl.searchParams.get('as') === 'investor' ? '?as=investor' : '';
    return NextResponse.redirect(home);
  }

  // BLOCO 3 — /backoffice and /api/backoffice are platform-admin only.
  // Checked here (not just in each route/UI) so a founder who isn't a
  // platform admin gets stopped before ever reaching the console, no
  // matter which page or API they try. Every /api/backoffice route also
  // re-checks independently (requirePlatformAdmin()) — defense in depth,
  // never a single layer for this boundary.
  //
  // Prompt 122 Block A — /metrics joined this gate when it was promoted out
  // of /backoffice into the founder Shell's own sidebar: it still calls
  // /api/backoffice/metrics/* underneath (already gated), but the PAGE
  // itself moved outside the /backoffice prefix, so without this it would
  // be reachable (just showing failed API calls) by any signed-in founder.
  if (pathname === '/backoffice' || pathname.startsWith('/backoffice/') || pathname.startsWith('/api/backoffice')
    || pathname === '/metrics' || pathname.startsWith('/metrics/')) {
    const admin = user ? (await supabase.from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle()).data : null;
    if (!admin) {
      if (pathname.startsWith('/api/')) return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });
      const home = req.nextUrl.clone();
      home.pathname = APP_HOME;
      home.search = '';
      return NextResponse.redirect(home);
    }
  }

  return res;
}

export const config = {
  // 15/09/2026 — mp4/webm added: the /investors video (public/video/*) was
  // being redirected to /login for every signed-out visitor in production
  // (confirmed live: GET /video/investors-60.mp4 -> 200 /login?next=...,
  // <video> left with networkState=NETWORK_NO_SOURCE) because this list
  // covered image/font static assets but not video, so requests for it fell
  // through to the isPublic check below with no matching PUBLIC entry.
  // Never caught locally: dev:verify runs in demo mode, which returns
  // NextResponse.next() before any of this logic runs at all.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|mp4|webm|mp3)$).*)'],
};
