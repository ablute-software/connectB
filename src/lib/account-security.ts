// Prompt 602 — pure, I/O-free rules for the account-security flows
// (change password, admin-initiated owner reset, close account). The server
// composition lives in account-security-server.ts.

/** §C — how long a closed account stays recoverable on our side (proposed 30 days, accepted). */
export const ACCOUNT_RETENTION_DAYS = 30;

/** §B — the "this wasn't me" link lives 7 days: long enough to be read, short enough not to be a standing key. */
export const NOT_ME_TOKEN_TTL_HOURS = 24 * 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function computePurgeAfter(closedAtIso: string): string {
  return new Date(new Date(closedAtIso).getTime() + ACCOUNT_RETENTION_DAYS * DAY_MS).toISOString();
}

/** Whole days until the retention window ends; 0 once it has passed. */
export function daysUntilPurge(purgeAfterIso: string | null, now: Date): number {
  if (!purgeAfterIso) return 0;
  return Math.max(0, Math.ceil((new Date(purgeAfterIso).getTime() - now.getTime()) / DAY_MS));
}

export interface ClosureState {
  closedAt: string | null;
  closedReason: string | null;
  purgeAfter: string | null;
}

/** §C — "recuperável durante uma janela definida, e ao fim dela passa a irrecuperável pela app". Only an owner's own closure is reopened from the app. */
export function canReopen(org: ClosureState, now: Date): boolean {
  if (!org.closedAt || org.closedReason !== 'owner') return false;
  return !!org.purgeAfter && new Date(org.purgeAfter) > now;
}

/**
 * §C — the written confirmation: the org's name, typed. Case and surrounding
 * or doubled whitespace are forgiven (a name is not a password); a different
 * name is not.
 */
export function orgNameMatches(typed: string, orgName: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const a = norm(typed);
  return a.length > 0 && a === norm(orgName);
}

/** A short, human line for "from where": first IP only, browser family only. */
export function describeOrigin(ip: string | null, userAgent: string | null): string {
  const parts: string[] = [];
  if (ip) parts.push(`IP ${ip.split(',')[0].trim()}`);
  if (userAgent) {
    const ua = userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
      : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : null;
    parts.push(os ? `${browser} on ${os}` : browser);
  }
  return parts.length ? parts.join(', ') : 'an unknown device';
}

export type SecurityEventKind = 'password_changed' | 'owner_reset_initiated' | 'owner_reset_disputed' | 'org_closed' | 'org_reopened';

export const SECURITY_EVENT_LABEL: Record<SecurityEventKind, string> = {
  password_changed: 'Password changed',
  owner_reset_initiated: 'Password reset started by an admin',
  owner_reset_disputed: 'Reset disputed ("this wasn\'t me") — sessions ended',
  org_closed: 'Account closed by the owner',
  org_reopened: 'Account reopened',
};
