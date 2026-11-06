// Prompt 933 (06/11/2026) — which paths belong to the app, in ONE place: read by the auth middleware (src/middleware.ts) and pinned by route-zones.test.ts against the folders of src/app.
//
// Until 06/11/2026 the middleware had one rule: every path that was not on its PUBLIC list went to /login. So a mistyped address, a link that had gone stale, or a bot's probe
// (/qualquer-coisa, /wp-login.php, /api/isto-nao-existe) answered 307 → /login?next=… — the sign-in screen for somebody who only had a wrong URL — and a visitor with no session could
// never reach Next's 404 at all. Now a session is asked for where there is something behind a session. Three kinds of path:
//
//   public    — PUBLIC_PATHS below (the list that used to live in the middleware, unchanged, with its reasons);
//   protected — a top-level page folder of src/app that needs a session (PROTECTED_PAGE_ZONES) or a top-level folder of src/app/api (API_ZONES): no session → /login?next=…, exactly as before;
//   unknown   — nothing in the app answers it. A page path goes on to Next, which answers 404 with src/app/not-found.tsx; an /api path is answered 404 as JSON by the middleware itself.
//
// THE HAZARD of this design, stated plainly: the old default was closed (a path nobody had classified asked for a login), the new one is open for a path nobody has classified. A folder added to
// src/app (or src/app/api) and forgotten here would be reachable with no session. route-zones.test.ts is what prevents that: it fails when a folder is in none of the lists and when a list names
// a folder that is not there. Do not make that test pass by loosening it — classify the folder.
//
// Pure and dependency-free on purpose: the middleware runs in the Edge runtime.
import { PUBLIC_SITE_PATHS } from './public-site-routes';

// Prompt 904 Part B: '/api/auth-code' (register / resend / verify / status) is public because its
// callers have no session yet; each route answers 404 unless AUTH_CODE_MODE allows the email.
// Prompt 905: a published call's link (/call/<token>) and the header it reads (/api/calls/public/<token>) are for
// candidates who have no account yet. Everything else under /api/calls needs a session and answers 404 only while CALLS_MODE is explicitly "off".
// Prompt 923 (A): /go (the router after every sign-in) is reachable without a session on purpose — it answers a signed-out visit itself, sending the person back to the sign-in form WITH the investor side and the
// "link failed → use the code" fall-back (an expired or pre-fetched link lands here with linkFailed=1). Behind the middleware's own redirect it would arrive at /login with neither.
//
// Each entry matches the path itself and everything under it (`p` or `p/…`), except '/', which matches only the root (isPublicPath below says why): listing it does NOT open up the rest of the app.
export const PUBLIC_PATHS: readonly string[] = ['/call', '/api/calls/public', '/api/email/unsubscribe', '/api/version', '/', '/investors', '/login', '/signup', '/auth', '/go', '/portal', '/api/me', '/api/auth-code', '/api/auth-failures', '/invite', '/api/invite', '/api/portal', '/privacy-request', '/api/gdpr', '/forgot-password', '/reset-password', '/set-password', '/api/stripe/webhook', '/contact', '/api/support', '/api/investor-access-request', '/matchdeal/pair', '/pair', '/manifest.json', '/api/plan/private-detective',
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
  // On 16/10/2026 the two files were answering 307 → /login in production: they were not on this list and the middleware's matcher does not exclude
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

/**
 * Top-level page folders of src/app that need a session. A path is protected when it is one of these or under one (`/pipeline`, `/pipeline/x`; never `/pipelinex`). The public sub-paths that sit
 * inside one of them (/network/invite, /network/connect) are on PUBLIC_PATHS and are decided there first. route-zones.test.ts: every folder of src/app is either listed here or the first segment of a
 * PUBLIC_PATHS entry, and every entry here is a folder that exists.
 */
export const PROTECTED_PAGE_ZONES: readonly string[] = [
  '/agenda', '/auth-code-test', '/automations', '/backoffice', '/blocked', '/calls', '/catalog-people', '/company', '/dashboard', '/documents', '/ecosystem', '/entities', '/import', '/incubator',
  '/log', '/messages', '/metrics', '/needs-review', '/network', '/outbox', '/packs', '/people', '/pipeline', '/plans', '/queue', '/readiness', '/settings', '/suspended', '/tasks', '/today', '/welcome',
];

/**
 * Top-level folders of src/app/api (names, without the /api/). `/api/<zone>/…` exists as far as this list goes: a path inside a zone that no route answers is still sent to /login without a session
 * (the zone is behind one) and answered 404 by Next with one. An /api path whose first segment is not here is answered 404 as JSON by the middleware, session or not. route-zones.test.ts keeps this
 * equal to the folders on disk, both ways.
 */
export const API_ZONES: readonly string[] = [
  'account', 'ai-credits', 'ai-review', 'auth-code', 'auth-failures', 'automations', 'backoffice', 'blueprint', 'calls', 'classify-interaction', 'coaching', 'commitments', 'community-consensus',
  'company', 'company-badges', 'company-media', 'compose', 'contributions', 'data-room', 'ecosystem', 'email', 'entities', 'events', 'form-assist', 'founder', 'gdpr', 'guest', 'import', 'incubator',
  'investor-access-request', 'invite', 'market-data', 'market-thesis', 'matchdeal', 'me', 'mini-pitch', 'needs-review', 'network', 'oauth', 'org', 'pipeline', 'pipeline-unlock', 'plan', 'plan-credits',
  'platform-badges', 'portal', 'product-events', 'promo', 'provision-org', 'readiness', 'reawakening', 'reconciliation', 'resend', 'review', 'roadmap', 'settings', 'stripe', 'suggestions', 'support',
  'team', 'terms', 'usage', 'vault-pin', 'version', 'website-health',
];

/**
 * True for a path on PUBLIC_PATHS: the path itself, or anything under it. The root is the exception — '/' matches only '/': read as a prefix it would be `startsWith('//')`, true for every path that
 * begins with a doubled slash (`//dashboard`), so the old middleware read such a path as public. The comment on the list said that arm "never" matched; a doubled slash is how it does. (In practice Next answers a doubled
 * slash with a 308 to the single-slash path BEFORE the middleware runs — measured on 06/11/2026, in production and on a local build — so it was not reachable; the classifier must not depend on that.)
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || (p !== '/' && pathname.startsWith(`${p}/`)));
}

/** True for /api and everything under it. */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

const fold = (p: string) => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();

/**
 * Every form of one request path that a router could read it as: the path as sent, folded (backslashes and doubled slashes to one slash, lower case — a router or a proxy that is not as strict as Next
 * must not be able to turn a protected path into an unknown one), and what is left after each layer of percent-decoding, three at most. `null` when a layer is malformed (`%zz`) or there are more
 * than three: nobody sends that as a real address, and the caller then keeps the login gate.
 */
function pathForms(pathname: string): string[] | null {
  const forms: string[] = [];
  let current = pathname;
  for (let layer = 0; layer <= 3; layer++) {
    forms.push(fold(current));
    let decoded: string;
    try { decoded = decodeURIComponent(current); } catch { return null; }
    if (decoded === current) return forms;
    current = decoded;
  }
  return null;
}

const inPageZone = (form: string) => PROTECTED_PAGE_ZONES.some((z) => form === z || form.startsWith(`${z}/`));
const inApiZone = (form: string) => form.startsWith('/api/') && API_ZONES.includes(form.split('/')[2]);

/**
 * True when nothing in the app answers this path: it is not on PUBLIC_PATHS (decided on the path exactly as sent, as it always was) and in none of the forms a router could read it as is it inside a
 * protected page zone or an API zone. Such a path is not a reason to ask for a session. A path that cannot be decoded is never unknown.
 */
export function isUnknownPath(pathname: string): boolean {
  if (isPublicPath(pathname)) return false;
  const forms = pathForms(pathname);
  if (!forms) return false;
  return !forms.some((f) => inPageZone(f) || inApiZone(f));
}
