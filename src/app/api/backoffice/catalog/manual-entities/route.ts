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
// NOT AVAILABLE, stated rather than faked: the prompt asks for "added by org
// AND user". `entities` has no created_by/user column (checked against the
// live schema), so there is no user to show. The column shows the org, and
// adding the user means a schema change in its own prompt.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { manualEntityCompleteness } from '@/lib/completeness';

const OPEN_STATUSES = ['pending', 'probable_match'] as const;
const DECIDED_STATUSES = ['linked', 'merged', 'promoted', 'dismissed'] as const;

// Prompt 570 §D.4 — Grade is the COMPLETENESS grade, not fit_score. It used to
// be computed in the browser from the fields of whatever rows had been loaded,
// which was fine while the route returned all 751 at once and silently wrong
// the moment pagination arrived: you cannot grade, filter or sort by a value
// you only know for the current page. "Grade A first" would have meant "grade A
// first among these 25", which looks identical and is not the same thing.
//
// So the grade is computed here, over the rows the query selects, and the
// sort/filter happen where the whole set is. Same function the browser used
// (completeness.ts) — not a second definition of what an A is.
const SORT_COLUMNS: Record<string, string> = {
  investor: 'name',
  added: 'created_at',
  match: 'catalog_review_status',
};
/** Sorted in memory, because it is derived rather than stored. */
const DERIVED_SORTS = new Set(['grade']);

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

  // Internal orgs are resolved first: the filter is "who added it", and that
  // lives on orgs, not on the entity.
  const { data: orgs } = await admin.from('orgs').select('id, name, is_internal');
  const orgById = new Map((orgs ?? []).map((o) => [o.id as string, o]));
  const internalOrgIds = (orgs ?? []).filter((o) => o.is_internal).map((o) => o.id as string);

  const statuses = showResolved ? [...OPEN_STATUSES, ...DECIDED_STATUSES] : [...OPEN_STATUSES];

  // The matching set is fetched whole, then graded, sorted and sliced here.
  //
  // That is a deliberate choice, not laziness: Grade is derived, so a DB-side
  // range would make "sort by grade" mean "sort the 25 rows the database
  // happened to return", which is indistinguishable from working. The set is
  // small and bounded — 59 open rows after §D.3's reconcile, 757 even with
  // every resolved row shown — so paging in memory costs nothing and cannot
  // lie. If this ever stops being small, the fix is to store the grade, not
  // to page around it.
  let q = admin.from('entities')
    .select('id, org_id, name, website, hq_city, hq_country, invests_in_geographies, stage_min, stage_max, check_min_eur, check_max_eur, sectors, thesis, email, phone, created_at, catalog_review_status, catalog_id')
    .eq('source', 'manual')
    .in('catalog_review_status', statuses);
  if (hideInternal && internalOrgIds.length) q = q.not('org_id', 'in', `(${internalOrgIds.join(',')})`);

  const [{ data: allRows, error }, hiddenRes] = await Promise.all([
    q.order(DERIVED_SORTS.has(searchParams.get('sort') ?? '') ? 'created_at' : sortKey, { ascending }),
    // What the toggle is hiding, so the table can say it instead of just
    // showing a shorter list.
    hideInternal && internalOrgIds.length
      ? admin.from('entities').select('id', { count: 'exact', head: true })
          .eq('source', 'manual').in('catalog_review_status', statuses)
          .in('org_id', internalOrgIds)
      : Promise.resolve({ count: 0 }),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const ids = (allRows ?? []).map((r) => r.id as string);
  const catalogIds = [...new Set((allRows ?? []).map((r) => r.catalog_id).filter(Boolean))] as string[];

  const [{ data: peopleRows }, { data: catalogRows }] = await Promise.all([
    ids.length
      ? admin.from('people').select('id, entity_id, full_name, role, linkedin_url, email_verified, email_guess, phone').in('entity_id', ids)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    catalogIds.length
      ? admin.from('catalog_entities').select('id, name, website, verification_status').in('id', catalogIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const catalogById = new Map((catalogRows ?? []).map((c) => [c.id as string, c]));
  const contactsByEntity = new Map<string, { id: string; fullName: string; role: string | null; email: string | null; linkedinUrl: string | null; phone: string | null }[]>();
  for (const p of peopleRows ?? []) {
    const entityId = p.entity_id as string;
    contactsByEntity.set(entityId, [...(contactsByEntity.get(entityId) ?? []), {
      id: p.id as string, fullName: p.full_name as string, role: p.role as string | null,
      email: (p.email_verified as string | null) ?? (p.email_guess as string | null),
      linkedinUrl: p.linkedin_url as string | null, phone: p.phone as string | null,
    }]);
  }

  const shaped = (allRows ?? []).map((m) => {
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
      id: m.id, orgId: m.org_id, orgName: org?.name ?? '(deleted org)', orgIsInternal: !!org?.is_internal,
      name: m.name, website: m.website, grade, createdAt: m.created_at,
      status: m.catalog_review_status,
      // A contact is anything the founder could actually reach: a person, an
      // inbox, or a phone. The column is a tick, not a count.
      hasContact: contacts.length > 0 || !!m.email || !!m.phone,
      catalogMatch: match ? { id: match.id, name: match.name, website: match.website, verificationStatus: match.verification_status } : null,
      // Expand-panel detail. Shipped, not rendered in the row.
      detail: {
        hqCity: m.hq_city, hqCountry: m.hq_country, geographies: m.invests_in_geographies ?? [],
        stageMin: m.stage_min, stageMax: m.stage_max, checkMinEur: m.check_min_eur, checkMaxEur: m.check_max_eur,
        sectors: m.sectors ?? [], thesis: m.thesis, email: m.email, phone: m.phone, contacts,
      },
    };
  });

  // Grade filter and grade sort, both over the whole set — see the note above
  // the query for why this is not a DB range.
  const minGrade = searchParams.get('grade');
  const filtered = minGrade && minGrade !== 'all'
    ? shaped.filter((r) => r.grade.localeCompare(minGrade) <= 0)
    : shaped;

  const sorted = searchParams.get('sort') === 'grade'
    ? [...filtered].sort((a, b) =>
        (ascending ? 1 : -1) * (b.grade.localeCompare(a.grade) || a.createdAt.localeCompare(b.createdAt)))
    : filtered;

  const from = (page - 1) * size;
  return NextResponse.json({
    ok: true,
    manualEntities: sorted.slice(from, from + size),
    total: sorted.length,
    hiddenInternal: (hiddenRes as { count?: number }).count ?? 0,
  });
}
