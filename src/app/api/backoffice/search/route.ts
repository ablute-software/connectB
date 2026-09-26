// Prompt 576 §3 — the sidebar's global search (⌘K). No prior art in this
// repo: every existing "search" is a page-local client-side filter over an
// already-fetched list (Catalog, Startups, Investors, Queue). This is the
// first one that queries the server, because it has to reach across three
// unrelated tables the sidebar has no other reason to have loaded at once.
//
// Four sources, one flat result list — "firms, people, orgs" per the
// wireframe's own placeholder copy:
//   - orgs (startups)              -> /backoffice/startups (no per-org page yet)
//   - catalog_entities (investors) -> /backoffice/investors
//   - people                       -> the entity page they belong to, via
//     Developer Viewer (Prompt 592 — people is per-org private pipeline,
//     not catalog data; a raw link to /entities/[id] 404s for an admin
//     session with no membership in that org. The client enters viewer
//     mode for orgId first, same mechanism startups/page.tsx's own "Open
//     as viewer" already uses, then navigates. orgId/orgName travel on the
//     result so the client can do that AND so the org is visible in the
//     list — Prompt 592 §D: two orgs could otherwise share an identical
//     "Name · Firm" line with no way to tell them apart.)
//   - catalog_people (researched investor contacts) -> /catalog-people/[id]
//     directly, no viewer session needed: catalog_people_read (0002/0344)
//     already has an is_platform_admin() bypass, same as catalog_entities.
//     Found missing (Nuno, 26/09/2026) while checking LINCE Capital's own
//     researched team was reachable at all — this was the actual gap, not
//     the entity's pipeline `status`: an org-private `entities.status` of
//     'dormant' never hid anything from this search (rows below reads
//     catalog_entities/db.entities directly, with no status filter, in
//     either this route or the founder Pipeline's own name search), but a
//     researched person's name had NO search source at all before this —
//     only the org-private `people` table (a founder's own added contacts)
//     was ever queried, so none of the 37 people this catalog already has
//     on LINCE Capital could be found by name here.
// Capped at 8 per source so one very common substring can't crowd out the
// other categories.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { isExcludedOrgName } from '@/lib/analytics-events';

const PER_SOURCE_LIMIT = 8;

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ ok: true, results: [] });
  const like = `%${q}%`;

  const [{ data: orgs }, { data: entities }, { data: people }, { data: catalogPeople }] = await Promise.all([
    admin.from('orgs').select('id, name').ilike('name', like).limit(PER_SOURCE_LIMIT + 5),
    admin.from('catalog_entities').select('id, name').ilike('name', like).limit(PER_SOURCE_LIMIT),
    admin.from('people').select('id, full_name, entity_id, org_id, entities(name), orgs(name)').ilike('full_name', like).limit(PER_SOURCE_LIMIT),
    admin.from('catalog_people').select('id, full_name').ilike('full_name', like).limit(PER_SOURCE_LIMIT),
  ]);

  // A separate query rather than a nested select: catalog_person_affiliations
  // has no current=true filter available inside a Supabase nested-select, and
  // a person can carry a past, no-longer-current affiliation row that would
  // otherwise win the sublabel. Same two-query shape /api/backoffice/catalog
  // already uses for the same join.
  const catalogPeopleIds = (catalogPeople ?? []).map((p) => p.id as string);
  const firmByPersonId = new Map<string, string>();
  if (catalogPeopleIds.length > 0) {
    const { data: affiliations } = await admin.from('catalog_person_affiliations')
      .select('person_id, is_primary, catalog_entities(name)')
      .in('person_id', catalogPeopleIds).eq('current', true);
    for (const a of affiliations ?? []) {
      const firmName = (a.catalog_entities as unknown as { name: string } | null)?.name;
      if (!firmName) continue;
      const personId = a.person_id as string;
      // Prefer the primary affiliation's firm; the first current row wins
      // otherwise, matching EntityPeoplePanel's own is_primary-first ordering.
      if (a.is_primary || !firmByPersonId.has(personId)) firmByPersonId.set(personId, firmName);
    }
  }

  const results = [
    // Prompt 576 §3 — /backoffice/startups and /backoffice/catalog both
    // filter client-side over an already-fetched list with no URL-param
    // support today (checked both before writing this, not assumed), so
    // these two links land on the list rather than a pre-filtered view of
    // it — still the right room, not a dead end.
    ...(orgs ?? [])
      .filter((o) => !isExcludedOrgName(o.name as string))
      .slice(0, PER_SOURCE_LIMIT)
      .map((o) => ({ kind: 'org' as const, id: o.id, label: o.name as string, href: '/backoffice/startups' })),
    ...(entities ?? []).map((e) => ({ kind: 'catalog_entity' as const, id: e.id, label: e.name as string, href: '/backoffice/catalog' })),
    ...(people ?? []).map((p) => {
      const entityName = (p.entities as unknown as { name: string } | null)?.name;
      const orgName = (p.orgs as unknown as { name: string } | null)?.name;
      return {
        kind: 'person' as const, id: p.id, label: p.full_name as string,
        // Prompt 592 §D — the org name is load-bearing, not decorative:
        // without it, two different startups' contacts at firms of the
        // same name are indistinguishable in the list.
        sublabel: [entityName, orgName].filter(Boolean).join(' · ') || undefined,
        href: p.entity_id ? `/entities/${p.entity_id}` : undefined,
        orgId: p.org_id as string | null,
      };
    }),
    ...(catalogPeople ?? []).map((p) => ({
      kind: 'catalog_person' as const, id: p.id as string, label: p.full_name as string,
      sublabel: firmByPersonId.get(p.id as string),
      href: `/catalog-people/${p.id}`,
    })),
  ].filter((r) => !!r.href);

  return NextResponse.json({ ok: true, results });
}
