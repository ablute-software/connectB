// Prompt 570 §B, extracted Prompt 576 Fase 2 — every queue's undecided
// count, in one place. Originally lived inline in
// /api/backoffice/queue/summary/route.ts; pulled out so Attention's Review
// row badges (New investors, Contributions, Investor identity, Person
// claims, Trust & safety) cite this exact computation, never a second one
// that could drift from what the sidebar and the Queue board itself show.
//
// Two rules the counts follow, and both matter more than the total:
//
// UNDECIDED, not historical. `contributions` holds 734 rows and 4 of them are
// still submitted; a card reading 734 would be true and useless. Every count
// here is "how many decisions are waiting".
//
// HONEST ABOUT WHAT IT DOES NOT KNOW. Three queues are computed rather than
// stored — domain mismatch is derived live from entities, key-people promotion
// and competitor intel each have their own assembly. Reimplementing them here
// would create a second definition that can drift from the tab's own, which is
// the failure this codebase has paid for repeatedly. Domain mismatch reuses the
// SAME lib the tab uses, so there is only one definition. The other two return
// null — never folded into "All clear", because not knowing is not the same as
// zero.
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasDomainMismatch } from './domain-mismatch';
import { gdprDueAt } from './gdpr';

export interface QueueSummaryRow {
  key: string;
  /** Decisions waiting. null = computed elsewhere, see the header. */
  count: number | null;
  /** Hidden by the internal filter, so the board can print it. */
  hiddenInternal?: number;
  /** Age in days of the oldest undecided item, when the source records one. */
  oldestDays?: number | null;
  /** Days until the soonest deadline. Only GDPR has one today. */
  slaDueInDays?: number | null;
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export async function getQueueSummaryRows(admin: SupabaseClient): Promise<QueueSummaryRow[]> {
  const { data: orgs } = await admin.from('orgs').select('id, is_internal');
  const internalOrgIds = (orgs ?? []).filter((o) => o.is_internal).map((o) => o.id as string);

  // One round trip per source, in parallel. head+count means the rows never
  // travel; only the oldest-timestamp reads pull a row, and only one.
  const [
    contribs, contribOldest,
    candidatesVisible, candidatesInternal, candidatesOldest,
    submissions, claims, identitySelfDeclared, identityDocuments, identityClaims,
    gdpr, gdprOldest, suspicious, fraud,
    entitiesForMismatch,
  ] = await Promise.all([
    admin.from('contributions').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    admin.from('contributions').select('created_at').eq('status', 'submitted').order('created_at', { ascending: true }).limit(1),

    // Candidates carry the internal split, because 751 of them are ours.
    internalOrgIds.length
      ? admin.from('entities').select('id', { count: 'exact', head: true }).eq('source', 'manual')
          .in('catalog_review_status', ['pending', 'probable_match']).not('org_id', 'in', `(${internalOrgIds.join(',')})`)
      : admin.from('entities').select('id', { count: 'exact', head: true }).eq('source', 'manual')
          .in('catalog_review_status', ['pending', 'probable_match']),
    internalOrgIds.length
      ? admin.from('entities').select('id', { count: 'exact', head: true }).eq('source', 'manual')
          .in('catalog_review_status', ['pending', 'probable_match']).in('org_id', internalOrgIds)
      : Promise.resolve({ count: 0 }),
    admin.from('entities').select('created_at').eq('source', 'manual')
      .in('catalog_review_status', ['pending', 'probable_match']).order('created_at', { ascending: true }).limit(1),

    admin.from('investor_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('profile_claims').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    // Prompt 573 §A.1/§C — "Investor identity" counts undecided rows across
    // its 3 real origins (self-declared firm, uploaded document, claim on
    // an existing firm), not documents alone — that was the old, narrower
    // definition. Fetches rows rather than a head-count: "is this internal"
    // lives on matchdeal_investor_members, one join away, which a head+count
    // query can't filter on directly; these sets are small (single digits
    // today), so filtering in JS costs nothing real.
    admin.from('catalog_entities').select('id, matchdeal_investor_members(is_internal)').in('source', ['investor_added', 'self_declared_individual']).eq('verification_status', 'pending'),
    admin.from('investor_verification_documents').select('id, catalog_entities(matchdeal_investor_members(is_internal))').eq('status', 'pending_review'),
    admin.from('investor_entity_claims').select('id').eq('status', 'pending'),

    admin.from('gdpr_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('gdpr_requests').select('created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(1),
    admin.from('suspicious_account_flags').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    admin.from('entity_fraud_flags').select('id', { count: 'exact', head: true }).eq('status', 'open'),

    admin.from('entities').select('id, website, email_domain'),
  ]);

  // A row with no linked member at all (shouldn't happen given the two
  // write paths that create these, but never assumed) counts as NOT
  // internal — hiding it silently would be worse than showing it once.
  const anyInternal = (members: { is_internal: boolean }[] | { is_internal: boolean } | null | undefined): boolean => {
    const list = Array.isArray(members) ? members : members ? [members] : [];
    return list.length > 0 && list.every((m) => m.is_internal);
  };
  const selfDeclaredRows = (identitySelfDeclared.data ?? []) as unknown as { id: string; matchdeal_investor_members: { is_internal: boolean }[] | { is_internal: boolean } | null }[];
  const documentRows = (identityDocuments.data ?? []) as unknown as { id: string; catalog_entities: { matchdeal_investor_members: { is_internal: boolean }[] | { is_internal: boolean } | null }[] | { matchdeal_investor_members: { is_internal: boolean }[] | { is_internal: boolean } | null } | null }[];
  const selfDeclaredHidden = selfDeclaredRows.filter((r) => anyInternal(r.matchdeal_investor_members)).length;
  const documentsHidden = documentRows.filter((r) => {
    const ce = Array.isArray(r.catalog_entities) ? r.catalog_entities[0] : r.catalog_entities;
    return anyInternal(ce?.matchdeal_investor_members);
  }).length;
  // A claim's whole point is an EXTERNAL person asserting ownership — there
  // is no "internal" concept for a fresh claimant to hide behind.
  const identityVisible = (selfDeclaredRows.length - selfDeclaredHidden) + (documentRows.length - documentsHidden) + (identityClaims.data ?? []).length;
  const identityHidden = selfDeclaredHidden + documentsHidden;

  // GDPR is the only queue with a deadline today: 30 days from the request.
  // Prompt 574 §A.1 — gdprDueAt is the one shared function now; queue-summary,
  // Attention, and the Queue page's own GdprTab all read the SAME calculation.
  const gdprOldestAt = (gdprOldest.data ?? [])[0]?.created_at as string | undefined;
  const gdprAge = daysSince(gdprOldestAt);
  const slaDueInDays = gdprOldestAt ? gdprDueAt(gdprOldestAt).daysLeft : null;

  const mismatchCount = (entitiesForMismatch.data ?? []).filter((e) =>
    hasDomainMismatch(e.website as string | null, e.email_domain as string | null)).length;

  return [
    { key: 'contributions', count: contribs.count ?? 0, oldestDays: daysSince((contribOldest.data ?? [])[0]?.created_at as string) },
    {
      key: 'candidates', count: candidatesVisible.count ?? 0,
      hiddenInternal: (candidatesInternal as { count?: number }).count ?? 0,
      oldestDays: daysSince((candidatesOldest.data ?? [])[0]?.created_at as string),
    },
    { key: 'submissions', count: submissions.count ?? 0 },
    { key: 'claims', count: claims.count ?? 0 },
    { key: 'identity', count: identityVisible, hiddenInternal: identityHidden },
    { key: 'gdpr', count: gdpr.count ?? 0, oldestDays: gdprAge, slaDueInDays: (gdpr.count ?? 0) > 0 ? slaDueInDays : null },
    { key: 'domain_mismatch', count: mismatchCount },
    { key: 'suspicious', count: suspicious.count ?? 0 },
    { key: 'fraud', count: fraud.count ?? 0 },
    // Counted when opened — see the header for why they are not reimplemented.
    { key: 'key_people', count: null },
    { key: 'community', count: null },
    { key: 'competitor_intel', count: null },
  ];
}
