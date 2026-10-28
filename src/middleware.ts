// Auth gate. If Supabase env is configured, unauthenticated users are sent to /login.
// Public routes: '/' and '/investors' (the marketing landing, Startup and
// Investor sides of the toggle), /login, /signup, /auth/*, /portal (investor
// magic-link area), static assets.
//
// Note on '/': the entry `'/'` only ever matches the root exactly — the
// startsWith(p + '/') arm becomes startsWith('//'), which is never true — so
// adding it does NOT open up the rest of the app.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { shareableCookieDomain } from '@/lib/supabase';
import { VIEWER_ORG_COOKIE, VIEWER_READ_ONLY_CODE, VIEWER_READ_ONLY_MESSAGE } from '@/lib/developer-viewer-shape';
import { viewerWriteVerdict } from '@/lib/viewer-write-gate';
import { isLiveFounderOrg } from '@/lib/founder-hat';
import { PUBLIC_SITE_PATHS } from '@/lib/public-site-routes';
import { isCronTickRequest } from '@/lib/cron-auth';

// Prompt 904 Part B: '/api/auth-code' (register / resend / verify / status) is public because its
// callers have no session yet; each route answers 404 unless AUTH_CODE_MODE allows the email.
// Prompt 905: a published call's link (/call/<token>) and the header it reads (/api/calls/public/<token>) are for
// candidates who have no account yet. Everything else under /api/calls needs a session and answers 404 only while CALLS_MODE is explicitly "off".
const PUBLIC = ['/call', '/api/calls/public', '/api/version', '/', '/investors', '/login', '/signup', '/auth', '/portal', '/api/me', '/api/auth-code', '/api/auth-failures', '/invite', '/api/invite', '/api/portal', '/privacy-request', '/api/gdpr', '/forgot-password', '/reset-password', '/set-password', '/api/stripe/webhook', '/contact', '/api/support', '/api/investor-access-request', '/matchdeal/pair', '/pair', '/manifest.json', '/api/plan/private-detective',
  // Prompt 341 — DL 7/2004's pre-contractual information duty: the text
  // must be reachable BEFORE anyone contracts, not gated behind login. The
  // acceptance routes (/api/terms/status, /api/terms/accept) stay OUT of
  // this list on purpose — they only mean anything for a signed-in user.
  '/terms',
  // Prompt 602 — the closed-account page (the owner who just closed has no
  // session left) and the "this wasn't me" link from the owner's email (the
  // token is the auth). Prompt 603 — the public supplier list, same
  // reasoning as /terms.
  '/closed', '/api/account/not-me', '/legal',
  // Prompt 920 — the public marketing pages (/for-startups, /about, /faq) and the two files crawlers read (/robots.txt, /sitemap.xml).
  // On 16/10/2026 the two files were answering 307 → /login in production: they were not on this list and the matcher below does not exclude
  // .txt/.xml, so the robots.ts written in Prompt 514 had never been served to a single crawler. One shared list (public-site-routes.ts)
  // is read here, by the Shell (which renders these pages bare) and by the sitemap, so the three can no longer disagree; middleware.test.ts
  // drives THIS middleware over every one of them. Exact paths, never a wide prefix (a path under them would 404: nothing lives there).
  ...PUBLIC_SITE_PATHS,
  // Prompt 114 Fase 1 — the token IS the auth for this one route now; a
  // caller here has no session yet by definition (that's the whole point).
  // Exact path only (not a prefix) — every other /api/matchdeal/pairing/*
  // route (self, disconnect, generate, status) still requires a real
  // session and must NOT be added here.
  '/api/matchdeal/pairing/consume',
  // Prompt 557 §3 — Resend's delivery webhook. Public for the same reason
  // as the Stripe webhook above it: the provider has no session and never
  // will. The route authenticates the REQUEST instead, by verifying the
  // Svix signature over the raw body before it reads anything, and rejects
  // everything when RESEND_WEBHOOK_SECRET is unset.
  '/api/resend/webhook',
  // Item 1 (Lote E) — same reasoning as the pairing token above: a guest
  // link's whole point is working with no session. /api/guest never returns
  // signed URLs or document content, only names/counts (see that route).
  '/guest', '/api/guest',
  // "Claim this profile" (2026-08-07) — reached straight from the
  // unauthenticated /investors landing page's CTA; the page itself shows
  // InvestorSignInForm when there's no session, same as /portal. The write
  // routes (/api/portal/claims*) are already covered by the existing
  // '/api/portal' prefix above.
  '/claim',
  // Prompt 538 — public because the ROUTE authenticates itself, and because
  // it is unreachable otherwise: since Supabase email confirmation was
  // turned on (early August 2026) `signUp()` returns no session, so there
  // is no cookie for this middleware to accept, and every founder signup's
  // provisioning POST was 307'd to /login — the client then parsed the
  // login page's HTML as JSON and showed "we couldn't reach the server".
  // The route's own gate is the real one and must not be widened or
  // narrowed to compensate (see the BUG-SEG-1 block in
  // src/app/api/provision-org/route.ts): with a session, caller.id must
  // equal user_id or 403; without one, the target account must have been
  // created less than 10 minutes ago or 403; blocked emails 403; the
  // @ablute.pt domain grant additionally requires email_confirmed_at.
  // Exact path only — it has no sub-routes.
  '/api/provision-org',
  // Prompt 335 §D1/§D3a — both landing pages for My Network's cold-start
  // links work exactly like the pairing-consume/guest links above: the
  // token itself is the entire authorization, and the whole point (for the
  // email-invite link) is a recipient who has no session yet at all. The
  // connect-link page also needs to load logged-out so it can redirect an
  // unauthenticated opener into /signup itself, client-side.
  '/network/invite', '/api/network/invite-link', '/network/connect',
  // Prompt 749 — the exact same "unauthenticated landing page needs live
  // data" case as /investors above, for the live AI-credit numbers on the
  // founder landing page's pricing section (PricingSection.tsx). Found
  // missing here only after merge, by probing the live route: an anonymous
  // request was 307ing to /login instead of returning JSON, so
  // PricingSection's fetch silently failed (its own .catch) and every
  // anonymous visitor's landing page rendered "AI credits included" with
  // no number — never wrong data, just never the LIVE number the prompt
  // asked for. The route itself has no write capability and only ever
  // reads the three built-in plans' public price-list numbers (no
  // fallback to a guessed constant either — see that route's own header).
  '/api/plan-credits'];

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
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'));

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

  if (!user && !isPublic) {
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|mp4|webm)$).*)'],
};
