import { describe, expect, it } from 'vitest';
import { reconcileCandidates, summarize, type ReconcileCatalogRow } from './catalog-candidate-reconcile';

const CATALOG: ReconcileCatalogRow[] = [
  { id: 'cat-kurma', name: 'Kurma Partners', website: 'https://kurmapartners.com' },
  { id: 'cat-btov', name: 'btov Partners', website: 'https://btov.vc' },
  { id: 'cat-bom', name: 'Brabant Development Agency (BOM)', website: 'https://www.bom.nl/en/' },
];

describe('reconcileCandidates', () => {
  it('links on domain, ignoring protocol, www and path', () => {
    // The three shapes production actually contains.
    const out = reconcileCandidates([
      { id: 'e1', name: 'Kurma', website: 'kurmapartners.com', catalog_review_status: 'pending' },
      { id: 'e2', name: 'Whatever', website: 'http://www.kurmapartners.com/team', catalog_review_status: 'pending' },
      { id: 'e3', name: 'BOM', website: 'https://www.bom.nl/en/', catalog_review_status: 'pending' },
    ], CATALOG);
    expect(out.map((d) => [d.status, d.catalogId, d.basis])).toEqual([
      ['linked', 'cat-kurma', 'domain'],
      ['linked', 'cat-kurma', 'domain'],
      ['linked', 'cat-bom', 'domain'],
    ]);
  });

  it('a matching name with a different domain is probable, never linked', () => {
    // b2venture/btov is the real case: one firm after a rename, but the
    // reconcile must not decide that on its own.
    const out = reconcileCandidates(
      [{ id: 'e1', name: 'btov', website: 'https://b2venture.vc', catalog_review_status: 'pending' }],
      CATALOG,
    );
    expect(out[0]).toEqual({ id: 'e1', status: 'probable_match', catalogId: 'cat-btov', basis: 'name' });
  });

  it('matches on name when the candidate has no website at all', () => {
    const out = reconcileCandidates(
      [{ id: 'e1', name: 'Kurma Partners', website: null, catalog_review_status: 'pending' }],
      CATALOG,
    );
    expect(out[0].status).toBe('probable_match');
  });

  it('domain wins over name when both would match different rows', () => {
    const out = reconcileCandidates(
      [{ id: 'e1', name: 'btov Partners', website: 'https://kurmapartners.com', catalog_review_status: 'pending' }],
      CATALOG,
    );
    expect(out[0].catalogId).toBe('cat-kurma');
    expect(out[0].basis).toBe('domain');
  });

  it('no match stays pending, and records the delivery link when there is one', () => {
    const out = reconcileCandidates([
      { id: 'e1', name: 'Nobody', website: 'https://nobody.example', catalog_review_status: 'pending' },
      { id: 'e2', name: 'Nobody', website: 'https://nobody.example', catalog_review_status: 'pending', deliveredCatalogId: 'cat-x' },
    ], CATALOG);
    expect(out[0]).toEqual({ id: 'e1', status: 'pending', catalogId: null, basis: 'none' });
    expect(out[1]).toEqual({ id: 'e2', status: 'pending', catalogId: 'cat-x', basis: 'delivery' });
  });

  it('never returns a row a human already decided', () => {
    // The §D.7 suspicion, made structural: dismissed rows kept reappearing
    // because something recomputed the list without reading the status.
    const decided = ['merged', 'promoted', 'dismissed'].map((s, i) => ({
      id: `e${i}`, name: 'Kurma Partners', website: 'https://kurmapartners.com', catalog_review_status: s,
    }));
    expect(reconcileCandidates(decided, CATALOG)).toEqual([]);
  });

  it('is idempotent — re-running over its own output changes nothing', () => {
    const first = reconcileCandidates(
      [{ id: 'e1', name: 'Kurma', website: 'kurmapartners.com', catalog_review_status: 'pending' }],
      CATALOG,
    );
    const second = reconcileCandidates(
      [{ id: 'e1', name: 'Kurma', website: 'kurmapartners.com', catalog_review_status: first[0].status }],
      CATALOG,
    );
    expect(second).toEqual(first);
  });

  it('picks the same catalog row every run when several share a key', () => {
    const dupes: ReconcileCatalogRow[] = [
      { id: 'cat-b', name: 'Same', website: 'https://same.com' },
      { id: 'cat-a', name: 'Same', website: 'https://same.com' },
    ];
    const cand = [{ id: 'e1', name: 'Same', website: 'https://same.com', catalog_review_status: 'pending' }];
    expect(reconcileCandidates(cand, dupes)[0].catalogId).toBe('cat-a');
    expect(reconcileCandidates(cand, [...dupes].reverse())[0].catalogId).toBe('cat-a');
  });
});

describe('summarize', () => {
  it('counts every status, including the ones at zero', () => {
    expect(summarize(reconcileCandidates([
      { id: 'e1', name: 'Kurma', website: 'kurmapartners.com', catalog_review_status: 'pending' },
      { id: 'e2', name: 'btov', website: 'https://elsewhere.example', catalog_review_status: 'pending' },
    ], CATALOG))).toEqual({ linked: 1, probable_match: 1, pending: 0 });
  });
});
