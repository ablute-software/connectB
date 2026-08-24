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

const PUBLIC = ['/', '/investors', '/login', '/signup', '/auth', '/portal', '/api/me', '/invite', '/api/invite', '/api/portal', '/privacy-request', '/api/gdpr', '/forgot-password', '/reset-password', '/set-password', '/api/stripe/webhook', '/contact', '/api/support', '/api/investor-access-request', '/matchdeal/pair', '/pair', '/manifest.json', '/api/plan/private-detective',
  // Prompt 341 — DL 7/2004's pre-contractual information duty: the text
  // must be reachable BEFORE anyone contracts, not gated behind login. The
  // acceptance routes (/api/terms/status, /api/terms/accept) stay OUT of
  // this list on purpose — they only mean anything for a signed-in user.
  '/terms',
  // Prompt 114 Fase 1 — the token IS the auth for this one route now; a
  // caller here has no session yet by definition (that's the whole point).
  // Exact path only (not a prefix) — every other /api/matchdeal/pairing/*
  // route (self, disconnect, generate, status) still requires a real
  // session and must NOT be added here.
  '/api/matchdeal/pairing/consume',
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
  // Prompt 335 §D1/§D3a — both landing pages for My Network's cold-start
  // links work exactly like the pairing-consume/guest links above: the
  // token itself is the entire authorization, and the whole point (for the
  // email-invite link) is a recipient who has no session yet at all. The
  // connect-link page also needs to load logged-out so it can redirect an
  // unauthenticated opener into /signup itself, client-side.
  '/network/invite', '/api/network/invite-link', '/network/connect'];

// Where a signed-in user belongs. '/' is the public landing now, so the app
// home is the pipeline.
const APP_HOME = '/pipeline';

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Demo mode (no backend) — let everything through.
  if (!url || !anon) return NextResponse.next();

  const { pathname } = req.nextUrl;
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
  if (user && pathname !== '/suspended' && pathname !== '/blocked' && !pathname.startsWith('/api/')) {
    const { data: state } = await supabase.rpc('account_access_state');
    if (state === 'blocked' || state === 'suspended') {
      const redirect = req.nextUrl.clone();
      redirect.pathname = state === 'blocked' ? '/blocked' : '/suspended';
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
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const home = req.nextUrl.clone();
    home.pathname = APP_HOME;
    home.search = '';
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)'],
};
