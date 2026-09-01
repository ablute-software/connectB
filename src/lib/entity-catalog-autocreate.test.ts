import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AUTO_CATALOG_SOURCE, ensureCatalogEntriesForEntities, ensureCatalogEntryForEntity,
  type EntityForCatalog,
} from './entity-catalog-autocreate';

// Prompt 510 — the property that matters most here is the NEGATIVE one:
// a firm that already has a catalog row must never gain a second one, and
// nothing born on this path may ever be 'verified'. Both are asserted
// against the recorded write log rather than the return value, because the
// return value is what the caller sees while the write log is what the
// other 700 orgs eventually see.

interface Write { table: string; payload: Record<string, unknown> }

function makeFakeAdmin(opts: {
  catalogRows?: { id: string; name: string; website: string | null }[];
  deliveries?: { catalog_id: string; entity_id: string }[];
  catalogReadError?: string;
  activeJob?: boolean;
  bySourceEntity?: { id: string; source_entity_id: string }[];
} = {}) {
  const writes: Write[] = [];
  let created = 0;

  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const self = () => b as never;
    let pending: Record<string, unknown> | null = null;
    // The two reads of catalog_entities are told apart the way the real
    // code tells them apart: only the source_entity_id lookup uses .in().
    let bySourceEntityLookup = false;

    function readResponse() {
      if (table === 'catalog_entities') {
        if (opts.catalogReadError) return { data: null, error: { message: opts.catalogReadError } };
        if (bySourceEntityLookup) return { data: opts.bySourceEntity ?? [], error: null };
        return { data: opts.catalogRows ?? [], error: null };
      }
      if (table === 'catalog_deliveries') return { data: opts.deliveries ?? [], error: null };
      return { data: [], error: null };
    }

    Object.assign(b, {
      select: self,
      eq: self,
      in: (col: string) => { if (col === 'source_entity_id') bySourceEntityLookup = true; return self(); },
      insert: (payload: Record<string, unknown>) => {
        writes.push({ table, payload });
        pending = payload;
        return self();
      },
      single: () => {
        if (table === 'catalog_entities' && pending) {
          created += 1;
          const row = { id: `cat-new-${created}`, name: pending.name, website: pending.website };
          return Promise.resolve({ data: row, error: null });
        }
        if (table === 'enrichment_jobs') return Promise.resolve({ data: { id: 'job-1' }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: () => Promise.resolve({
        data: table === 'enrichment_jobs' && opts.activeJob ? { id: 'job-existing' } : null,
        error: null,
      }),
      // Thenable: the read paths await the end of the chain, and the
      // delivery insert awaits the insert itself with no .select().
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(
        pending ? { data: null, error: null } : readResponse(),
      ).then(resolve),
    });
    return b;
  }

  return { admin: { from: (t: string) => builder(t) } as unknown as SupabaseClient, writes };
}

function entity(over: Partial<EntityForCatalog> = {}): EntityForCatalog {
  return { id: 'ent-1', name: 'Adesso Ventures', website: 'https://adesso.vc', type: 'vc', ...over };
}

const ORG = 'org-1';

describe('ensureCatalogEntriesForEntities', () => {
  it('creates a pending catalog row when the firm is not in the catalog at all', async () => {
    const { admin, writes } = makeFakeAdmin({ catalogRows: [] });
    const [result] = await ensureCatalogEntriesForEntities(admin, ORG, [entity()]);

    expect(result.outcome).toBe('created');
    expect(result.catalogId).toBe('cat-new-1');

    const catalogWrite = writes.find((w) => w.table === 'catalog_entities');
    expect(catalogWrite?.payload.name).toBe('Adesso Ventures');
    expect(catalogWrite?.payload.source).toBe(AUTO_CATALOG_SOURCE);
    expect(catalogWrite?.payload.source_entity_id).toBe('ent-1');
  });

  it('never writes verification_status verified from this path', async () => {
    const { admin, writes } = makeFakeAdmin({ catalogRows: [] });
    await ensureCatalogEntriesForEntities(admin, ORG, [entity()]);

    const catalogWrite = writes.find((w) => w.table === 'catalog_entities');
    expect(catalogWrite?.payload.verification_status).toBe('pending');
    expect(catalogWrite?.payload.verification_status).not.toBe('verified');
  });

  it('links, but does not duplicate, a firm already in the catalog by domain', async () => {
    const { admin, writes } = makeFakeAdmin({
      catalogRows: [{ id: 'cat-faber', name: 'Faber', website: 'https://faber.vc' }],
    });
    const [result] = await ensureCatalogEntriesForEntities(admin, ORG, [
      entity({ id: 'ent-faber', name: 'Faber Ventures', website: 'https://faber.vc' }),
    ]);

    expect(result.outcome).toBe('matched');
    expect(result.catalogId).toBe('cat-faber');
    expect(writes.filter((w) => w.table === 'catalog_entities')).toHaveLength(0);
    expect(writes.filter((w) => w.table === 'catalog_deliveries')).toHaveLength(1);
  });

  it('is idempotent: an already-linked firm produces no writes at all', async () => {
    const { admin, writes } = makeFakeAdmin({
      catalogRows: [{ id: 'cat-faber', name: 'Faber', website: 'https://faber.vc' }],
      deliveries: [{ catalog_id: 'cat-faber', entity_id: 'ent-faber' }],
    });
    const [result] = await ensureCatalogEntriesForEntities(admin, ORG, [
      entity({ id: 'ent-faber', name: 'Faber', website: 'https://faber.vc' }),
    ]);

    expect(result.outcome).toBe('already_linked');
    expect(writes).toHaveLength(0);
  });

  it('creates only ONE catalog row when the same firm appears twice in one batch', async () => {
    // The in-batch case an import genuinely produces: same domain, two
    // spellings. Without the freshly-created row being pushed back into the
    // candidate list, this silently creates two catalog rows for one firm.
    const { admin, writes } = makeFakeAdmin({ catalogRows: [] });
    const results = await ensureCatalogEntriesForEntities(admin, ORG, [
      entity({ id: 'ent-a', name: 'Adesso Ventures', website: 'https://adesso.vc' }),
      entity({ id: 'ent-b', name: 'adesso ventures GmbH', website: 'https://www.adesso.vc/team' }),
    ]);

    expect(writes.filter((w) => w.table === 'catalog_entities')).toHaveLength(1);
    expect(results[0].outcome).toBe('created');
    expect(results[1].catalogId).toBe(results[0].catalogId);
    // 'already_linked', not 'matched': catalog_deliveries is unique on
    // (org_id, catalog_id), so the org's link to that catalog row is
    // already spent on ent-a. ent-b resolves to the same catalog row but
    // cannot carry its own delivery row — a schema constraint, not a
    // choice this function makes. Exactly one delivery is written.
    expect(results[1].outcome).toBe('already_linked');
    expect(writes.filter((w) => w.table === 'catalog_deliveries')).toHaveLength(1);
  });

  it('copies only fields the entity already has, inventing nothing', async () => {
    const { admin, writes } = makeFakeAdmin({ catalogRows: [] });
    await ensureCatalogEntriesForEntities(admin, ORG, [
      entity({ website: null, sectors: ['healthtech'], hq_country: undefined }),
    ]);

    const payload = writes.find((w) => w.table === 'catalog_entities')!.payload;
    expect(payload.sectors).toEqual(['healthtech']);
    expect(payload.website).toBeNull();
    expect(payload.hq_country).toBeNull();
    expect(payload.thesis).toBeUndefined();
  });

  it('marks a zz-test- fixture as is_test so it stays out of real catalog reads', async () => {
    const { admin, writes } = makeFakeAdmin({ catalogRows: [] });
    await ensureCatalogEntriesForEntities(admin, ORG, [entity({ name: 'zz-test-Acme Capital' })]);

    expect(writes.find((w) => w.table === 'catalog_entities')?.payload.is_test).toBe(true);
  });

  it('does not mark a real firm as is_test', async () => {
    const { admin, writes } = makeFakeAdmin({ catalogRows: [] });
    await ensureCatalogEntriesForEntities(admin, ORG, [entity()]);

    expect(writes.find((w) => w.table === 'catalog_entities')?.payload.is_test).toBe(false);
  });

  it('enqueues a Layer 1 job for a newly created row only', async () => {
    const { admin, writes } = makeFakeAdmin({ catalogRows: [] });
    const [result] = await ensureCatalogEntriesForEntities(admin, ORG, [entity()]);

    expect(result.enqueued).toBe(true);
    const job = writes.find((w) => w.table === 'enrichment_jobs');
    expect(job?.payload.target_type).toBe('entity');
    expect(job?.payload.layer).toBe(1);
  });

  it('does not enqueue for a firm that merely needed linking', async () => {
    const { admin, writes } = makeFakeAdmin({
      catalogRows: [{ id: 'cat-faber', name: 'Faber', website: 'https://faber.vc' }],
    });
    const [result] = await ensureCatalogEntriesForEntities(admin, ORG, [
      entity({ id: 'ent-faber', website: 'https://faber.vc' }),
    ]);

    expect(result.outcome).toBe('matched');
    expect(result.enqueued).toBe(false);
    expect(writes.filter((w) => w.table === 'enrichment_jobs')).toHaveLength(0);
  });

  it('skips an entity with no usable name instead of creating a nameless catalog row', async () => {
    const { admin, writes } = makeFakeAdmin({ catalogRows: [] });
    const [result] = await ensureCatalogEntriesForEntities(admin, ORG, [entity({ name: '   ' })]);

    expect(result.outcome).toBe('skipped');
    expect(writes).toHaveLength(0);
  });

  it('reports failure without throwing when the catalog cannot be read', async () => {
    // The caller has already inserted the founder's entity by this point.
    // Throwing here would fail an import that actually succeeded.
    const { admin } = makeFakeAdmin({ catalogReadError: 'connection reset' });
    const results = await ensureCatalogEntriesForEntities(admin, ORG, [entity()]);

    expect(results[0].outcome).toBe('failed');
    expect(results[0].reason).toContain('connection reset');
  });

  it('never re-creates a row for an entity that already has one, even when name/domain cannot match it', async () => {
    // The case the source_entity_id short-circuit exists for: no website and
    // a name that is not unique in the catalog, so matchEntityToCatalog
    // returns null. Without the short-circuit this would attempt an insert
    // and hit the UNIQUE(source_entity_id) constraint.
    const { admin, writes } = makeFakeAdmin({
      catalogRows: [
        { id: 'cat-x', name: 'Alpha Capital', website: null },
        { id: 'cat-y', name: 'Alpha Capital', website: null },
      ],
      bySourceEntity: [{ id: 'cat-x', source_entity_id: 'ent-1' }],
      deliveries: [{ catalog_id: 'cat-x', entity_id: 'ent-1' }],
    });
    const [result] = await ensureCatalogEntriesForEntities(admin, ORG, [
      entity({ id: 'ent-1', name: 'Alpha Capital', website: null }),
    ]);

    expect(result.outcome).toBe('already_linked');
    expect(result.catalogId).toBe('cat-x');
    expect(writes).toHaveLength(0);
  });

  it('repairs a missing delivery link for a row an earlier run half-created', async () => {
    const { admin, writes } = makeFakeAdmin({
      catalogRows: [{ id: 'cat-x', name: 'Alpha Capital', website: null }],
      bySourceEntity: [{ id: 'cat-x', source_entity_id: 'ent-1' }],
      deliveries: [],
    });
    const [result] = await ensureCatalogEntriesForEntities(admin, ORG, [
      entity({ id: 'ent-1', name: 'Alpha Capital', website: null }),
    ]);

    expect(result.outcome).toBe('matched');
    expect(writes.filter((w) => w.table === 'catalog_entities')).toHaveLength(0);
    expect(writes.filter((w) => w.table === 'catalog_deliveries')).toHaveLength(1);
  });

  it('returns an empty array for an empty batch without touching the database', async () => {
    const { admin, writes } = makeFakeAdmin();
    expect(await ensureCatalogEntriesForEntities(admin, ORG, [])).toEqual([]);
    expect(writes).toHaveLength(0);
  });
});

describe('ensureCatalogEntryForEntity', () => {
  it('wraps the batch function for a single entity', async () => {
    const { admin } = makeFakeAdmin({ catalogRows: [] });
    const result = await ensureCatalogEntryForEntity(admin, ORG, entity());
    expect(result.outcome).toBe('created');
    expect(result.entityId).toBe('ent-1');
  });
});
