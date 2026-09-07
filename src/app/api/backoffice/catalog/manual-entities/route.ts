// Prompt 187 §A — "Added by startups": every entities row any org's founder
// added by hand (source='manual'), across ALL orgs — the cross-org listing
// that never existed before this prompt.
//
// Prompt 570 §D.4 — rewritten around three changes.
//
// (1) It reads the stored decision instead of recomputing one. The queue used
// to call findLikelyCatalogMatch on every request, which is why 751 rows kept
// reappearing after merges: the list was derived from the data, not from
// catalog_review_status. The reconcile (§D.3) now writes `linked` /
// `probable_match` / `pending` and fills entities.catalog_id, and this route
// serves what is stored. 692 of the 751 became `linked` and leave the queue
// entirely; 57 remain as `probable_match`, which is a choice between two named
// firms rather than a blank review.
//
// (2) Server-side pagination, sorting and filters, so QueueTable (§C) can page
// through without holding the whole table in the browser.
//
// (3) The heavy per-row detail (HQ, geographies, stage, sectors, thesis,
// contacts) still ships, but the table no longer renders it — it moved to the
// expand panel, because five stacked values per cell made every row five lines
// tall.
//
// Prompt 572 §B — "New investors" merges two sources into ONE queue+response
// rather than two tabs: this route's own `entities` candidates, plus
// investor_submissions (previously served by /api/backoffice/submissions,
// which stays for backward-compat but is no longer linked from the sidebar).
// Sorting/paging happens over the MERGED, already-shaped set — a submission
// sorted by "Added when" has to interleave with candidates, not trail behind
// them as a second page.
//
// created_by (migration 0318) is now on entities — "Added by (org +
// utilizador)" resolves it via auth.admin.getUserById the same way
// audit-log/route.ts already does. investor_submissions has no equivalent
// column (checked against the live schema) — those rows show the org only,
// same "don't invent an author" rule §B.2 states for entities' own pre-572 rows.
//
// Demand (§B.3) — cross-org name/domain dedup, via catalog-dedupe.ts's own
// normalizeName/normalizeDomain (not a second algorithm): computed over the
// WHOLE merged set before pagination, so "3 orgs" counts every org that added
// something resolving to the same normalized identity, not just the current
// page. The "replied" and "wave" sub-signals from §B.3's own text are NOT
// included in this pass — they need a join against `interactions`/`entities.wave`
// per matched cluster that didn't fit this change's scope; flagged, not silently
// dropped.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { manualEntityCompleteness } from '@/lib/completeness';
import { normalizeName, normalizeDomain } from '@/lib/catalog-dedupe';

const OPEN_STATUSES = ['pending', 'probable_match'] as const;
const DECIDED_STATUSES = ['linked', 'merged', 'promoted', 'dismissed'] as const;
const SUBMISSION_OPEN = ['pending_review'];
const SUBMISSION_DECIDED = ['approved', 'rejected', 'merged'];

const SORT_COLUMNS: Record<string, string> = {
  investor: 'name',
  added: 'created_at',
  match: 'catalog_review_status',
};
interface UnifiedRow {
  id: string; kind: 'candidate' | 'submission';
  orgId: string; orgName: string; orgIsInternal: boolean;
  addedByEmail: string | null;
  name: string; website: string | null; grade: string; createdAt: string;
  status: string;
  hasContact: boolean;
  catalogMatch: { id: string; name: string; website: string | null; verificationStatus: string } | null;
  demand: number;
  detail: {
    hqCity: string | null; hqCountry: string | null; geographies: string[];
    stageMin: string | null; stageMax: string | null; checkMinEur: number | null; checkMaxEur: number | null;
    sectors: string[]; thesis: string | null; email: string | null; phone: string | null;
    contacts: { id: string; fullName: string; role: string | null; email: string | null; linkedinUrl: string | null; phone: string | null }[];
    // Submission-only fields, absent for candidates.
    submissionPayload?: { name: string; type: string; hq_city?: string; hq_country?: string; sectors: string[]; website?: string; notes?: string };
  };
}

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Math.floor(Number(searchParams.get('page')) || 1));
  const size = [25, 50, 100].includes(Number(searchParams.get('size'))) ? Number(searchParams.get('size')) : 25;
  const sortKey = SORT_COLUMNS[searchParams.get('sort') ?? ''] ?? 'created_at';
  const ascending = searchParams.get('dir') === 'asc';
  const showResolved = searchParams.get('resolved') === 'show';
  const hideInternal = searchParams.get('internal') !== 'shown';

  const { data: orgs } = await admin.from('orgs').select('id, name, is_internal');
  const orgById = new Map((orgs ?? []).map((o) => [o.id as string, o]));
  const internalOrgIds = (orgs ?? []).filter((o) => o.is_internal).map((o) => o.id as string);

  const statuses = showResolved ? [...OPEN_STATUSES, ...DECIDED_STATUSES] : [...OPEN_STATUSES];
  const submissionStatuses = showResolved ? [...SUBMISSION_OPEN, ...SUBMISSION_DECIDED] : [...SUBMISSION_OPEN];

  let entityQ = admin.from('entities')
    .select('id, org_id, name, website, hq_city, hq_country, invests_in_geographies, stage_min, stage_max, check_min_eur, check_max_eur, sectors, thesis, email, phone, created_at, catalog_review_status, catalog_id, created_by')
    .eq('source', 'manual')
    .in('catalog_review_status', statuses);
  if (hideInternal && internalOrgIds.length) entityQ = entityQ.not('org_id', 'in', `(${internalOrgIds.join(',')})`);

  let submissionQ = admin.from('investor_submissions')
    .select('id, org_id, payload, status, created_at, merged_catalog_id')
    .in('status', submissionStatuses);
  if (hideInternal && internalOrgIds.length) submissionQ = submissionQ.not('org_id', 'in', `(${internalOrgIds.join(',')})`);

  const [{ data: entityRows, error: entityErr }, { data: submissionRows, error: subErr }, hiddenRes] = await Promise.all([
    entityQ,
    submissionQ,
    hideInternal && internalOrgIds.length
      ? admin.from('entities').select('id', { count: 'exact', head: true })
          .eq('source', 'manual').in('catalog_review_status', statuses).in('org_id', internalOrgIds)
      : Promise.resolve({ count: 0 }),
  ]);
  if (entityErr) return NextResponse.json({ ok: false, error: entityErr.message }, { status: 500 });
  if (subErr) return NextResponse.json({ ok: false, error: subErr.message }, { status: 500 });

  const ids = (entityRows ?? []).map((r) => r.id as string);
  const catalogIds = [...new Set([
    ...(entityRows ?? []).map((r) => r.catalog_id).filter(Boolean),
    ...(submissionRows ?? []).map((r) => r.merged_catalog_id).filter(Boolean),
  ])] as string[];
  const createdByIds = [...new Set((entityRows ?? []).map((r) => r.created_by).filter(Boolean))] as string[];

  const [{ data: peopleRows }, { data: catalogRows }, emailPairs] = await Promise.all([
    ids.length
      ? admin.from('people').select('id, entity_id, full_name, role, linkedin_url, email_verified, email_guess, phone').in('entity_id', ids)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    catalogIds.length
      ? admin.from('catalog_entities').select('id, name, website, verification_status').in('id', catalogIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    Promise.all(createdByIds.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      return [id, data?.user?.email ?? null] as const;
    })),
  ]);
  const emailById = new Map(emailPairs);

  const catalogById = new Map((catalogRows ?? []).map((c) => [c.id as string, c]));
  const contactsByEntity = new Map<string, UnifiedRow['detail']['contacts']>();
  for (const p of peopleRows ?? []) {
    const entityId = p.entity_id as string;
    contactsByEntity.set(entityId, [...(contactsByEntity.get(entityId) ?? []), {
      id: p.id as string, fullName: p.full_name as string, role: p.role as string | null,
      email: (p.email_verified as string | null) ?? (p.email_guess as string | null),
      linkedinUrl: p.linkedin_url as string | null, phone: p.phone as string | null,
    }]);
  }

  const candidateRows: UnifiedRow[] = (entityRows ?? []).map((m) => {
    const org = orgById.get(m.org_id as string);
    const match = m.catalog_id ? catalogById.get(m.catalog_id as string) ?? null : null;
    const contacts = contactsByEntity.get(m.id as string) ?? [];
    const { grade } = manualEntityCompleteness({
      website: m.website as string | null, hqCity: m.hq_city as string | null, hqCountry: m.hq_country as string | null,
      geographies: (m.invests_in_geographies ?? []) as string[],
      stageMin: m.stage_min as string | null, stageMax: m.stage_max as string | null,
      checkMinEur: m.check_min_eur as number | null, checkMaxEur: m.check_max_eur as number | null,
      sectors: (m.sectors ?? []) as string[], contactCount: contacts.length,
    });
    return {
      id: m.id as string, kind: 'candidate', orgId: m.org_id as string, orgName: org?.name ?? '(deleted org)', orgIsInternal: !!org?.is_internal,
      addedByEmail: m.created_by ? emailById.get(m.created_by as string) ?? null : null,
      name: m.name as string, website: m.website as string | null, grade, createdAt: m.created_at as string,
      status: m.catalog_review_status as string,
      hasContact: contacts.length > 0 || !!m.email || !!m.phone,
      catalogMatch: match ? { id: match.id as string, name: match.name as string, website: match.website as string | null, verificationStatus: match.verification_status as string } : null,
      demand: 1,
      detail: {
        hqCity: m.hq_city as string | null, hqCountry: m.hq_country as string | null, geographies: (m.invests_in_geographies ?? []) as string[],
        stageMin: m.stage_min as string | null, stageMax: m.stage_max as string | null, checkMinEur: m.check_min_eur as number | null, checkMaxEur: m.check_max_eur as number | null,
        sectors: (m.sectors ?? []) as string[], thesis: m.thesis as string | null, email: m.email as string | null, phone: m.phone as string | null, contacts,
      },
    };
  });

  const submissionUnified: UnifiedRow[] = (submissionRows ?? []).map((s) => {
    const org = orgById.get(s.org_id as string);
    const payload = s.payload as UnifiedRow['detail']['submissionPayload'];
    const match = s.merged_catalog_id ? catalogById.get(s.merged_catalog_id as string) ?? null : null;
    const { grade } = manualEntityCompleteness({
      website: payload?.website ?? null, hqCity: payload?.hq_city ?? null, hqCountry: payload?.hq_country ?? null,
      geographies: [], stageMin: null, stageMax: null, checkMinEur: null, checkMaxEur: null,
      sectors: payload?.sectors ?? [], contactCount: 0,
    });
    return {
      id: s.id as string, kind: 'submission', orgId: s.org_id as string, orgName: org?.name ?? '(deleted org)', orgIsInternal: !!org?.is_internal,
      addedByEmail: null, // investor_submissions has no submitter column — org only, same rule as pre-572 entities rows
      name: payload?.name ?? '(untitled)', website: payload?.website ?? null, grade, createdAt: s.created_at as string,
      status: s.status as string,
      hasContact: false,
      catalogMatch: match ? { id: match.id as string, name: match.name as string, website: match.website as string | null, verificationStatus: match.verification_status as string } : null,
      demand: 1,
      detail: {
        hqCity: payload?.hq_city ?? null, hqCountry: payload?.hq_country ?? null, geographies: [],
        stageMin: null, stageMax: null, checkMinEur: null, checkMaxEur: null,
        sectors: payload?.sectors ?? [], thesis: payload?.notes ?? null, email: null, phone: null, contacts: [],
        submissionPayload: payload,
      },
    };
  });

  const merged = [...candidateRows, ...submissionUnified];

  // Demand (§B.3, "N orgs" only — see header comment for the two sub-signals
  // deliberately not included) — computed over the WHOLE merged set, before
  // paging, using catalog-dedupe.ts's own normalizers so this can never
  // disagree with the reconcile job that uses the same functions.
  const keyOf = (r: UnifiedRow) => normalizeDomain(r.website) ?? (normalizeName(r.name) || null);
  const orgsByKey = new Map<string, Set<string>>();
  for (const r of merged) {
    const key = keyOf(r);
    if (!key) continue;
    if (!orgsByKey.has(key)) orgsByKey.set(key, new Set());
    orgsByKey.get(key)!.add(r.orgId);
  }
  for (const r of merged) {
    const key = keyOf(r);
    r.demand = key ? (orgsByKey.get(key)?.size ?? 1) : 1;
  }

  const minGrade = searchParams.get('grade');
  const filtered = minGrade && minGrade !== 'all' ? merged.filter((r) => r.grade.localeCompare(minGrade) <= 0) : merged;

  const sortField = searchParams.get('sort') ?? '';
  const sorted = sortField === 'grade'
    ? [...filtered].sort((a, b) => (ascending ? 1 : -1) * (b.grade.localeCompare(a.grade) || a.createdAt.localeCompare(b.createdAt)))
    : sortField === 'demand'
      ? [...filtered].sort((a, b) => (ascending ? 1 : -1) * (a.demand - b.demand))
      : [...filtered].sort((a, b) => {
          const av = sortKey === 'name' ? a.name : sortKey === 'catalog_review_status' ? a.status : a.createdAt;
          const bv = sortKey === 'name' ? b.name : sortKey === 'catalog_review_status' ? b.status : b.createdAt;
          return (ascending ? 1 : -1) * String(av).localeCompare(String(bv));
        });

  const from = (page - 1) * size;
  return NextResponse.json({
    ok: true,
    manualEntities: sorted.slice(from, from + size),
    total: sorted.length,
    hiddenInternal: (hiddenRes as { count?: number }).count ?? 0,
  });
}
