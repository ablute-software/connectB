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

export function computeIdentityStatus(input: {
  selfDeclaredIndividual: boolean;
  domainVerified: boolean;
  entityVerificationStatus: string | null; // 'verified' | 'pending' | 'rejected' | null (not yet linked)
}): IdentityStatus {
  if (input.selfDeclaredIndividual) return 'self_declared_individual';
  if (input.domainVerified || input.entityVerificationStatus === 'verified') return 'verified';
  return 'pending_verification';
}
