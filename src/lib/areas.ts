// Prompt 923 (A) — where a person goes after signing in, and which areas of the product they can open: ONE rule, here, read by the post-login router (/go), the landing pages, the menu's area selector and /portal.
//
// On 28/10/2026 a founder who is also an active member of an investor firm chose "Investor" at the login and landed on a /portal that said "No active access for this account" with only a "Log out" button:
//   1. the login's default destination for "Investor" was /portal, whatever the person was;
//   2. /portal showed the investor workspace only to somebody who had a DATA ROOM granted by a startup — a firm member with none saw the data-room dead end instead of their firm's workspace;
//   3. nothing told the person which other areas they had.
// The areas are:
//   founder      the startup's workspace (/pipeline). Also the platform team's home.
//   ecosystem    an ecosystem organisation's workspace (/ecosystem).
//   investor     the investor firm's workspace (/portal): the firm's calls, profile, seats, pipeline.
//   dataroom     the data rooms startups have shared with the person (/portal, Pipeline tab). Listed whenever the person has a grant, so a firm member who also holds grants can reach them from the menu.
import { decideRole, type RoleSignals } from './role-decision';

export type Area = 'founder' | 'ecosystem' | 'investor' | 'dataroom';
export const AREAS: readonly Area[] = ['founder', 'ecosystem', 'investor', 'dataroom'];
/** What the person chose on the login page ("Startup" or "Investor"). */
export type Intent = 'founder' | 'investor';

export const AREA_LABEL: Record<Area, string> = { founder: 'Founder workspace', ecosystem: 'Ecosystem workspace', investor: 'Investor workspace', dataroom: 'Data rooms' };
export const AREA_PATH: Record<Area, string> = { founder: '/pipeline', ecosystem: '/ecosystem', investor: '/portal', dataroom: '/portal?tab=pipeline' };
/** One sentence on what each area is — used by the pages that tell a person they have nothing in the area they opened. */
export const AREA_ABOUT: Record<Area, string> = {
  founder: 'The founder workspace is where a startup runs its fundraising.',
  ecosystem: 'The ecosystem workspace is where an accelerator or incubator manages its programmes.',
  investor: "The investor workspace is your firm's area: its calls, profile, seats and pipeline.",
  dataroom: 'Data rooms are the folders startups share with you.',
};

/** The cookie that remembers the last area the person used (written by the menu's area selector and by every area's page, read by /go). */
export const LAST_AREA_COOKIE = 'sd_area';

export function parseArea(v: unknown): Area | null {
  return typeof v === 'string' && (AREAS as readonly string[]).includes(v) ? (v as Area) : null;
}
export function parseIntent(v: unknown): Intent | null {
  return v === 'investor' || v === 'founder' ? v : null;
}

/** The areas this account can open, in the order of precedence (founder > ecosystem > investor > data rooms — decideRole's own order). */
export function areasOf(signals: RoleSignals): Area[] {
  const out: Area[] = [];
  if (signals.hasOpenFounderOrg || decideRole(signals) === 'developer') out.push('founder');
  if (signals.hasActiveIncubatorMembership) out.push('ecosystem');
  if (signals.hasApprovedClaim || signals.hasActiveInvestorMembership) out.push('investor');
  if (signals.hasAccessGrant) out.push('dataroom');
  return out;
}

/**
 * Where to land, given what the person has:
 *   1. what they chose on the login page ("Investor" → their firm's workspace, or their data rooms when they have no firm; "Startup" → the founder workspace), if they have it;
 *   2. otherwise the area they used last, if they still have it;
 *   3. otherwise the first of founder > ecosystem > investor > data rooms.
 * null = no area at all (the caller decides: a pending claim, a pending invitation, or the public page).
 */
export function landingArea(areas: readonly Area[], opts: { intent?: Intent | null; last?: Area | null } = {}): Area | null {
  const has = (a: Area) => areas.includes(a);
  if (opts.intent === 'investor') { if (has('investor')) return 'investor'; if (has('dataroom')) return 'dataroom'; }
  if (opts.intent === 'founder' && has('founder')) return 'founder';
  if (opts.last && has(opts.last)) return opts.last;
  return AREAS.find(has) ?? null;
}

export const areaPath = (a: Area): string => AREA_PATH[a];

/** The areas to offer in the menu's selector: only those the person has, with where each leads. */
export function selectorOptions(areas: readonly Area[]): { area: Area; label: string; href: string }[] {
  return AREAS.filter((a) => areas.includes(a)).map((a) => ({ area: a, label: AREA_LABEL[a], href: AREA_PATH[a] }));
}

/** `sd_area=<area>; path=/; max-age=1 year; SameSite=Lax` — what the browser writes to remember the last area. */
export function lastAreaCookie(area: Area): string {
  return `${LAST_AREA_COOKIE}=${area}; path=/; max-age=31536000; SameSite=Lax`;
}
