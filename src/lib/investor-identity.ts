// Investor identity verification, Fase A (prompt 63). Computed at read
// time from matchdeal_investor_members.domain_verified,
// catalog_entities.verification_status, and
// matchdeal_profiles.self_declared_individual — never stored redundantly
// (see migration 0063's header for why).
export type IdentityStatus = 'verified' | 'pending_verification' | 'self_declared_individual';

export const IDENTITY_BADGE_LABEL: Record<IdentityStatus, string> = {
  verified: 'Verified fund',
  pending_verification: 'Pending verification',
  self_declared_individual: 'Individual investor',
};

export const IDENTITY_BADGE_CLASS: Record<IdentityStatus, string> = {
  verified: 'bg-green-50 text-green-700',
  pending_verification: 'bg-amber-50 text-amber-700',
  self_declared_individual: 'bg-gray-100 text-gray-600',
};

// Fase B (prompt 64), Bloco 3 — how many DISTINCT entities need to vouch
// before a self-declared/pending investor's badge reads "Verified fund."
// Proposed 2, per the spec's own suggestion: one is too easy to fabricate
// with a single willing contact, three starts asking a lot of someone
// who's just trying to get their badge sorted — two balances "harder than
// a single sock-puppet" against "not a barrier to a real, sparsely-
// connected investor."
export const VOUCH_THRESHOLD = 2;

export function computeIdentityStatus(input: {
  selfDeclaredIndividual: boolean;
  domainVerified: boolean;
  entityVerificationStatus: string | null; // 'verified' | 'pending' | 'rejected' | null (not yet linked)
  distinctVoucherEntityCount?: number;
}): IdentityStatus {
  // Vouching can upgrade EITHER pending_verification OR
  // self_declared_individual to verified (the prompt says so explicitly:
  // "sobe 'Self-declared'/'Pending' para 'Verified'") — so it has to be
  // checked before the self-declared branch, not after, or a vouched-for
  // BA would never actually see the upgrade. Still purely additive: this
  // never writes to domain_verified or catalog_entities.verification_status,
  // so it can never be confused with or overwrite an official document/
  // domain verification (migration 0064's header).
  if (input.domainVerified || input.entityVerificationStatus === 'verified'
    || (input.distinctVoucherEntityCount ?? 0) >= VOUCH_THRESHOLD) return 'verified';
  if (input.selfDeclaredIndividual) return 'self_declared_individual';
  return 'pending_verification';
}
