// Prompt 326 — badges/awards with AI-assisted verification. Pure rules
// only; I/O (web search, PDF read, Storage, DB) lives in the API routes
// and company-badges-db.ts, same pure/adapter split as company-gaps.ts.
import { findDuplicateCandidate } from './company-claims';
import type { CompanyClaim } from './types';

export type BadgeVerificationStatus = 'unverified' | 'verified' | 'disputed';

// Pedido B — verified only on real confirmation; disputed only on an
// ACTIVE contradiction the AI found; everything else (including "found
// nothing") stays unverified indefinitely — the founder can ask again
// after attaching more evidence. Never automated escalation, never a
// default-to-verified fallback.
export function resolveBadgeVerification(params: {
  foundCredibleConfirmation: boolean; foundContradiction: boolean; note: string;
}): { status: BadgeVerificationStatus; note: string } {
  if (params.foundContradiction) return { status: 'disputed', note: params.note };
  if (params.foundCredibleConfirmation) return { status: 'verified', note: params.note };
  return { status: 'unverified', note: params.note };
}

// Pedido C — the SAME dedup check the claims engine already runs
// (findDuplicateCandidate, Prompt 311), never a second, disconnected
// heuristic. A badge is modeled as a synthetic evidence_class=5
// ("decoration") claim candidate for exactly this one check — never
// inserted as a real company_claims row itself.
export function findMatchingClaimForBadge(
  badge: { name: string; description: string | null },
  claimsPool: Pick<CompanyClaim, 'id' | 'statement' | 'status' | 'evidenceClass'>[],
): { id: string; statement: string } | null {
  // Description first, name last: extractNamedEntity (company-claims.ts)
  // deliberately skips whatever capitalized word opens the statement (its
  // own documented behavior, inherited from the original claims-engine
  // heuristic) and grabs the FIRST capitalized run after that — a person's
  // or entity's name is far more likely to land there when the free-text
  // description (which usually names who/what, e.g. "Awarded to Carla
  // Dias") comes first and the badge's own short title comes last.
  const statement = [badge.description, badge.name].filter(Boolean).join(' — ');
  return findDuplicateCandidate({ id: 'new-badge', statement, evidenceClass: 5 }, claimsPool);
}

// Pedido E — investor-facing projection. Level 0 recommended: positive,
// non-sensitive claims, same purpose as Prompt 325's intro pitch (a reason
// to click "Interested"). Only verificationStatus + public fields ever
// cross this boundary — verification_note (what the AI found/didn't find,
// which can include the founder's own unresolved discrepancy) and
// evidence_document_id (an internal Vault reference) never do. A
// `disputed` badge is filtered out entirely — that is an active, unresolved
// question mark, not a claim ready to be shown as unverified-but-pending;
// showing it would expose a red flag to an investor before the founder
// even knows to address it.
export interface BadgeForProjection {
  id: string; name: string; description: string | null; year: number | null; verificationStatus: BadgeVerificationStatus;
}
export interface BadgePublic {
  id: string; name: string; description: string | null; year: number | null; verificationStatus: 'unverified' | 'verified';
}

export function projectBadgesForInvestor(badges: BadgeForProjection[]): BadgePublic[] {
  return badges
    .filter((b) => b.verificationStatus !== 'disputed')
    .map((b) => ({
      id: b.id, name: b.name, description: b.description, year: b.year,
      verificationStatus: b.verificationStatus === 'verified' ? 'verified' : 'unverified',
    }));
}
