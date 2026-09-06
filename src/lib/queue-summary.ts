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
  //
  // Prompt 576 Fase 4 — submissions/claims/identity gained their own oldest
  // reads here (identity's via created_at on the 3 selects it already made
  // for internal-filtering, no new round trip) so groupIntoReviewCards below
  // can show "oldest" honestly on all 6 landing cards, not just the 3 that
  // happened to have it already.
  const [
    contribs, contribOldest,
    candidatesVisible, candidatesInternal, candidatesOldest,
    submissions, submissionsOldest, claims, claimsOldest,
    identitySelfDeclared, identityDocuments, identityClaims,
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
    admin.from('investor_submissions').select('created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(1),
    admin.from('profile_claims').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('profile_claims').select('created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(1),
    // Prompt 573 §A.1/§C — "Investor identity" counts undecided rows across
    // its 3 real origins (self-declared firm, uploaded document, claim on
    // an existing firm), not documents alone — that was the old, narrower
    // definition. Fetches rows rather than a head-count: "is this internal"
    // lives on matchdeal_investor_members, one join away, which a head+count
    // query can't filter on directly; these sets are small (single digits
    // today), so filtering in JS costs nothing real.
    admin.from('catalog_entities').select('id, created_at, matchdeal_investor_members(is_internal)').in('source', ['investor_added', 'self_declared_individual']).eq('verification_status', 'pending'),
    admin.from('investor_verification_documents').select('id, created_at, catalog_entities(matchdeal_investor_members(is_internal))').eq('status', 'pending_review'),
    admin.from('investor_entity_claims').select('id, created_at').eq('status', 'pending'),

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
  const selfDeclaredRows = (identitySelfDeclared.data ?? []) as unknown as { id: string; created_at: string; matchdeal_investor_members: { is_internal: boolean }[] | { is_internal: boolean } | null }[];
  const documentRows = (identityDocuments.data ?? []) as unknown as { id: string; created_at: string; catalog_entities: { matchdeal_investor_members: { is_internal: boolean }[] | { is_internal: boolean } | null }[] | { matchdeal_investor_members: { is_internal: boolean }[] | { is_internal: boolean } | null } | null }[];
  const identityClaimRows = (identityClaims.data ?? []) as unknown as { id: string; created_at: string }[];
  const selfDeclaredHidden = selfDeclaredRows.filter((r) => anyInternal(r.matchdeal_investor_members)).length;
  const documentsHidden = documentRows.filter((r) => {
    const ce = Array.isArray(r.catalog_entities) ? r.catalog_entities[0] : r.catalog_entities;
    return anyInternal(ce?.matchdeal_investor_members);
  }).length;
  // A claim's whole point is an EXTERNAL person asserting ownership — there
  // is no "internal" concept for a fresh claimant to hide behind.
  const identityVisible = (selfDeclaredRows.length - selfDeclaredHidden) + (documentRows.length - documentsHidden) + identityClaimRows.length;
  const identityHidden = selfDeclaredHidden + documentsHidden;
  // Prompt 576 Fase 4 — oldest across the same 3 origins the count already
  // unions, restricted to the same visible (non-internal) rows so a card
  // never dates itself off a row it is also hiding.
  const identityOldestAt = [
    ...selfDeclaredRows.filter((r) => !anyInternal(r.matchdeal_investor_members)),
    ...documentRows.filter((r) => {
      const ce = Array.isArray(r.catalog_entities) ? r.catalog_entities[0] : r.catalog_entities;
      return !anyInternal(ce?.matchdeal_investor_members);
    }),
    ...identityClaimRows,
  ].map((r) => r.created_at).filter(Boolean).sort()[0];

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
    {
      key: 'submissions', count: submissions.count ?? 0,
      oldestDays: daysSince((submissionsOldest.data ?? [])[0]?.created_at as string),
    },
    {
      key: 'claims', count: claims.count ?? 0,
      oldestDays: daysSince((claimsOldest.data ?? [])[0]?.created_at as string),
    },
    { key: 'identity', count: identityVisible, hiddenInternal: identityHidden, oldestDays: daysSince(identityOldestAt) },
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

// Prompt 576 Fase 4 — the Review landing's 6 cards, one per sidebar shortcut
// (BackofficeShell's own Review group, Fase 1). Grouping lives here, not in
// the sidebar or the board, so both read the same fusion — the raw-row board
// (QueueTriageBoard's existing callers) and this grouped one are two VIEWS
// of getQueueSummaryRows(), never two definitions of it.
export const REVIEW_CARD_LABELS: Record<string, string> = {
  new_investors: 'New investors',
  contributions: 'Contributions',
  identity: 'Investor identity',
  claims: 'Person claims',
  gdpr: 'GDPR',
  trust_safety: 'Trust & safety',
  // Prompt 598 §A — these three existed ONLY as tabs on the Queue page, so
  // once that tab bar went away they had no route in at all, and they never
  // had a badge anywhere either. "All queues" is now the one board that
  // shows every queue, so they belong on it. Their counts stay null
  // ("counted when opened", see the header) — which also keeps them out of
  // the collapsed All-clear block, since not knowing isn't zero.
  key_people: 'Key people',
  community: 'Contributions — by users',
  competitor_intel: 'Competitor intel',
};

function sumKnown(...vals: (number | null | undefined)[]): number | null {
  return vals.some((v) => v === null || v === undefined) ? null : (vals as number[]).reduce((s, v) => s + v, 0);
}

// Prompt 872 §A — the oldest item across two fused queues is whichever ONE
// item has waited longest, i.e. the larger of the two ages (oldestDays is
// an age: daysSince the oldest created_at, so bigger = older). Named
// maxKnown, not minKnown, on purpose — a previous version of this file had
// it backwards: candidates=30d/submissions=4d read "oldest: 4 days" while a
// month-old item waited, exactly the "wrong number reads as more true than
// a dash" mistake sumKnown exists to avoid, just on the wrong field.
function maxKnown(...vals: (number | null | undefined)[]): number | null {
  const known = vals.filter((v): v is number => v !== null && v !== undefined);
  return known.length ? Math.max(...known) : null;
}

/**
 * Same null discipline as the header above, applied to a SUM: a card whose
 * parts are not all known does not get to claim a number, because a wrong
 * number reads as more true than a dash. Trust & safety is the concrete
 * case — `community` is always null here (its real count needs its own
 * tab), so the fused card always shows "Counted when opened" rather than
 * quietly reporting suspicious+fraud and calling it complete.
 */
export function groupIntoReviewCards(rows: QueueSummaryRow[]): QueueSummaryRow[] {
  const by = (key: string) => rows.find((r) => r.key === key);
  const candidates = by('candidates');
  const submissions = by('submissions');
  const contributions = by('contributions');
  const identity = by('identity');
  const claims = by('claims');
  const gdpr = by('gdpr');
  const suspicious = by('suspicious');
  const fraud = by('fraud');
  const community = by('community');
  // Prompt 872 §B — the same null discipline as count, applied to oldest:
  // today community never carries an age either, so this is a no-op (count
  // is already null whenever oldest would be too), but the rule is the
  // safeguard, not the coincidence — if community ever gains a real
  // oldestDays without gaining a real count, this keeps the card from
  // claiming an "oldest" that only ever covered two of its three sources.
  const trustSafetyCount = sumKnown(suspicious?.count, fraud?.count, community?.count);

  return [
    {
      key: 'new_investors',
      count: sumKnown(candidates?.count, submissions?.count),
      hiddenInternal: candidates?.hiddenInternal,
      oldestDays: maxKnown(candidates?.oldestDays, submissions?.oldestDays),
    },
    { key: 'contributions', count: contributions?.count ?? null, oldestDays: contributions?.oldestDays },
    { key: 'identity', count: identity?.count ?? null, hiddenInternal: identity?.hiddenInternal, oldestDays: identity?.oldestDays },
    { key: 'claims', count: claims?.count ?? null, oldestDays: claims?.oldestDays },
    { key: 'gdpr', count: gdpr?.count ?? null, oldestDays: gdpr?.oldestDays, slaDueInDays: gdpr?.slaDueInDays },
    {
      key: 'trust_safety',
      count: trustSafetyCount,
      oldestDays: trustSafetyCount !== null ? maxKnown(suspicious?.oldestDays, fraud?.oldestDays) : null,
    },
    // Prompt 598 §A — passed straight through, no fusion: each is already
    // its own queue, and each reports count null because only its own tab
    // can count it. They're here so "All queues" is genuinely all of them
    // now that the tab bar is gone.
    { key: 'key_people', count: by('key_people')?.count ?? null },
    { key: 'community', count: by('community')?.count ?? null },
    { key: 'competitor_intel', count: by('competitor_intel')?.count ?? null },
  ];
}
