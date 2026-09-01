import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANES, GROWTH_SIGNAL_TIERS, growthSignalTierPromptList, shuffledTiersForOrg, tierRank,
} from './growth-signal-tiers';

describe('GROWTH_SIGNAL_TIERS', () => {
  it('has exactly 15 entries', () => {
    expect(GROWTH_SIGNAL_TIERS).toHaveLength(15);
  });

  it('has unique ids and non-empty labels', () => {
    const ids = GROWTH_SIGNAL_TIERS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of GROWTH_SIGNAL_TIERS) expect(t.label.trim().length).toBeGreaterThan(0);
  });

  it('keeps the agreed strength order at both ends', () => {
    expect(GROWTH_SIGNAL_TIERS[0].id).toBe('recurring-revenue');
    expect(GROWTH_SIGNAL_TIERS[14].id).toBe('press-recognition');
    expect(tierRank('recurring-revenue')).toBe(1);
    expect(tierRank('investors-committed')).toBe(10);
    expect(tierRank('not-a-tier')).toBeNull();
  });

  // The mapping is only useful if every suggested lane is a lane that
  // actually gets seeded — a typo here would silently drop the founder's
  // event into an unassigned category.
  it('suggests only lanes that exist in DEFAULT_LANES', () => {
    const labels = new Set(DEFAULT_LANES.map((l) => l.label));
    for (const t of GROWTH_SIGNAL_TIERS) expect(labels.has(t.defaultLane)).toBe(true);
  });

  it('leaves Regulatory & IP unmapped by default', () => {
    expect(GROWTH_SIGNAL_TIERS.some((t) => t.defaultLane === 'Regulatory & IP')).toBe(false);
  });

  it('renders a numbered prompt list, strongest first', () => {
    const lines = growthSignalTierPromptList().split('\n');
    expect(lines).toHaveLength(15);
    expect(lines[0]).toBe('1. Paid, recurring revenue with a signed contract');
    expect(lines[9]).toBe('10. Other investors already committed to this round');
  });
});

describe('shuffledTiersForOrg', () => {
  it('is stable for the same org across calls', () => {
    const a = shuffledTiersForOrg('org-abc').map((t) => t.id);
    const b = shuffledTiersForOrg('org-abc').map((t) => t.id);
    expect(a).toEqual(b);
  });

  it('returns all 15 tiers exactly once', () => {
    const ids = shuffledTiersForOrg('org-abc').map((t) => t.id);
    expect(ids).toHaveLength(15);
    expect(new Set(ids)).toEqual(new Set(GROWTH_SIGNAL_TIERS.map((t) => t.id)));
  });

  it('actually shuffles — not the source order', () => {
    const source = GROWTH_SIGNAL_TIERS.map((t) => t.id);
    expect(shuffledTiersForOrg('org-abc').map((t) => t.id)).not.toEqual(source);
  });

  it('differs between orgs', () => {
    expect(shuffledTiersForOrg('org-abc').map((t) => t.id))
      .not.toEqual(shuffledTiersForOrg('org-xyz').map((t) => t.id));
  });

  it('does not mutate the source list', () => {
    const before = GROWTH_SIGNAL_TIERS.map((t) => t.id);
    shuffledTiersForOrg('org-abc');
    expect(GROWTH_SIGNAL_TIERS.map((t) => t.id)).toEqual(before);
  });
});
