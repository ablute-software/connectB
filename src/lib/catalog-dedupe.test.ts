import { describe, expect, it } from 'vitest';
import { findCatalogMatch, findDuplicateClusters, normalizeDomain, normalizeName, pairKey, type Alias, type CatalogRow } from './catalog-dedupe';

describe('normalizeName', () => {
  it('strips parentheticals, diacritics, and legal suffixes', () => {
    expect(normalizeName('MAZE (Mustard Seed MAZE)')).toBe('maze');
    expect(normalizeName('btov Partners')).toBe('btov');
    expect(normalizeName('Nysnø Climate Investments')).toBe('nysn climate investments');
  });
});

// Prompt 580 §C — the real duplicate the tool never showed. "MAZE (Mustard
// Seed MAZE)" only ever matched itself under the old parenthetical-STRIP
// behavior; the actual other catalog row, really named "Mustard Seed
// MAZE", never came up. Confirmed empirically before this fix: zero
// clusters for this exact production pair.
describe('findDuplicateClusters — parenthetical alternate names (§C)', () => {
  it('matches "X (Y)" against a separate row actually named Y', () => {
    const rows: CatalogRow[] = [
      { id: 'pending', name: 'Mustard Seed MAZE', website: null },
      { id: 'other', name: 'MAZE (Mustard Seed MAZE)', website: null },
    ];
    const clusters = findDuplicateClusters(rows, []);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].ids.sort()).toEqual(['other', 'pending']);
    expect(clusters[0].reasons).toEqual(['name']);
  });

  it('does not treat a row as a duplicate of itself when its own parenthetical strips to the same value', () => {
    // "Foo (Foo)" would extract "foo" from both the stripped name and the
    // parenthetical — must not fabricate a second entry for the same id.
    const rows: CatalogRow[] = [{ id: 'a', name: 'Foo (Foo)', website: null }];
    expect(findDuplicateClusters(rows, [])).toHaveLength(0);
  });
});

describe('findDuplicateClusters — basic matches', () => {
  it('groups two rows sharing a normalized domain', () => {
    const rows: CatalogRow[] = [
      { id: 'a', name: 'Acme Ventures', website: 'https://acme.com' },
      { id: 'b', name: 'Acme VC', website: 'https://www.acme.com' },
    ];
    const clusters = findDuplicateClusters(rows, []);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].ids.sort()).toEqual(['a', 'b']);
    expect(clusters[0].reasons).toContain('domain');
  });

  it('does not group unrelated rows', () => {
    const rows: CatalogRow[] = [
      { id: 'a', name: 'Acme Ventures', website: 'https://acme.com' },
      { id: 'b', name: 'Widgets Capital', website: 'https://widgets.com' },
    ];
    expect(findDuplicateClusters(rows, [])).toHaveLength(0);
  });

  it('attributes a match to the specific alias value, separate from a real-name match', () => {
    const rows: CatalogRow[] = [
      { id: 'a', name: 'Bynd Capital', website: null },
      { id: 'b', name: 'Bynd', website: null },
    ];
    const aliases: Alias[] = [{ catalog_id: 'a', alias: 'Busy Angels SCR' }];
    const clusters = findDuplicateClusters(rows, aliases);
    expect(clusters).toHaveLength(1);
    // 'a' and 'b' collide on normalized NAME ("bynd", 'capital' is a
    // stripped legal suffix) — not on the alias, which has nothing to
    // match against here, so it must not show up as a spurious 'alias'
    // reason for this pair.
    expect(clusters[0].reasons).toEqual(['name']);
  });
});

// Prompt 580 §A/§B — the actual 2026-08-13 production incident, reproduced
// as a fixture: btov Partners' own alias 'b2venture' is legitimate; the
// other three catalog rows (Mustard Seed MAZE, Nysnø Climate Investments,
// Start Ventures) are real, unrelated firms with no genuine connection to
// btov or each other. Before this fix, a shared value between ANY two of
// them (however it arose) would transitively chain all four into one
// cluster with no way to see which pair actually matched on what — this
// is the shape §B.4 exists to make visible, and §B.1's "Not duplicates"
// needs the same per-value detail to know exactly which alias rows to
// remove.
describe('findDuplicateClusters — the 2026-08-13 incident, reproduced', () => {
  const rows: CatalogRow[] = [
    { id: 'btov', name: 'btov Partners', website: 'https://btov.com' },
    { id: 'msm', name: 'Mustard Seed MAZE', website: 'https://mustardseedmaze.com' },
    { id: 'nysno', name: 'Nysnø Climate Investments', website: 'https://nysno.no' },
    { id: 'sv', name: 'Start Ventures', website: 'https://startventures.example' },
  ];
  // Three SEPARATE weak links, each individually plausible-looking (an
  // alias row naming a firm that happens to normalize like another one),
  // chained by the union-find into one 4-member cluster.
  const aliases: Alias[] = [
    { catalog_id: 'btov', alias: 'b2venture' },
    { catalog_id: 'btov', alias: 'Mustard Seed MAZE' },
    // 'ø' has no canonical NFD decomposition (it's a base letter in
    // Unicode, not a diacritic composition), so normalizeName strips it as
    // a non-alphanumeric character rather than folding it to 'o' — the
    // alias has to spell the name out in full to land on the same
    // normalized value as the real row, not a hand-shortened "Nysno".
    { catalog_id: 'msm', alias: 'Nysnø Climate Investments' },
    { catalog_id: 'nysno', alias: 'Start Ventures' },
  ];

  it('still forms one transitive cluster (the tool must keep surfacing it for review)', () => {
    const clusters = findDuplicateClusters(rows, aliases);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].ids.sort()).toEqual(['btov', 'msm', 'nysno', 'sv']);
  });

  it('marks a >3-member alias-joined cluster as suspicious', () => {
    const [cluster] = findDuplicateClusters(rows, aliases);
    expect(cluster.suspicious).toBe(true);
  });

  it('attributes each edge to its own alias value, so "Not duplicates" knows exactly what to remove', () => {
    const [cluster] = findDuplicateClusters(rows, aliases);
    const aliasMatches = cluster.matches.filter((m) => m.reason === 'alias');
    const values = aliasMatches.map((m) => m.value).sort();
    // 'b2venture' never overlaps anything else, so it must NOT appear as an
    // edge (an edge requires >=2 distinct ids sharing the value).
    expect(values).not.toContain('b2venture');
    // 'ventures' is itself a stripped legal suffix, so "Start Ventures"
    // normalizes to just "start" — a real, separate quirk of normalizeName
    // that pre-dates this fix; noted rather than "corrected" here since
    // changing it is outside this fix's scope.
    expect(values).toEqual(['mustard seed maze', 'nysn climate investments', 'start'].sort());
    for (const m of aliasMatches) expect(m.ids).toHaveLength(2);
  });

  it('a group of only 2 alias-joined members is not flagged suspicious', () => {
    const twoRows = rows.slice(0, 2);
    const twoAliases: Alias[] = [{ catalog_id: 'btov', alias: 'Mustard Seed MAZE' }];
    const [cluster] = findDuplicateClusters(twoRows, twoAliases);
    expect(cluster.suspicious).toBe(false);
  });

  // Prompt 580b §A.2 — dismissing a pair must split the GROUP, not just
  // get remembered for next time (the pre-580b behavior: a cluster only
  // disappeared once EVERY pair in it was dismissed, because union-find
  // itself had no notion of dismissal). A genuine star — A directly tied
  // to both B and C by its own two separate aliases — plus one real,
  // unrelated match (C<->D) that must survive dismissing A's edges
  // untouched.
  describe('findDuplicateClusters — §A.2 group splitting from dismissed pairs', () => {
    // C<->D matches by DOMAIN, a completely independent mechanism from
    // A's own two NAME/alias edges — deliberately, so the one "real"
    // match in this fixture can never accidentally share a byValue entry
    // with A's edges (which is exactly what made an earlier draft of this
    // fixture, using a parenthetical for the C<->D match instead, need a
    // second dismissal to fully isolate A: its alias and D's parenthetical
    // both normalized to the same value as C's real name, a 3-way share
    // dismissing just one pair doesn't fully undo).
    const starRows: CatalogRow[] = [
      { id: 'a', name: 'Firm A', website: null },
      { id: 'b', name: 'Firm B', website: null },
      { id: 'c', name: 'Firm C', website: 'https://firmc.example' },
      { id: 'd', name: 'Firm D', website: 'https://firmc.example' },
    ];
    const starAliases: Alias[] = [
      { catalog_id: 'a', alias: 'Firm B' },
      { catalog_id: 'a', alias: 'Firm C' },
    ];

    it('with no dismissals, all four chain together into one cluster', () => {
      const clusters = findDuplicateClusters(starRows, starAliases);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].ids.sort()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('dismissing A-B only drops B; A stays tied to C (and D, via C)', () => {
      const clusters = findDuplicateClusters(starRows, starAliases, new Set([pairKey('a', 'b')]));
      expect(clusters).toHaveLength(1);
      expect(clusters[0].ids.sort()).toEqual(['a', 'c', 'd']);
    });

    it('dismissing both of A\'s edges isolates A and B, leaving the one real match (C-D) intact', () => {
      const dismissedPairs = new Set([pairKey('a', 'b'), pairKey('a', 'c')]);
      const clusters = findDuplicateClusters(starRows, starAliases, dismissedPairs);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].ids.sort()).toEqual(['c', 'd']);
      const allIds = clusters.flatMap((cl) => cl.ids);
      expect(allIds).not.toContain('a');
      expect(allIds).not.toContain('b');
    });
  });

  it('dismissing only the btov-msm pair drops just btov, leaving the rest of the chain grouped', () => {
    // The fixture's own edges are a CHAIN, not a star: btov->msm (via
    // btov's alias), msm->nysno (via msm's alias), nysno->sv (via nysno's
    // alias) — btov is connected to nothing but msm. Dismissing that one
    // pair must isolate btov alone while msm/nysno/sv stay grouped via
    // their own separate, undismissed edges.
    const dismissedPairs = new Set([pairKey('btov', 'msm')]);
    const clusters = findDuplicateClusters(rows, aliases, dismissedPairs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].ids.sort()).toEqual(['msm', 'nysno', 'sv']);
  });
});

// Prompt 573 §D — the single-candidate lookup used by investor
// self-registration to search the catalog before creating a new firm.
describe('findCatalogMatch', () => {
  const catalog: CatalogRow[] = [
    { id: 'nysno', name: 'Nysnø Climate Investments', website: 'https://nysno.no' },
    { id: 'maze', name: 'MAZE (Mustard Seed MAZE)', website: null },
  ];

  it('matches on domain, even when the candidate name differs entirely', () => {
    expect(findCatalogMatch({ name: 'Nysno', website: 'www.nysno.no' }, catalog)).toEqual({ id: 'nysno', reason: 'domain' });
  });

  it('falls back to normalized name when there is no domain to compare', () => {
    expect(findCatalogMatch({ name: 'Nysnø Climate Investments', website: null }, catalog)).toEqual({ id: 'nysno', reason: 'name' });
  });

  it('matches a parenthetical alternate name against the real row', () => {
    expect(findCatalogMatch({ name: 'Mustard Seed MAZE', website: null }, catalog)).toEqual({ id: 'maze', reason: 'name' });
  });

  it('matches a known alias', () => {
    const aliases: Alias[] = [{ catalog_id: 'maze', alias: 'Busy Angels SCR' }];
    expect(findCatalogMatch({ name: 'Busy Angels SCR', website: null }, catalog, aliases)).toEqual({ id: 'maze', reason: 'alias' });
  });

  it('returns null for a genuinely new firm', () => {
    expect(findCatalogMatch({ name: 'Totally New Ventures', website: 'https://totallynew.vc' }, catalog)).toBeNull();
  });
});
