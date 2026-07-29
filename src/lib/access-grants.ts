// Grant Access rebuild (prompt 33 part 2, decision 2026-07-29 #1) — status
// is derived from the existing nullable-timestamp columns on access_grants,
// never a stored enum. Same reasoning as promo.ts's benefitStillActive /
// isRedemptionCurrentlyActive: revoked_at, nda_accepted_at and expires_at
// were already all nullable timestamps on this table, never an enum —
// staying consistent costs nothing and a computed status can't drift out of
// sync with the facts it's derived from.
//
// Backward compatibility is structural, not a special case: invited_email
// is null for every grant that predates migration 0045 and for every grant
// a founder still creates by hand today — grantStatus never returns
// 'pending_confirmation' for those, only for a grant actually born through
// the new founder-invite flow (see the migration's own comment).
export type GrantStatus = 'pending_confirmation' | 'active' | 'revoked' | 'expired';

export interface GrantStatusInput {
  invited_email?: string | null;
  confirmed_at?: string | null;
  revoked_at?: string | null;
  expires_at?: string | null;
}

export function grantStatus(g: GrantStatusInput, now: Date): GrantStatus {
  if (g.revoked_at) return 'revoked';
  if (g.expires_at && new Date(g.expires_at) <= now) return 'expired';
  if (g.invited_email && !g.confirmed_at) return 'pending_confirmation';
  return 'active';
}

export function grantIsActive(g: GrantStatusInput, now: Date): boolean {
  return grantStatus(g, now) === 'active';
}
