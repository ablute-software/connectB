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

  it('no match and no delivery stays pending, with nothing to merge into', () => {
    const out = reconcileCandidates(
      [{ id: 'e1', name: 'Nobody', website: 'https://nobody.example', catalog_review_status: 'pending' }],
      CATALOG,
    );
    expect(out[0]).toEqual({ id: 'e1', status: 'pending', catalogId: null, basis: 'none' });
  });

  it('a delivered row whose name and domain both drifted is probable, not pending', () => {
    // Earlybird Venture Capital delivered, then renamed by hand to "Earlybird
    // Health strategy": neither rule matches any more, but the platform itself
    // put that firm in front of this founder, which is a stronger statement
    // than either rule.
    const out = reconcileCandidates(
      [{ id: 'e1', name: 'Earlybird Health strategy', website: null, catalog_review_status: 'pending', deliveredCatalogId: 'cat-eb' }],
      CATALOG,
    );
    expect(out[0]).toEqual({ id: 'e1', status: 'probable_match', catalogId: 'cat-eb', basis: 'delivery' });
  });

  it('the queue contract holds: probable_match always has a match, pending never does', () => {
    // What the bulk action depends on — merge needs a catalog row to merge
    // into, and promote must only ever run on a row that has none.
    const out = reconcileCandidates([
      { id: 'a', name: 'Kurma', website: 'kurmapartners.com', catalog_review_status: 'pending' },
      { id: 'b', name: 'btov', website: 'https://elsewhere.example', catalog_review_status: 'pending' },
      { id: 'c', name: 'Drifted', website: null, catalog_review_status: 'pending', deliveredCatalogId: 'cat-x' },
      { id: 'd', name: 'Nobody', website: 'https://nobody.example', catalog_review_status: 'pending' },
    ], CATALOG);
    for (const d of out) {
      if (d.status === 'probable_match') expect(d.catalogId).not.toBeNull();
      if (d.status === 'pending') expect(d.catalogId).toBeNull();
    }
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
