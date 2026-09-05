import { describe, expect, it } from 'vitest';
import { findDuplicateClusters, normalizeDomain, normalizeName, type Alias, type CatalogRow } from './catalog-dedupe';

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
});
