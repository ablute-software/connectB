import { describe, expect, it } from 'vitest';
import { computeReportInputSnapshot, diffReportInputs, legacyRoundTargetHint, type InvestabilitySnapshotInput } from './report-staleness';

function makeInputs(overrides: Partial<InvestabilitySnapshotInput> = {}): InvestabilitySnapshotInput {
  return {
    company: { name: 'Sherlock Deal', sector: 'digital health', stage: 'seed', round_target_eur: 270000, country: 'PT', one_liner: 'x' },
    facts: ['fact A', 'fact B'],
    pipeline: { total_investors: 12, by_status: { not_contacted: 8, contacted: 4 }, passes: 2 },
    ...overrides,
  };
}

describe('computeReportInputSnapshot — deterministic regardless of key/array order', () => {
  it('produces byte-identical output for the same data with keys inserted in a different order', () => {
    const a = computeReportInputSnapshot('investability', makeInputs({ pipeline: { total_investors: 12, by_status: { not_contacted: 8, contacted: 4 } } }));
    const b = computeReportInputSnapshot('investability', makeInputs({ pipeline: { by_status: { contacted: 4, not_contacted: 8 }, total_investors: 12 } }));
    expect(a).toBe(b);
  });

  it('sorts facts regardless of input order — the founder confirming facts in a different order is not a change', () => {
    const a = computeReportInputSnapshot('investability', makeInputs({ facts: ['fact A', 'fact B'] }));
    const b = computeReportInputSnapshot('investability', makeInputs({ facts: ['fact B', 'fact A'] }));
    expect(a).toBe(b);
  });
});

describe('diffReportInputs — Prompt 729 §3.1, the three required cases', () => {
  it('case 1 — identical inputs: not stale, no changes', () => {
    const inputs = makeInputs();
    const prevSnapshot = computeReportInputSnapshot('investability', inputs);
    const result = diffReportInputs(prevSnapshot, inputs);
    expect(result).toEqual({ stale: false, changes: [] });
  });

  it('case 2 — only the round target changed: stale, one change, the exact real incident\'s numbers', () => {
    const prevSnapshot = computeReportInputSnapshot('investability', makeInputs({ company: { ...makeInputs().company, round_target_eur: 400000 } }));
    const current = makeInputs({ company: { ...makeInputs().company, round_target_eur: 270000 } });
    const result = diffReportInputs(prevSnapshot, current);
    expect(result.stale).toBe(true);
    expect(result.changes).toEqual([{ label: 'Round target', from: '€400,000', to: '€270,000' }]);
  });

  it('case 3 — facts and pipeline both changed: stale, both labeled', () => {
    const prevSnapshot = computeReportInputSnapshot('investability', makeInputs({
      facts: ['fact A', 'fact B'], pipeline: { total_investors: 12 },
    }));
    const current = makeInputs({ facts: ['fact A', 'fact C', 'fact D'], pipeline: { total_investors: 14 } });
    const result = diffReportInputs(prevSnapshot, current);
    expect(result.stale).toBe(true);
    expect(result.changes).toContainEqual({ label: 'Confirmed facts', from: '2', to: '3 (+2 / -1)' });
    expect(result.changes).toContainEqual({ label: 'Pipeline', from: '12 investors', to: '14 investors' });
  });

  it('no prior snapshot at all (every run today): never claims staleness on its own', () => {
    expect(diffReportInputs(null, makeInputs())).toEqual({ stale: false, changes: [] });
    expect(diffReportInputs(undefined, makeInputs())).toEqual({ stale: false, changes: [] });
  });

  it('an unparseable stored snapshot degrades to "not stale", never throws', () => {
    expect(diffReportInputs('not valid json{{{', makeInputs())).toEqual({ stale: false, changes: [] });
  });
});

describe('legacyRoundTargetHint — the real production incident this prompt reported', () => {
  it('detects "€400k" in report text when the current target is €270,000', () => {
    const hint = legacyRoundTargetHint('The €400k target is ambitious given current traction.', 270000);
    expect(hint).toEqual({ label: 'Round target mentioned in the report', from: '€400k', to: '€270,000' });
  });

  it('detects "€400,000" and "€400.000" forms too', () => {
    expect(legacyRoundTargetHint('Raising €400,000 in this round.', 270000)?.from).toBe('€400,000');
    expect(legacyRoundTargetHint('A ronda de €400.000 está...', 270000)?.from).toBe('€400.000');
  });

  it('finds no hint when the mentioned amount matches the current target — agreement is not staleness', () => {
    expect(legacyRoundTargetHint('The €270,000 target is realistic.', 270000)).toBeNull();
  });

  it('finds no hint when no € amount appears in the text at all', () => {
    expect(legacyRoundTargetHint('This startup shows strong traction and a capable team.', 270000)).toBeNull();
  });

  it('returns null when the current target itself is unknown — nothing to compare against', () => {
    expect(legacyRoundTargetHint('The €400k target...', null)).toBeNull();
  });
});
