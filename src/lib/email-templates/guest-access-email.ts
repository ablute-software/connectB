// Prompt 526 Part A — populating the approved guest-access email.
//
// The markup itself lives in guest-access-email-source.ts, generated from the
// approved package. This file only fills its {{variables}} from real data; it
// deliberately contains no markup of its own, so the locked design cannot drift
// by someone editing "just one line" of HTML in here.
import { APP_URL } from '@/lib/brand';
import { GUEST_ACCESS_EMAIL_HTML, GUEST_ACCESS_EMAIL_TEXT } from './guest-access-email-source';

/**
 * First name only, for the greeting.
 *
 * invited_name is frequently empty — most invites are just an email address —
 * and the approved copy greets by first name. A neutral "there" is the fallback
 * the brief asks for: never a literal {{recipient_first_name}}, never the string
 * "undefined", and never the raw email address, which reads as a mail merge that
 * went wrong.
 */
export function firstNameOr(fallback: string, invitedName?: string | null): string {
  const first = (invitedName ?? '').trim().split(/\s+/)[0] ?? '';
  return first.length > 0 ? first : fallback;
}

export interface GuestAccessEmailVars {
  /** access_grants.invited_name — may be null/empty, which is the common case. */
  invitedName?: string | null;
  /** The granting org's real display name. */
  startupName: string;
  /** Exactly the link Prompt 171 already sends: `${APP_URL}/guest/${token}`. */
  guestAccessUrl: string;
}

// The three preview CTAs the approved design promises. Each carries where it
// came from, so a signup can eventually return the investor to the tool they
// clicked rather than dropping them at a generic dashboard (Prompt 526 Part B).
// Nothing depends on that round-trip working yet — this only avoids throwing
// the information away.
const PREVIEW_URLS = {
  discover_startups_url: `${APP_URL}/guest/preview/pipeline`,
  watson_url: `${APP_URL}/guest/preview/watson`,
  bars_url: `${APP_URL}/guest/preview/bars`,
};

// Real, existing destinations only — a 404 in a transactional email is worse
// than a slightly generic link. There is no dedicated privacy or security page
// today, so both point at the one legal document that exists; if those pages
// are ever written, this is the single place to repoint them.
const SITE_URLS = {
  website_url: APP_URL,
  privacy_url: `${APP_URL}/terms`,
  security_url: `${APP_URL}/terms`,
  contact_url: `${APP_URL}/contact`,
};

function fill(template: string, vars: Record<string, string>): string {
  // Replaces every {{key}} present in the map. Any placeholder NOT in the map
  // is left alone deliberately rather than blanked — a visible {{foo}} in a
  // test render is a loud bug; a silently empty one is not.
  return template.replace(/\{\{([a-z_]+)\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : whole);
}

function varsFor(v: GuestAccessEmailVars): Record<string, string> {
  return {
    recipient_first_name: firstNameOr('there', v.invitedName),
    startup_name: v.startupName,
    guest_access_url: v.guestAccessUrl,
    // Served by the app itself from public/email-assets — same mechanism
    // public/badges already proves works over stable HTTPS on Vercel, so no CDN
    // and no storage bucket are involved.
    asset_base_url: `${APP_URL}/email-assets`,
    ...PREVIEW_URLS,
    ...SITE_URLS,
  };
}

export function renderGuestAccessEmailHtml(v: GuestAccessEmailVars): string {
  return fill(GUEST_ACCESS_EMAIL_HTML, varsFor(v));
}

export function renderGuestAccessEmailText(v: GuestAccessEmailVars): string {
  return fill(GUEST_ACCESS_EMAIL_TEXT, varsFor(v));
}

/** Subject line for the approved email. */
export function guestAccessEmailSubject(startupName: string): string {
  return `${startupName} shared their data room with you`;
}
