import { describe, expect, it } from 'vitest';
import type { FactView } from './market-facts-view';
import {
  MARKET_SIZE_WHY_IT_MATTERS,
  describeAvailableMaterial,
  methodLabel,
  synthesiseMarketSize,
} from './market-size-synthesis';

function fact(overrides: Partial<FactView> & { methodology?: string | null } = {}): FactView {
  const { methodology, payload, ...rest } = overrides;
  return {
    id: 'fact-1',
    factType: 'market_size',
    validationStatus: 'valid',
    validation: { status: 'valid', missing: [], errors: [], flags: [] },
    verificationStatus: 'founder_reported',
    evidence: [],
    ...rest,
    // Built LAST and merged field by field: spreading `rest` over a
    // pre-built payload replaces the whole object, which silently dropped
    // `methodology` and made a "two bottom-up facts" fixture only have one.
    // The test caught it; the fixture was the thing that was wrong.
    payload: {
      marketDefinition: 'Home diagnostics', geography: 'EU', metric: 'TAM',
      estimateShape: 'point', value: 1_800_000_000, lowerBound: null, upperBound: null,
      currency: 'EUR', asOfYear: 2025,
      methodology: methodology === undefined ? 'bottom_up' : methodology,
      ...(payload ?? {}),
    },
  } as FactView;
}

describe('synthesiseMarketSize — the headline may only come from bottom-up', () => {
  it('ignores external_estimate and other when a bottom_up fact exists', () => {
    const s = synthesiseMarketSize([
      fact({ id: 'ext', methodology: 'external_estimate', payload: { value: 16_200_000_000 } as FactView['payload'] }),
      fact({ id: 'oth', methodology: 'other' }),
      fact({ id: 'bu', methodology: 'bottom_up' }),
    ]);

    expect(s.headline).not.toBeNull();
    expect(s.headline!.factIds).toEqual(['bu']);
    // The other two are not lost — they stay beside it, labelled.
    expect(s.sideEvidence.map((e) => e.factId).sort()).toEqual(['ext', 'oth']);
    expect(s.gap).toBeNull();
  });

  it('this is ablute_ today: 12 valid figures, none bottom-up, so no headline', () => {
    // Measured 31/08: 12 valid market_size facts, 0 bottom_up, 10
    // external_estimate, 2 with no methodology; 51 incomplete.
    const valid = [
      ...Array.from({ length: 10 }, (_, i) => fact({ id: `ext-${i}`, methodology: 'external_estimate' })),
      ...Array.from({ length: 2 }, (_, i) => fact({ id: `none-${i}`, methodology: null })),
    ];
    const incomplete = Array.from({ length: 51 }, (_, i) => fact({
      id: `inc-${i}`, methodology: 'external_estimate', validationStatus: 'incomplete',
    }));

    const s = synthesiseMarketSize([...valid, ...incomplete]);

    expect(s.headline).toBeNull();
    expect(s.gap?.reason).toBe('no_bottom_up');
    expect(s.gap?.validNonBottomUp).toBe(12);
    expect(s.gap?.incomplete).toBe(51);
    expect(s.sideEvidence).toHaveLength(12);
  });

  it('never invents a merged range out of several bottom-up facts', () => {
    const s = synthesiseMarketSize([
      fact({ id: 'a', methodology: 'bottom_up' }),
      fact({ id: 'b', methodology: 'bottom_up', payload: { value: 2_600_000_000 } as FactView['payload'] }),
    ]);
    // Two lines, two ids — not one invented "1.8–2.6bn" that no fact states.
    expect(s.headline!.lines).toHaveLength(2);
    expect(s.headline!.factIds).toEqual(['a', 'b']);
  });

  it('an incomplete bottom-up fact is not a headline either', () => {
    const s = synthesiseMarketSize([fact({ methodology: 'bottom_up', validationStatus: 'incomplete' })]);
    expect(s.headline).toBeNull();
    expect(s.gap?.reason).toBe('no_valid');
  });

  it('growth facts never reach this reading at all', () => {
    const s = synthesiseMarketSize([fact({ id: 'g', factType: 'growth', methodology: 'bottom_up' })]);
    expect(s.headline).toBeNull();
    expect(s.gap?.reason).toBe('no_facts');
  });

  it('no facts at all says so, distinctly from having facts that do not qualify', () => {
    expect(synthesiseMarketSize([]).gap?.reason).toBe('no_facts');
  });
});

describe('confidence — never more than the weakest evidence behind it', () => {
  it('founder-reported bottom-up is never described as confident or verified', () => {
    const s = synthesiseMarketSize([fact({ methodology: 'bottom_up', verificationStatus: 'founder_reported' })]);
    expect(s.headline!.confidence).toBe('founder_reported');
    expect(s.headline!.confidenceLabel).toBe('Reported by you — not yet corroborated by an outside source');
    expect(s.headline!.confidenceLabel.toLowerCase()).not.toContain('confident');
    expect(s.headline!.confidenceLabel.toLowerCase()).not.toContain('verified');
  });

  it('one weak fact drags the whole reading down — never the strongest wins', () => {
    const s = synthesiseMarketSize([
      fact({ id: 'strong', methodology: 'bottom_up', verificationStatus: 'corroborated' }),
      fact({ id: 'weak', methodology: 'bottom_up', verificationStatus: 'founder_reported' }),
    ]);
    expect(s.headline!.confidence).toBe('founder_reported');
  });

  it('reports corroborated only when every fact behind it is', () => {
    const s = synthesiseMarketSize([
      fact({ id: 'a', methodology: 'bottom_up', verificationStatus: 'corroborated' }),
      fact({ id: 'b', methodology: 'bottom_up', verificationStatus: 'corroborated' }),
    ]);
    expect(s.headline!.confidence).toBe('corroborated');
  });
});

describe('the rest of the reading', () => {
  it('always says why it matters, headline or not', () => {
    expect(synthesiseMarketSize([]).whyItMatters).toBe(MARKET_SIZE_WHY_IT_MATTERS);
    expect(synthesiseMarketSize([fact({ methodology: 'bottom_up' })]).whyItMatters).toBe(MARKET_SIZE_WHY_IT_MATTERS);
  });

  it('describes what the founder does have, so an empty headline is not an empty card', () => {
    expect(describeAvailableMaterial({ reason: 'no_bottom_up', sentence: '', validNonBottomUp: 12, incomplete: 51 }))
      .toBe('Sherlock does have 12 complete figures from other methods and 51 more still missing a detail.');
    expect(describeAvailableMaterial({ reason: 'no_bottom_up', sentence: '', validNonBottomUp: 1, incomplete: 0 }))
      .toBe('Sherlock does have 1 complete figure from other methods.');
    expect(describeAvailableMaterial({ reason: 'no_facts', sentence: '', validNonBottomUp: 0, incomplete: 0 })).toBe('');
  });

  it('labels methods in words, never a raw key', () => {
    expect(methodLabel('bottom_up')).toBe('bottom-up');
    expect(methodLabel('external_estimate')).toBe('external estimate');
    expect(methodLabel(null)).toBe('method not stated');
  });
});
