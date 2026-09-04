// Prompt 532 — renders the APPROVED SherlockDeal guest-access email (v2).
//
// The design is locked. This file does exactly two things: substitute the
// declared variables, and refuse to send anything with a placeholder left
// in it. It never rewrites, reorders, simplifies or "modernises" the
// markup — src/lib/email-templates/guest-access-v2.html is the package's
// own template.html, byte-for-byte, and the only legitimate reason to edit
// it is a verified email-client compatibility fix.
//
// preview.html is deliberately NOT in the repo: it inlines every asset as a
// base64 data URI (250KB) for offline viewing, and §17 forbids sending it as
// production HTML. Only template.html + plain_text.txt ship.
//
// The v2 refinement notes and the README's older "Design lock" list
// disagree (the list still mentions CTA curves and the decorative star that
// v2 removed). Per the request's §18 the final template.html wins, so the
// three legacy assets it no longer references — button-decor.png,
// about-decor.png, divider-star.png — were deliberately NOT copied into
// public/. They exist in the ZIP; nothing renders them.
import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { APP_URL } from './brand';
import { EMAIL_CTA_KEYS, previewHref } from './guest-previews';

/** Every variable the package declares (variables.json), all required. A
 *  missing one is a bug, not a blank — see assertNoUnresolvedTokens. */
export interface GuestAccessEmailVars {
  recipient_first_name: string;
  startup_name: string;
  guest_access_url: string;
  discover_startups_url: string;
  watson_url: string;
  bars_url: string;
  website_url: string;
  privacy_url: string;
  security_url: string;
  contact_url: string;
  asset_base_url: string;
}

/**
 * Where the email's images are served from in production.
 *
 * Next.js serves `public/` over HTTPS at the app origin — the same
 * mechanism `/badges/pioneer.png` already uses — so this is the existing
 * asset architecture, not a new one, and it moves with NEXT_PUBLIC_APP_URL
 * on the domain cutover like every other generated link. No local paths, no
 * data URIs, no preview hosts.
 */
export const GUEST_EMAIL_ASSET_BASE = `${APP_URL}/email/guest-access`;

/**
 * The product-discovery links in the email land inside the real Investor
 * Workspace in guest mode, on the relevant surface — not on a generic
 * signup wall (§28). `?from=guest-email` lets those pages keep the return
 * target through a later signup, which is what variables.json asks for.
 *
 * Prompt 557 — every URL this returned was a 404. Seven of them.
 *
 * The three CTAs pointed at `/portal/pipeline|watson|bars`. No such routes
 * exist and none ever did: `/portal` is ONE page that switches on `?tab=`.
 * The pages these cards promise were built (Prompt 526 Part B, made dynamic
 * by 548) and live at `/guest/preview/<key>` — 548 even kept `watson` and
 * `bars` in EMAIL_CTA_KEYS explicitly "because they are in people's
 * inboxes". The email simply never pointed at them. Nuno clicked all three
 * on a real Krohnsty share and got "404 — This page could not be found."
 *
 * The footer was wrong the same way: `/privacy`, `/security` and `/support`
 * are not routes either. They are not even 404s — the middleware bounces
 * them to `/login?next=…` (307), so an invited guest with no account was
 * being asked to sign in to read a privacy policy.
 *
 * With a token the CTAs go to `/guest/<token>/preview/<key>`, so the guest
 * keeps their share while browsing and the sidebar can return them to it;
 * without one (the back-office test send) they go to the token-less
 * `/guest/preview/<key>`. Both shapes come from guestNavHref, so this can
 * never drift from what the preview routes actually serve.
 *
 * The footer now points at pages that exist and are in the middleware's
 * PUBLIC list: `/terms` carries the data-protection text (it is the
 * pre-contractual page DL 7/2004 requires to be readable without an
 * account) and `/contact` is the real contact page. `/privacy-request` is
 * deliberately NOT used for `privacy_url` — it is the GDPR *request form*,
 * not a policy to read.
 *
 * guest-access-email.test.ts walks src/app and fails if any URL returned
 * here does not resolve to a real route, so this class of bug cannot come
 * back silently.
 */
export function guestEmailLinks(token?: string): Pick<GuestAccessEmailVars,
  'discover_startups_url' | 'watson_url' | 'bars_url' | 'website_url' | 'privacy_url' | 'security_url' | 'contact_url'> {
  const from = 'from=guest-email';
  const cta = (key: (typeof EMAIL_CTA_KEYS)[number]) => `${APP_URL}${previewHref(key, token)}?${from}`;
  return {
    discover_startups_url: cta('pipeline'),
    watson_url: cta('watson'),
    bars_url: cta('bars'),
    website_url: APP_URL,
    privacy_url: `${APP_URL}/terms`,
    security_url: `${APP_URL}/terms`,
    contact_url: `${APP_URL}/contact`,
  };
}

/** First name only, for the greeting. Falls back to the local part of the
 *  address rather than leaving "Hi ," — never to a generic "there", which
 *  reads as a mail-merge failure. */
export function greetingName(invitedName: string | null | undefined, email: string): string {
  const trimmed = invitedName?.trim();
  if (trimmed) return trimmed.split(/\s+/)[0];
  const local = email.split('@')[0] ?? '';
  const cleaned = local.replace(/[._-]+/g, ' ').trim();
  if (!cleaned) return 'there';
  return cleaned.split(/\s+/)[0].replace(/^./, (c) => c.toUpperCase());
}

// The template is read from disk once per server instance. It is bundled by
// Next because the path is resolved from process.cwd() at runtime — see the
// route's own note; keeping it as a real .html file (rather than a TS string
// literal) is what makes "byte-for-byte the approved template" verifiable by
// diffing against the ZIP.
let cachedHtml: string | null = null;
let cachedText: string | null = null;

function templatePath(file: string): string {
  return path.join(process.cwd(), 'src', 'lib', 'email-templates', file);
}

// Prompt 535 — line endings are normalised on read, not assumed.
//
// The blob stored in git uses LF, so on Vercel (Linux) these files arrive
// with LF and everything downstream works. But git's core.autocrlf rewrites
// them to CRLF on checkout on Windows, and renderGuestAccessEmail's
// /^Subject:\s*(.+)$/ then silently stops matching: in JavaScript "." does
// not match a carriage return (it counts as a line terminator), so (.+)
// stops one character short and $ can no longer reach the end of the line.
// The subject falls back to the hardcoded default AND the literal
// "Subject: ..." line stays at the top of the plain-text body, where the
// recipient reads it.
//
// Production was never affected — measured, not assumed: the stored blob is
// LF while the Windows working copy is CRLF. But the parsing was one commit
// away from being wrong for real, and it already made
// guest-access-email.test.ts fail on every Windows checkout, Nuno's included.
// Normalising on read fixes it for every consumer at once, rather than
// hardening one regex and leaving the next reader to rediscover it.
export function normaliseNewlines(raw: string): string {
  return raw.replace(/\r\n/g, '\n');
}

export function loadGuestAccessTemplate(): { html: string; text: string } {
  if (cachedHtml === null) cachedHtml = normaliseNewlines(readFileSync(templatePath('guest-access-v2.html'), 'utf8'));
  if (cachedText === null) cachedText = normaliseNewlines(readFileSync(templatePath('guest-access-v2.txt'), 'utf8'));
  return { html: cachedHtml, text: cachedText };
}

/** HTML-escapes a value before it goes into markup. The recipient name and
 *  the startup name are user-supplied strings; without this an apostrophe or
 *  an angle bracket in an org name would break the email, and a crafted one
 *  could inject markup into it. URLs are escaped the same way — they are
 *  built by us, but a quote in one would still break out of the attribute. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function substitute(source: string, vars: GuestAccessEmailVars, escapeValues: boolean): string {
  return source.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key: string) => {
    const value = (vars as unknown as Record<string, string | undefined>)[key];
    if (value === undefined) return whole; // left unresolved on purpose, so the assert below catches it
    return escapeValues ? esc(value) : value;
  });
}

/**
 * The last line of defence before a send: no `{{token}}` may survive into a
 * delivered email (§21). Throwing here is deliberate — a mail that reads
 * "Hi {{recipient_first_name}}" is worse than a mail that failed loudly, and
 * the caller turns this into a truthful "notification failed" while keeping
 * the access and the guest link intact.
 */
export function assertNoUnresolvedTokens(rendered: string, label: string): void {
  const leftover = rendered.match(/\{\{\s*[a-z_]+\s*\}\}/gi);
  if (leftover) {
    throw new Error(`${label} still contains unresolved template variables: ${[...new Set(leftover)].join(', ')}`);
  }
}

export interface RenderedGuestEmail { subject: string; html: string; text: string }

/**
 * Renders the approved template. Subject comes from the package's own
 * plain_text.txt first line ("Subject: {{startup_name}} shared documents
 * with you"), so the wording stays the approved one rather than something
 * invented here.
 */
export function renderGuestAccessEmail(vars: GuestAccessEmailVars): RenderedGuestEmail {
  const { html, text } = loadGuestAccessTemplate();

  const renderedHtml = substitute(html, vars, true);
  // Plain text must NOT be HTML-escaped — an &amp; in a text/plain part is a
  // visible defect, not an encoding.
  const renderedTextRaw = substitute(text, vars, false);

  assertNoUnresolvedTokens(renderedHtml, 'Guest-access email HTML');
  assertNoUnresolvedTokens(renderedTextRaw, 'Guest-access email plain text');

  const [firstLine, ...rest] = renderedTextRaw.split('\n');
  const subjectMatch = firstLine.match(/^Subject:\s*(.+)$/);
  const subject = subjectMatch ? subjectMatch[1].trim() : `${vars.startup_name} shared documents with you`;

  return {
    subject,
    html: renderedHtml,
    // Drop the "Subject:" line and the blank line after it from the body.
    text: (subjectMatch ? rest.join('\n') : renderedTextRaw).replace(/^\n+/, ''),
  };
}

/** Everything a caller needs to render, assembled from the two values that
 *  actually vary per send. */
export function buildGuestAccessEmail(params: {
  recipientEmail: string; invitedName?: string | null; startupName: string; guestUrl: string;
  /** Prompt 557 — the share's own token, when the caller has one (both invite
   *  routes do). It makes the three CTAs keep the guest inside their share
   *  instead of dropping them on the anonymous preview. Optional because the
   *  back-office test send has no real share to carry. */
  guestToken?: string | null;
}): RenderedGuestEmail {
  return renderGuestAccessEmail({
    recipient_first_name: greetingName(params.invitedName, params.recipientEmail),
    startup_name: params.startupName,
    guest_access_url: params.guestUrl,
    asset_base_url: GUEST_EMAIL_ASSET_BASE,
    ...guestEmailLinks(params.guestToken ?? undefined),
  });
}
