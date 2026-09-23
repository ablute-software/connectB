// Prompt 728 §2.3 — the acceptance test the prompt itself requires: two
// concurrent requests for the same (entity_id, catalog_person_id) must
// produce exactly one row, and both callers must receive the SAME id.
// A stateful fake (not the read-only canned-row fakes elsewhere in this
// codebase) so it can actually simulate what the proposed unique index
// protects against: both calls pass the "does this exist yet" read before
// either insert lands, and the fake's own insert() applies the real
// Postgres 23505 behavior deterministically, by insertion order.
import { describe, expect, it } from 'vitest';
import { ensureOrgPersonFromCatalog, type MaterializeClient } from './catalog-materialize';

function makeFakeClient(seed: {
  catalogPeople: { id: string; full_name: string; linkedin_url: string | null; linkedin_verified: boolean; hook_status: string; hook_source: string | null; catalog_people_research: { hook: string | null } | null }[];
  affiliations: { person_id: string; title: string | null; seniority_rank: number; is_primary: boolean }[];
  existingLocalPeople?: Record<string, unknown>[];
}): { client: MaterializeClient; peopleRows: Record<string, unknown>[] } {
  const peopleRows: Record<string, unknown>[] = [...(seed.existingLocalPeople ?? [])];
  const uniqueSeen = new Set<string>(
    peopleRows.filter((r) => r.catalog_person_id).map((r) => `${r.entity_id}:${r.catalog_person_id}`),
  );
  let nextId = peopleRows.length + 1;

  const client = {
    from(table: string) {
      if (table === 'people') {
        return {
          select: () => ({
            eq: (col1: string, val1: unknown) => ({
              eq: (col2: string, val2: unknown) => ({
                maybeSingle: async () => ({ data: peopleRows.find((r) => r[col1] === val1 && r[col2] === val2) ?? null, error: null }),
              }),
              is: () => ({
                ilike: (col3: string, val3: string) => ({
                  maybeSingle: async () => ({
                    data: peopleRows.find((r) => r[col1] === val1 && r.catalog_person_id == null
                      && String(r[col3]).toLowerCase() === val3.toLowerCase()) ?? null,
                  }),
                }),
              }),
              maybeSingle: async () => ({ data: null }),
              order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              maybeSingle: async () => {
                const key = `${row.entity_id}:${row.catalog_person_id}`;
                if (uniqueSeen.has(key)) {
                  return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "people_entity_catalog_person_uidx"' } };
                }
                uniqueSeen.add(key);
                const withId = { id: `p-${nextId++}`, ...row };
                peopleRows.push(withId);
                return { data: withId, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'catalog_people') {
        return {
          select: () => ({
            eq: (_col: string, val: unknown) => ({
              maybeSingle: async () => ({ data: seed.catalogPeople.find((c) => c.id === val) ?? null, error: null }),
            }),
          }),
          insert: () => { throw new Error('not used in this fake'); },
        };
      }
      // catalog_person_affiliations
      return {
        select: () => ({
          eq: (col1: string, val1: unknown) => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: [...seed.affiliations].filter((a) => (a as unknown as Record<string, unknown>)[col1] === val1)
                      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))[0] ?? null,
                  }),
                }),
              }),
            }),
          }),
        }),
        insert: () => { throw new Error('not used in this fake'); },
      };
    },
  } as unknown as MaterializeClient;

  return { client, peopleRows };
}

const LURDES = {
  id: 'catperson-1', full_name: 'Lurdes Gramaxo', linkedin_url: 'https://linkedin.com/in/lurdes', linkedin_verified: true,
  hook_status: 'researched', hook_source: 'web', catalog_people_research: { hook: 'Quoted on APBA board priorities in 2026.' },
};
const AFFIL = { person_id: 'catperson-1', title: 'President', seniority_rank: 1, is_primary: true };

describe('ensureOrgPersonFromCatalog — Prompt 728 §2', () => {
  it('materializes seniority_rank, title, linkedin, and the hook (with source) from the catalog — never max+1', async () => {
    const { client } = makeFakeClient({ catalogPeople: [LURDES], affiliations: [AFFIL] });
    const result = await ensureOrgPersonFromCatalog(client, { orgId: 'org-1', entityId: 'entity-1', catalogPersonId: 'catperson-1' });
    expect(result.created).toBe(true);
    expect(result.person.full_name).toBe('Lurdes Gramaxo');
    expect(result.person.role).toBe('President');
    expect(result.person.seniority_rank).toBe(1);
    expect(result.person.linkedin_url).toBe('https://linkedin.com/in/lurdes');
    expect(result.person.hook_status).toBe('researched');
    expect(result.person.hook).toBe('Quoted on APBA board priorities in 2026.');
    expect(result.person.data_source).toBe('Added from catalog');
  });

  it('never copies the hook when hook_source is absent, even if hook_status somehow says researched', async () => {
    const noSource = { ...LURDES, hook_source: null };
    const { client } = makeFakeClient({ catalogPeople: [noSource], affiliations: [AFFIL] });
    const result = await ensureOrgPersonFromCatalog(client, { orgId: 'org-1', entityId: 'entity-1', catalogPersonId: 'catperson-1' });
    expect(result.person.hook_status).toBe('to_research');
    expect(result.person.hook).toBeFalsy();
  });

  it('is idempotent on a plain re-call — returns the SAME row, never a second one', async () => {
    const { client, peopleRows } = makeFakeClient({ catalogPeople: [LURDES], affiliations: [AFFIL] });
    const first = await ensureOrgPersonFromCatalog(client, { orgId: 'org-1', entityId: 'entity-1', catalogPersonId: 'catperson-1' });
    const second = await ensureOrgPersonFromCatalog(client, { orgId: 'org-1', entityId: 'entity-1', catalogPersonId: 'catperson-1' });
    expect(second.created).toBe(false);
    expect(second.person.id).toBe(first.person.id);
    expect(peopleRows).toHaveLength(1);
  });

  it('flags needs_link_review when an old local person shares the normalized name at the same entity, but never auto-merges', async () => {
    const { client } = makeFakeClient({
      catalogPeople: [LURDES], affiliations: [AFFIL],
      existingLocalPeople: [{ id: 'old-1', entity_id: 'entity-1', full_name: 'lurdes gramaxo', catalog_person_id: null }],
    });
    const result = await ensureOrgPersonFromCatalog(client, { orgId: 'org-1', entityId: 'entity-1', catalogPersonId: 'catperson-1' });
    expect(result.needsLinkReview).toBe(true);
    // The old row is untouched, never merged into or overwritten.
    expect(result.person.id).not.toBe('old-1');
  });

  // The acceptance test the prompt itself requires.
  it('two concurrent requests for the same (entity_id, catalog_person_id) produce exactly one row, and both callers get the same id', async () => {
    const { client, peopleRows } = makeFakeClient({ catalogPeople: [LURDES], affiliations: [AFFIL] });
    const params = { orgId: 'org-1', entityId: 'entity-1', catalogPersonId: 'catperson-1' };
    const [r1, r2] = await Promise.all([
      ensureOrgPersonFromCatalog(client, params),
      ensureOrgPersonFromCatalog(client, params),
    ]);
    expect(r1.person.id).toBe(r2.person.id);
    expect(peopleRows.filter((r) => r.catalog_person_id === 'catperson-1')).toHaveLength(1);
    // Exactly one of the two calls did the real insert; the other lost the
    // race and reread the winner's row — never surfaced an error either way.
    expect([r1.created, r2.created].filter(Boolean)).toHaveLength(1);
  });

  it('a request for the same catalog person at a DIFFERENT entity is a separate row — never blocked by the other entity\'s row', async () => {
    const { client, peopleRows } = makeFakeClient({ catalogPeople: [LURDES], affiliations: [AFFIL] });
    await ensureOrgPersonFromCatalog(client, { orgId: 'org-1', entityId: 'entity-1', catalogPersonId: 'catperson-1' });
    const other = await ensureOrgPersonFromCatalog(client, { orgId: 'org-2', entityId: 'entity-2', catalogPersonId: 'catperson-1' });
    expect(other.created).toBe(true);
    expect(peopleRows).toHaveLength(2);
  });
});
