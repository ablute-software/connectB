import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Prompt 483 — the backfill is gated on orgCompetitorsCompetitorTypeAvailable
// (migration 0275's column). Under vitest there are no Supabase env vars, so
// the real probe would cache `false` and every test below would pass for the
// wrong reason. Mocked to `true` here so the tests exercise the actual
// decision path; the "probe off" case gets its own test with it forced off.
const competitorTypeAvailable = vi.fn(async () => true);
vi.mock('./market-data-capability', () => ({
  orgCompetitorsCompetitorTypeAvailable: () => competitorTypeAvailable(),
  marketCompanyExtendedFieldsAvailable: async () => false,
}));

const { backfillCompetitorTypeFromClassification, isScoredClassification } = await import('./market-competitor-write');
const { upsertOrEnrichResearchItem } = await import('./market-research-item-upsert');

interface CompanyRow { id: string; name: string; domain: string | null }
interface CompetitorRow { id: string; org_id: string; market_company_id: string; competitor_type: string | null; relation: string }
interface ItemRow {
  id: string; org_id: string; section: string; title: string; detail: string;
  source_kind: string; document_id: string | null; page: number | null;
  structured: Record<string, unknown> | null; status: string; run_signature: string | null;
}

const FULL_CLASSIFICATION = {
  name: 'Withings',
  candidateKind: 'company',
  candidateStage: 'launched',
  relation: { sameBuyer: { state: 'MATCH', note: null, sourceUrl: null } },
  sherlockClassification: 'DIRECT',
};

// A fake that knows BOTH tables, because the whole point of this prompt is
// the walk from one to the other: market_research_items -> (structured name)
// -> market_companies -> org_competitors.market_company_id.
function makeFakeAdmin(seed: {
  items?: ItemRow[]; competitors?: CompetitorRow[]; companies?: CompanyRow[];
} = {}) {
  const items = [...(seed.items ?? [])];
  const competitors = [...(seed.competitors ?? [])];
  const companies = [...(seed.companies ?? [])];

  function matches(r: Record<string, unknown>, filters: [string, unknown, boolean][]): boolean {
    return filters.every(([col, val, isNullCheck]) => (isNullCheck ? r[col] === null : r[col] === val));
  }

  const admin = {
    from: (table: string) => {
      if (table === 'org_competitors') {
        return {
          select: () => {
            const filters: [string, unknown, boolean][] = [];
            const chain = {
              eq(col: string, val: unknown) { filters.push([col, val, false]); return chain; },
              then(onFulfilled: (v: unknown) => unknown) {
                const rows = competitors.filter((r) => matches(r as unknown as Record<string, unknown>, filters))
                  // the embedded join PostgREST resolves for
                  // `market_companies(id, name, domain)`
                  .map((r) => ({ ...r, market_companies: companies.find((c) => c.id === r.market_company_id) ?? null }));
                return Promise.resolve({ data: rows, error: null }).then(onFulfilled);
              },
            };
            return chain;
          },
          update: (payload: Record<string, unknown>) => {
            const filters: [string, unknown, boolean][] = [];
            const chain = {
              eq(col: string, val: unknown) { filters.push([col, val, false]); return chain; },
              is(col: string, val: unknown) { filters.push([col, val, val === null]); return chain; },
              select() {
                const hit = competitors.filter((r) => matches(r as unknown as Record<string, unknown>, filters));
                for (const r of hit) Object.assign(r, payload);
                return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
              },
            };
            return chain;
          },
        };
      }
      if (table === 'market_research_items') {
        return {
          upsert: (payload: Record<string, unknown>, options?: { ignoreDuplicates?: boolean }) => ({
            select: () => {
              const clash = items.find((r) => r.org_id === payload.org_id && r.section === payload.section && r.title === payload.title);
              if (clash && options?.ignoreDuplicates) return Promise.resolve({ data: [], error: null });
              const inserted = { id: `item-new`, ...payload } as unknown as ItemRow;
              items.push(inserted);
              return Promise.resolve({ data: [{ id: inserted.id }], error: null });
            },
          }),
          select: () => {
            const filters: [string, unknown, boolean][] = [];
            const chain = {
              eq(col: string, val: unknown) { filters.push([col, val, false]); return chain; },
              maybeSingle() {
                const found = items.find((r) => matches(r as unknown as Record<string, unknown>, filters));
                return Promise.resolve({ data: found ?? null, error: null });
              },
            };
            return chain;
          },
          update: (payload: Record<string, unknown>) => {
            const filters: [string, unknown, boolean][] = [];
            const chain = {
              eq(col: string, val: unknown) { filters.push([col, val, false]); return chain; },
              then(onFulfilled: (v: unknown) => unknown) {
                for (const r of items) if (matches(r as unknown as Record<string, unknown>, filters)) Object.assign(r, payload);
                return Promise.resolve({ data: null, error: null }).then(onFulfilled);
              },
            };
            return chain;
          },
        };
      }
      throw new Error(`unexpected table in this fixture: ${table}`);
    },
  } as unknown as SupabaseClient;
  return { admin, items, competitors, companies };
}

function acceptedItem(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: 'item-withings', org_id: 'org-1', section: 'players', title: 'Competitor: Withings',
    detail: 'France · growth', source_kind: 'document', document_id: 'doc-deck', page: 4,
    structured: { name: 'Withings' }, status: 'accepted', run_signature: 'sig-old',
    ...overrides,
  };
}

function seedCompetitor(overrides: Partial<CompetitorRow> = {}): CompetitorRow {
  return { id: 'comp-1', org_id: 'org-1', market_company_id: 'company-1', competitor_type: null, relation: 'direct', ...overrides };
}

const WITHINGS: CompanyRow = { id: 'company-1', name: 'Withings', domain: null };

describe('isScoredClassification — only the six that can be an org_competitors row', () => {
  it('accepts the six', () => {
    for (const c of ['DIRECT', 'FUNCTIONAL', 'BUDGET', 'EMERGING', 'POTENTIAL_ENTRANT', 'ADJACENT']) {
      expect(isScoredClassification(c)).toBe(true);
    }
  });

  it('refuses the three the accept gate itself refuses', () => {
    // STATUS_QUO is a valid competitor_type value in the CHECK but is one of
    // the three research/respond/route.ts will not create a competitor from;
    // NOT_COMPETITOR and UNRESOLVED are not valid column values at all.
    expect(isScoredClassification('STATUS_QUO')).toBe(false);
    expect(isScoredClassification('NOT_COMPETITOR')).toBe(false);
    expect(isScoredClassification('UNRESOLVED')).toBe(false);
    expect(isScoredClassification('direct')).toBe(false); // stored lowercase, never read back as one
    expect(isScoredClassification(null)).toBe(false);
  });
});

describe('backfillCompetitorTypeFromClassification — Prompt 483 §2/§3', () => {
  it('fills competitor_type when it is null, walking the same match rule the accept path used', async () => {
    const { admin, competitors } = makeFakeAdmin({ competitors: [seedCompetitor()], companies: [WITHINGS] });
    expect(await backfillCompetitorTypeFromClassification(admin, 'org-1', 'Withings', 'FUNCTIONAL')).toBe(true);
    expect(competitors[0].competitor_type).toBe('functional'); // lowercased at the DB boundary, as the CHECK requires
  });

  it('matches the company the way findMatchingMarketCompany does, not by exact string', async () => {
    const { admin, competitors } = makeFakeAdmin({ competitors: [seedCompetitor()], companies: [WITHINGS] });
    expect(await backfillCompetitorTypeFromClassification(admin, 'org-1', '  withings ', 'DIRECT')).toBe(true);
    expect(competitors[0].competitor_type).toBe('direct');
  });

  it('§2 — never overwrites a competitor_type that is already set', async () => {
    const { admin, competitors } = makeFakeAdmin({ competitors: [seedCompetitor({ competitor_type: 'budget' })], companies: [WITHINGS] });
    expect(await backfillCompetitorTypeFromClassification(admin, 'org-1', 'Withings', 'DIRECT')).toBe(false);
    expect(competitors[0].competitor_type).toBe('budget');
  });

  it('never touches `relation`, which the founder can edit by hand', async () => {
    const { admin, competitors } = makeFakeAdmin({ competitors: [seedCompetitor({ relation: 'adjacent' })], companies: [WITHINGS] });
    await backfillCompetitorTypeFromClassification(admin, 'org-1', 'Withings', 'DIRECT');
    expect(competitors[0].relation).toBe('adjacent');
  });

  it('a name with no competitor of its own changes nothing', async () => {
    const { admin, competitors } = makeFakeAdmin({ competitors: [seedCompetitor()], companies: [WITHINGS] });
    expect(await backfillCompetitorTypeFromClassification(admin, 'org-1', 'Bisu', 'DIRECT')).toBe(false);
    expect(competitors[0].competitor_type).toBeNull();
  });

  it('fails closed when the competitor_type column is not there yet', async () => {
    competitorTypeAvailable.mockResolvedValueOnce(false);
    const { admin, competitors } = makeFakeAdmin({ competitors: [seedCompetitor()], companies: [WITHINGS] });
    expect(await backfillCompetitorTypeFromClassification(admin, 'org-1', 'Withings', 'DIRECT')).toBe(false);
    expect(competitors[0].competitor_type).toBeNull();
  });
});

describe('upsertOrEnrichResearchItem — the accepted row Prompt 482 had nowhere to put', () => {
  // The three scenarios the prompt's own Verificação section names.
  it('an accepted row with no classification fills in its competitor instead of being discarded', async () => {
    const { admin, competitors, items } = makeFakeAdmin({
      items: [acceptedItem()], competitors: [seedCompetitor()], companies: [WITHINGS],
    });
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', {
      section: 'players', title: 'Competitor: Withings', detail: 'France · growth · scales',
      documentId: 'doc-landscape', page: 2, structured: { ...FULL_CLASSIFICATION },
    });

    expect(outcome).toBe('competitor_backfilled');
    expect(competitors[0].competitor_type).toBe('direct');
    // §1/§4 — the accepted item row itself is still not rewritten, and its
    // status never moves.
    expect(items[0].structured).toEqual({ name: 'Withings' });
    expect(items[0].status).toBe('accepted');
    expect(items[0].document_id).toBe('doc-deck');
  });

  it('an accepted row whose competitor is already classified is left completely alone', async () => {
    const { admin, competitors } = makeFakeAdmin({
      items: [acceptedItem()], competitors: [seedCompetitor({ competitor_type: 'emerging' })], companies: [WITHINGS],
    });
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', {
      section: 'players', title: 'Competitor: Withings', detail: 'x',
      documentId: 'doc-landscape', page: 2, structured: { ...FULL_CLASSIFICATION },
    });

    expect(outcome).toBe('unchanged');
    expect(competitors[0].competitor_type).toBe('emerging');
  });

  it('a rejected row is still never touched — §4 changes the accepted case only', async () => {
    const { admin, competitors, items } = makeFakeAdmin({
      items: [acceptedItem({ status: 'rejected' })], competitors: [seedCompetitor()], companies: [WITHINGS],
    });
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', {
      section: 'players', title: 'Competitor: Withings', detail: 'x',
      documentId: 'doc-landscape', page: 2, structured: { ...FULL_CLASSIFICATION },
    });

    expect(outcome).toBe('unchanged');
    expect(competitors[0].competitor_type).toBeNull();
    expect(items[0].structured).toEqual({ name: 'Withings' });
  });

  it('an accepted row whose own structured is ALREADY classified is not a reclassification — nothing happens', async () => {
    const { admin, competitors } = makeFakeAdmin({
      items: [acceptedItem({ structured: { ...FULL_CLASSIFICATION, sherlockClassification: 'ADJACENT' } })],
      competitors: [seedCompetitor()], companies: [WITHINGS],
    });
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', {
      section: 'players', title: 'Competitor: Withings', detail: 'x',
      documentId: 'doc-landscape', page: 2, structured: { ...FULL_CLASSIFICATION },
    });

    // shouldEnrichExistingItem is false, so this is not a case of "the row
    // gained a classification it did not have" (§2) and the competitor is
    // left to whatever the accept path decided.
    expect(outcome).toBe('unchanged');
    expect(competitors[0].competitor_type).toBeNull();
  });

  it('a STATUS_QUO reclassification never becomes a competitor_type', async () => {
    const { admin, competitors } = makeFakeAdmin({
      items: [acceptedItem()], competitors: [seedCompetitor()], companies: [WITHINGS],
    });
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', {
      section: 'players', title: 'Competitor: Withings', detail: 'x',
      documentId: 'doc-landscape', page: 2,
      structured: { ...FULL_CLASSIFICATION, sherlockClassification: 'STATUS_QUO' },
    });

    expect(outcome).toBe('unchanged');
    expect(competitors[0].competitor_type).toBeNull();
  });

  it('a web-sourced accepted row is still out of scope — guard 2 comes first', async () => {
    const { admin, competitors } = makeFakeAdmin({
      items: [acceptedItem({ source_kind: 'web' })], competitors: [seedCompetitor()], companies: [WITHINGS],
    });
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', {
      section: 'players', title: 'Competitor: Withings', detail: 'x',
      documentId: 'doc-landscape', page: 2, structured: { ...FULL_CLASSIFICATION },
    });

    expect(outcome).toBe('unchanged');
    expect(competitors[0].competitor_type).toBeNull();
  });
});
