// Prompt 923 — the role decision and the "hats" an account can wear, pulled out of supabase-server.ts so the pages, the post-login router and the tests can import it without the server-only client.
// The precedence is the one documented in supabase-server.ts (Prompt 680/682/587/I-01): platform_admins > org_members (founder) > incubator > approved claim > investor membership > access grant > @ablute.pt > pending claim.
import type { Role } from './supabase';

export interface RoleSignals {
  isPlatformAdmin: boolean;
  hasOpenFounderOrg: boolean;
  hasActiveIncubatorMembership: boolean;
  hasApprovedClaim: boolean;
  hasActiveInvestorMembership: boolean;
  hasAccessGrant: boolean;
  isAbluteTeamEmailConfirmed: boolean;
  hasPendingClaim: boolean;
}

export function decideRole(signals: RoleSignals): Role {
  if (signals.isPlatformAdmin) return 'developer';
  if (signals.hasOpenFounderOrg) return 'founder';
  if (signals.hasActiveIncubatorMembership) return 'incubator';
  if (signals.hasApprovedClaim) return 'investor';
  if (signals.hasActiveInvestorMembership) return 'investor';
  if (signals.hasAccessGrant) return 'investor';
  if (signals.isAbluteTeamEmailConfirmed) return 'developer';
  if (signals.hasPendingClaim) return 'investor_pending';
  return 'none';
}

// Prompt I-01 — which workspaces this user can open, independent of which
// one decideRole() picks as the landing. Feeds the hat switcher (B.4).
export interface Hats { founder: boolean; incubator: boolean; investor: boolean }

export function hatsFromSignals(signals: RoleSignals): Hats {
  return {
    founder: signals.hasOpenFounderOrg,
    incubator: signals.hasActiveIncubatorMembership,
    investor: signals.hasApprovedClaim || signals.hasActiveInvestorMembership || signals.hasAccessGrant,
  };
}
