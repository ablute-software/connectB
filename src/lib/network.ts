// Prompt 316 — My Network 1/9. Pure, mechanical rules only — same discipline
// as company-claims.ts/company-gaps.ts: nothing here calls out to a
// database or an AI model, so every rule is independently testable and
// gives the same answer twice on the same input.
//
// Two structural rules apply to the WHOLE 316-324 series, not just this
// file:
//   - Anti-spam: no connection without verifiable context — there is no
//     free-text people search anywhere in this feature.
//   - Anti-ranking: nothing here ever produces a value one founder could be
//     ranked or compared against another founder by.

export const MAX_PENDING_INVITES_PER_ACTOR = 5;
export const INVITE_EXPIRY_DAYS = 14;

// ---------------------------------------------------------------------------
// Canonical pair ordering for network_connections' "smaller id first"
// storage convention — one row per pair regardless of who acted first.
export function canonicalPair(actorAId: string, actorBId: string): [string, string] {
  return actorAId < actorBId ? [actorAId, actorBId] : [actorBId, actorAId];
}

// ---------------------------------------------------------------------------
// The pending-invite cap. The real enforcement lives server-side in the DB
// trigger (enforce_network_invite_pending_cap, migration 0209) — this is
// the same rule expressed as a pure predicate, so the API route can give a
// clear error BEFORE attempting the insert, and so the rule itself is
// unit-testable without a database.
export function canSendInvite(pendingCount: number): boolean {
  return pendingCount < MAX_PENDING_INVITES_PER_ACTOR;
}

// ---------------------------------------------------------------------------
// "Silêncio = expira, nunca vira rejeição visível": rather than requiring a
// cron to flip the stored status (this app has no sub-daily cron capacity
// on Vercel Hobby — see CLAUDE.md), expiry is computed at read time. A
// 'pending' invite past its expires_at reads as 'expired' everywhere the
// app looks at it; the stored column only ever changes on an explicit
// accept/decline.
export function effectiveInviteStatus(
  invite: { status: 'pending' | 'accepted' | 'declined' | 'expired'; expiresAt: string },
  now: Date,
): 'pending' | 'accepted' | 'declined' | 'expired' {
  if (invite.status === 'pending' && new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  return invite.status;
}

// ---------------------------------------------------------------------------
// Shared-investor suggestions (Prompt 316 §B). The DB adapter
// (network-db.ts) reads WIDE, unfiltered rows — every catalog_deliveries
// row joined to its entity's status and the delivering org's
// network_discoverable flag — and this function applies the actual product
// rules on top, so "no bilateral opt-in -> never suggest" and "no invested
// stage -> never suggest" are each independently testable without a
// database, per the prompt's own required test list.
//
// Deliberately narrow: only catalog-sourced investors match (a shared
// catalog_id is an exact identity; a founder-typed 'manual' entity has no
// canonical id to match against, and fuzzy name-matching across orgs' own
// pipeline text is exactly the kind of general-case problem this codebase
// has repeatedly declined to solve — see company-claims.ts's own findings
// on Prompt 311). A manually-added investor simply never produces a
// suggestion; documented here as the accepted scope, not a bug.
export interface DeliveryRow {
  orgId: string;
  catalogId: string;
  investorName: string;
  entityStatus: string;
  orgDiscoverable: boolean;
}

export interface SharedInvestorSuggestion {
  otherOrgId: string;
  investorName: string;
  catalogId: string;
}

export function computeSharedInvestorSuggestions(rows: DeliveryRow[], viewingOrgId: string): SharedInvestorSuggestion[] {
  const eligible = rows.filter((r) => r.entityStatus === 'invested' && r.orgDiscoverable);
  const mine = eligible.filter((r) => r.orgId === viewingOrgId);
  if (mine.length === 0) return [];

  const suggestions: SharedInvestorSuggestion[] = [];
  const seen = new Set<string>();
  for (const my of mine) {
    for (const other of eligible) {
      if (other.orgId === viewingOrgId || other.catalogId !== my.catalogId) continue;
      const key = `${other.orgId}:${other.catalogId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ otherOrgId: other.orgId, investorName: other.investorName, catalogId: other.catalogId });
    }
  }
  return suggestions;
}
