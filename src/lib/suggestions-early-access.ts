import 'server-only';
// TEMPORARY (Nuno, 15/09/2026, Prompt 703) — "durante algum tempo" opens
// Suggest an improvement to the first EARLY_ACCESS_COMPANY_LIMIT real
// companies on the platform, founders and investors ranked together by
// creation date, INDEPENDENTLY of holding a tech_master/pioneer badge. This
// is a temporary product decision, not a bug fix (701 fixed the real bug —
// the category dropdown stuck on "Pipeline"); the badge-based gate
// underneath (suggestions-gate.ts) is completely unchanged.
//
// To revert: delete this file and its one call site
// (/api/suggestions/eligibility/route.ts), and drop
// `isAmongFirstCompanies` back out of canSuggest's input in
// suggestions-gate.ts. Nothing else references this file.
//
// "Real" means not is_test — is_internal is deliberately NOT excluded here.
// Its own migration comment (0316) is explicit: is_internal is "read ONLY
// by back-office review queues," never a gate on real behaviour, and on
// this platform today it is set true on almost every account (a 2026-08-23
// backfill default that most rows have simply never been reclassified out
// of — confirmed live: only 1 of 7 real, non-test companies is flagged
// externally reviewed). Excluding it here would silently gut the feature
// down to near-zero eligible accounts, the opposite of what this prompt
// asks for.
//
// "Company" spans two different tables because founders and investors are
// modelled differently (orgs vs. catalog_entities + matchdeal_investor_members
// seats) — see resolveActiveInvestorMember (investor-membership.ts) for the
// same distinction elsewhere. An investor "company" is ranked by the
// EARLIEST active seat on its catalog_entities row, not the catalog row's
// own created_at (which can predate any real signup by months — import/
// enrichment, same reasoning backoffice-metrics.ts's investorOrgRows()
// already uses for "registration date").
import type { SupabaseClient } from '@supabase/supabase-js';

export const EARLY_ACCESS_COMPANY_LIMIT = 100;

export type CompanyKind = 'org' | 'investor';

export interface CompanyCreationRecord {
  kind: CompanyKind;
  /** orgs.id for a founder, catalog_entities.id for an investor firm. */
  id: string;
  createdAt: string;
}

/** Pure — sorts oldest first. Ties (identical timestamp) keep their
 *  relative input order, which is fine here: nothing depends on breaking a
 *  tie a specific way, only on a stable, deterministic ranking. */
export function rankCompaniesByCreation(records: CompanyCreationRecord[]): CompanyCreationRecord[] {
  return [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Pure — is `target` within the first `limit` of an already-ranked list. */
export function isAmongFirstCompanies(
  ranked: CompanyCreationRecord[], target: { kind: CompanyKind; id: string }, limit = EARLY_ACCESS_COMPANY_LIMIT,
): boolean {
  const idx = ranked.findIndex((r) => r.kind === target.kind && r.id === target.id);
  return idx !== -1 && idx < limit;
}

/** The one DB read this whole temporary feature needs: every real (non-test)
 *  founder org, and every real (non-test) investor firm with at least one
 *  active seat, each with its earliest relevant creation timestamp. Small
 *  scale on purpose — this platform has single-digit-to-low-hundreds of real
 *  companies today (confirmed live, Prompt 703's own report), so three plain
 *  queries plus an in-memory group-by is simpler and easier to delete later
 *  than a new SQL function would be. */
export async function loadRealCompanyCreationRecords(admin: SupabaseClient): Promise<CompanyCreationRecord[]> {
  const [{ data: orgRows }, { data: seatRows }, { data: entityRows }] = await Promise.all([
    admin.from('orgs').select('id, created_at').eq('is_test', false),
    admin.from('matchdeal_investor_members').select('catalog_entity_id, created_at').eq('status', 'active'),
    admin.from('catalog_entities').select('id, is_test'),
  ]);

  const orgRecords: CompanyCreationRecord[] = (orgRows ?? []).map((r) => ({
    kind: 'org' as const, id: r.id as string, createdAt: r.created_at as string,
  }));

  const testEntityIds = new Set((entityRows ?? []).filter((e) => e.is_test).map((e) => e.id as string));
  const earliestSeatByEntity = new Map<string, string>();
  for (const s of (seatRows ?? [])) {
    const entityId = s.catalog_entity_id as string;
    if (testEntityIds.has(entityId)) continue;
    const createdAt = s.created_at as string;
    const current = earliestSeatByEntity.get(entityId);
    if (!current || createdAt < current) earliestSeatByEntity.set(entityId, createdAt);
  }
  const investorRecords: CompanyCreationRecord[] = [...earliestSeatByEntity.entries()]
    .map(([id, createdAt]) => ({ kind: 'investor' as const, id, createdAt }));

  return rankCompaniesByCreation([...orgRecords, ...investorRecords]);
}
