// Prompt 526 Part B / Prompt 548 — the guest previews' copy and links.
//
// Plain .ts, not co-located in GuestPreviewShell.tsx, for one concrete
// reason: vitest in this repo has no JSX transform configured, so a test can
// import this but not the component. The copy below is exactly what needs a
// test (see guest-previews.test.ts), so it lives where a test can reach it.
//
// Prompt 548 widened this from the email's three CTAs to every entry in
// INVESTOR_NAV except 'access'. The three original messages are UNCHANGED —
// see the note on PREVIEW_COPY.
import type { Tab } from '@/components/investor-workspace/InvestorWorkspaceShell';
import { GUEST_PREVIEWABLE_KEYS } from './investor-nav';

export type PreviewKey = Tab;

// Prompt 526's three, kept as their own list: these are the keys the
// approved investor email links to directly, and the ones whose copy is
// contractually fixed.
export const EMAIL_CTA_KEYS = ['pipeline', 'watson', 'bars'] as const;

export interface PreviewCopy {
  /** The real screen's own heading, so a guest sees the product, not a pitch. */
  title: string;
  /** The one contextual sentence under the frost. */
  message: string;
  /** Carried through signup so the guest can be returned here later. */
  source: string;
}

// The three contextual messages for pipeline/watson/bars come verbatim from
// the original request (via Prompt 526 Part B) — they are the copy that the
// approved email's own three CTAs promise, so a reworded version here would
// break the promise the email made. The test alongside this file asserts
// them character by character for exactly that reason. Everything else was
// added by Prompt 548 and is ordinary product copy.
export const PREVIEW_COPY: Record<string, PreviewCopy> = {
  pipeline: {
    title: 'Find your next unicorn',
    message: 'Sign up to access a pipeline curated for your investment thesis.',
    source: 'pipeline_preview',
  },
  watson: {
    title: 'Ask Watson',
    // Watson NEVER runs for a guest — there is no fetch on these pages at
    // all, so there is nothing to gate at the API layer; the model is simply
    // never reached.
    message: 'Create an investor account to use Watson and get a private AI second opinion on your deals.',
    source: 'watson_preview',
  },
  bars: {
    title: 'Spot the risks others miss',
    message: 'Create an investor account to assess opportunities with BARS.',
    source: 'bars_preview',
  },
  about: {
    title: 'About your firm',
    message: 'Tell Sherlock your thesis once — every startup you see is scored against it.',
    source: 'about_preview',
  },
  dashboard: {
    title: 'Dashboard',
    message: 'Your deals, your pace, your follow-ons — in one view, never a feed.',
    source: 'dashboard_preview',
  },
  evaluation: {
    title: 'Evaluation tools',
    message: 'Run the numbers on any round before you answer it.',
    source: 'evaluation_preview',
  },
  actions: {
    title: 'Actions required',
    message: 'Sherlock lists what needs you today — nothing else.',
    source: 'actions_preview',
  },
  agenda: {
    title: 'Agenda',
    message: 'Every deadline and meeting from every startup you follow, in one calendar.',
    source: 'agenda_preview',
  },
  network: {
    title: 'My Network',
    message: 'Founders, co-investors and colleagues — the people behind the deals.',
    source: 'network_preview',
  },
  messages: {
    title: 'Messages',
    message: 'Talk to founders inside the deal, not in your inbox.',
    source: 'messages_preview',
  },
  support: {
    title: 'Support',
    message: 'A person, not a bot — within the day.',
    source: 'support_preview',
  },
  // Plans is deliberately NOT frosted (Prompt 548 Part 4) — the real prices
  // render. The entry exists so the source string is defined in one place.
  plans: {
    title: 'Plans & billing',
    message: 'Pick the plan that fits, then create your account.',
    source: 'plans',
  },
};

// The email's own three CTAs, unchanged: /guest/preview/<key>, no token.
export const PREVIEWS = EMAIL_CTA_KEYS.map((key) => ({
  key,
  label: PREVIEW_COPY[key].title,
  href: `/guest/preview/${key}`,
})) as readonly { key: typeof EMAIL_CTA_KEYS[number]; label: string; href: string }[];

// Always the EXISTING signup flow (Prompt 526 is explicit that self-serve
// investor registration is out of scope). `source` is carried so that flow
// can one day return the guest to the screen they came from; nothing depends
// on it working today — it just isn't thrown away.
//
// Prompt 548: `token` rides along the same way, for the same reason. The
// signup flow ignores it today; it is carried so the guest's existing grant
// can be resolved to the new account later, as Prompt 547 set out.
export function previewSignupHref(key: string, token?: string): string {
  const source = PREVIEW_COPY[key]?.source ?? key;
  const base = `/signup?as=investor&source=${encodeURIComponent(source)}`;
  return token ? `${base}&guest=${encodeURIComponent(token)}` : base;
}

// Every key a preview ROUTE will serve. Wider than the sidebar on purpose:
// 'watson' and 'bars' are not nav entries (they are tools inside Evaluation
// tools), but the approved investor email links straight to
// /guest/preview/watson and /guest/preview/bars, and those URLs are in
// people's inboxes. Dropping them would 404 two of the email's own three
// CTAs — which is exactly what happened the first time this route was made
// dynamic, and is why there is now a test naming all three.
export function isPreviewableKey(key: string): boolean {
  return (GUEST_PREVIEWABLE_KEYS as string[]).includes(key)
    || (EMAIL_CTA_KEYS as readonly string[]).includes(key);
}

// Which sidebar entry to highlight for a given preview. watson/bars live
// under Evaluation tools, so that is the entry that lights up.
export function activeNavKeyFor(key: string): string {
  return key === 'watson' || key === 'bars' ? 'evaluation' : key;
}

// Where a guest sidebar entry points. 'access' is the share itself, so with
// a token it returns to the document list and without one it is absent
// (there is nothing to return to).
export function guestNavHref(key: string, token?: string): string | null {
  if (key === 'access') return token ? `/guest/${token}` : null;
  if (!(GUEST_PREVIEWABLE_KEYS as string[]).includes(key)) return null;
  // Prompt 548 Part 2: without a token, Plans points at the public pricing
  // page rather than a preview of it — a visitor with no share has a real
  // page to read.
  if (key === 'plans' && !token) return '/investors#pricing';
  return previewHref(key, token);
}

// Prompt 557 — the URL shape for ANY previewable key, which is a wider set
// than the sidebar's. guestNavHref answers "where does this SIDEBAR ENTRY
// go" and correctly returns null for a key that is not an entry; the
// approved email's own CTAs include two keys that are not entries —
// 'watson' and 'bars' are tools inside Evaluation tools — so asking
// guestNavHref for them yields null, and interpolating that null into a URL
// produced `https://…appnull?from=guest-email`. Caught by the route
// existence test rather than in an inbox, but only just.
//
// So: one function owns the shape (`/guest/<token>/preview/<key>` with a
// token, `/guest/preview/<key>` without), guestNavHref delegates to it after
// applying its own sidebar rules, and the email uses it directly. The two
// can no longer disagree about what a preview URL looks like.
export function previewHref(key: string, token?: string): string {
  return token ? `/guest/${token}/preview/${key}` : `/guest/preview/${key}`;
}
