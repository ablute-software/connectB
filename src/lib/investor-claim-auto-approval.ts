// Prompt 904 Part C — the "may this claim be approved right now, and if so do it" decision of
// POST /api/portal/claims, extracted so the route and the end-to-end seat tests run the SAME code.
// Notifications, audit and the claim row itself stay in the route (they differ per caller).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyClaimApproval } from './investor-entity-claims';
import { decideClaimOnPlannedFirm, type ClaimSeatDecision } from './investor-firm-seats';
import { makeSeatStore } from './investor-firm-seats-store';
import { checkSeatAvailable } from './investor-seats';

export interface ClaimClassification {
  planned: ClaimSeatDecision;
  /** The firm has a custom seat plan. */
  isPlanned: boolean;
  /** Someone else already owns the profile, on a firm WITHOUT a plan (the legacy "dispute"). */
  isDispute: boolean;
}

/**
 * On a firm with a custom plan, several people of the same firm are meant to be seated, so a second
 * claimant is not a "dispute" (it used to park claim 2..N in pending whatever the seat count said).
 * A firm without a plan keeps the dispute rule untouched.
 */
export async function classifyClaim(admin: SupabaseClient, args: {
  entityId: string; userId: string; email: string; domainMatch: boolean; approvedClaimCount: number;
}): Promise<ClaimClassification> {
  const planned = await decideClaimOnPlannedFirm(makeSeatStore(admin), {
    entityId: args.entityId, email: args.email, domainMatch: args.domainMatch, userId: args.userId,
  });
  const isPlanned = planned.reason !== 'no_plan';
  return { planned, isPlanned, isDispute: args.approvedClaimCount > 0 && !isPlanned };
}

/** Approve the claim now when the rules allow it and a seat is free. True when it was approved. */
export async function autoApproveClaimIfEligible(admin: SupabaseClient, args: {
  claimId: string; entityId: string; userId: string; email: string; requestedRole: string | null;
  domainMatch: boolean; classification: ClaimClassification;
}): Promise<boolean> {
  const { planned, isPlanned, isDispute } = args.classification;
  const eligible = isPlanned ? planned.autoApprove : (args.domainMatch && !isDispute);
  if (!eligible) return false;
  const seat = await checkSeatAvailable(admin, args.entityId, args.userId, args.email);
  if (!seat.allowed) return false;
  const applied = await applyClaimApproval(admin, {
    claimId: args.claimId, catalogEntityId: args.entityId, claimantUserId: args.userId,
    requestedRole: args.requestedRole, resolvedBy: null, verificationMethod: planned.consumesInvite ? 'manual' : 'domain',
    claimantEmail: args.email,
  });
  return applied.ok;
}
