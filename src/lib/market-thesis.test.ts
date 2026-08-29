import { describe, expect, it } from 'vitest';
import {
  sanitizeMarketThesisText, sanitizeMarketThesisArray, sanitizeMarketThesisFields,
  marketThesisContentChanged, nextMarketThesisVersion, marketThesisReadyForHypotheses, canHaveActiveHypotheses,
  MARKET_THESIS_TEXT_MAX, MARKET_THESIS_ARRAY_ITEM_MAX, MARKET_THESIS_ARRAY_MAX_ITEMS, MAX_ACTIVE_HYPOTHESES,
  type MarketThesisFields,
} from './market-thesis';

function blankFields(overrides: Partial<MarketThesisFields> = {}): MarketThesisFields {
  return {
    product_summary: null, core_problem: null, primary_user: null, economic_buyer: null,
    beachhead: null, geography: null, primary_use_case: null,
    adjacent_technologies: [], excluded_markets: [],
    ...overrides,
  };
}

describe('sanitizeMarketThesisText', () => {
  it('trims whitespace', () => {
    expect(sanitizeMarketThesisText('  hello  ')).toBe('hello');
  });
  it('caps at the max length', () => {
    const long = 'x'.repeat(MARKET_THESIS_TEXT_MAX + 50);
    expect(sanitizeMarketThesisText(long)).toBe('x'.repeat(MARKET_THESIS_TEXT_MAX));
  });
  it('turns an empty/whitespace-only string into null', () => {
    expect(sanitizeMarketThesisText('   ')).toBeNull();
    expect(sanitizeMarketThesisText('')).toBeNull();
  });
  it('turns a non-string into null', () => {
    expect(sanitizeMarketThesisText(42)).toBeNull();
    expect(sanitizeMarketThesisText(undefined)).toBeNull();
    expect(sanitizeMarketThesisText(null)).toBeNull();
  });
});

describe('sanitizeMarketThesisArray', () => {
  it('trims each entry and drops empties', () => {
    expect(sanitizeMarketThesisArray([' a ', '', '  ', 'b'])).toEqual(['a', 'b']);
  });
  it('caps each entry at the item max length', () => {
    const long = 'y'.repeat(MARKET_THESIS_ARRAY_ITEM_MAX + 20);
    expect(sanitizeMarketThesisArray([long])).toEqual(['y'.repeat(MARKET_THESIS_ARRAY_ITEM_MAX)]);
  });
  it('caps the array at the max item count', () => {
    const many = Array.from({ length: MARKET_THESIS_ARRAY_MAX_ITEMS + 5 }, (_, i) => `item${i}`);
    expect(sanitizeMarketThesisArray(many).length).toBe(MARKET_THESIS_ARRAY_MAX_ITEMS);
  });
  it('drops non-string entries and returns [] for a non-array', () => {
    expect(sanitizeMarketThesisArray(['a', 42, null, 'b'])).toEqual(['a', 'b']);
    expect(sanitizeMarketThesisArray('not an array')).toEqual([]);
    expect(sanitizeMarketThesisArray(undefined)).toEqual([]);
  });
});

describe('sanitizeMarketThesisFields', () => {
  it('sanitizes every field from a raw object', () => {
    const out = sanitizeMarketThesisFields({
      product_summary: ' A biochip for early detection. ', core_problem: 'Late diagnosis.',
      adjacent_technologies: [' biosensors ', 'lab-on-chip'], excluded_markets: [],
    });
    expect(out.product_summary).toBe('A biochip for early detection.');
    expect(out.core_problem).toBe('Late diagnosis.');
    expect(out.adjacent_technologies).toEqual(['biosensors', 'lab-on-chip']);
    expect(out.primary_user).toBeNull();
  });
});

describe('marketThesisContentChanged', () => {
  it('is true when there is no existing thesis', () => {
    expect(marketThesisContentChanged(null, blankFields())).toBe(true);
  });

  it('is false when nothing differs', () => {
    const fields = blankFields({ product_summary: 'A biochip.', adjacent_technologies: ['biosensors', 'mems'] });
    expect(marketThesisContentChanged(fields, { ...fields })).toBe(false);
  });

  it('is true when a single text field differs', () => {
    const existing = blankFields({ product_summary: 'A biochip.' });
    const next = blankFields({ product_summary: 'A different biochip.' });
    expect(marketThesisContentChanged(existing, next)).toBe(true);
  });

  it('is false when an array is only reordered (same elements as a set)', () => {
    const existing = blankFields({ adjacent_technologies: ['biosensors', 'mems'] });
    const next = blankFields({ adjacent_technologies: ['mems', 'biosensors'] });
    expect(marketThesisContentChanged(existing, next)).toBe(false);
  });

  it('is true when an array genuinely differs', () => {
    const existing = blankFields({ adjacent_technologies: ['biosensors'] });
    const next = blankFields({ adjacent_technologies: ['biosensors', 'mems'] });
    expect(marketThesisContentChanged(existing, next)).toBe(true);
  });
});

describe('nextMarketThesisVersion', () => {
  it('starts at 1 when there is no existing thesis', () => {
    expect(nextMarketThesisVersion(null, blankFields())).toBe(1);
  });

  it('does not increment on a no-op resubmit', () => {
    const fields = blankFields({ product_summary: 'A biochip.' });
    const existing = { ...fields, version: 3 };
    expect(nextMarketThesisVersion(existing, { ...fields })).toBe(3);
  });

  it('increments by exactly 1 on a real content change', () => {
    const existing = { ...blankFields({ product_summary: 'A biochip.' }), version: 3 };
    const next = blankFields({ product_summary: 'A biochip, revised.' });
    expect(nextMarketThesisVersion(existing, next)).toBe(4);
  });
});

describe('canHaveActiveHypotheses — the server-side 3-active cap', () => {
  it('allows creating up to the cap from zero', () => {
    expect(canHaveActiveHypotheses(0, MAX_ACTIVE_HYPOTHESES)).toBe(true);
  });
  it('allows the org to reach exactly the cap', () => {
    expect(canHaveActiveHypotheses(2, 1)).toBe(true);
  });
  it('rejects creating a 4th when 3 are already active', () => {
    expect(canHaveActiveHypotheses(MAX_ACTIVE_HYPOTHESES, 1)).toBe(false);
  });
  it('rejects a batch that would push the org over the cap even if it starts under it', () => {
    expect(canHaveActiveHypotheses(1, 3)).toBe(false);
  });
});

describe('marketThesisReadyForHypotheses', () => {
  it('is false with no thesis at all', () => {
    expect(marketThesisReadyForHypotheses(null)).toBe(false);
  });
  it('is false when either required field is missing', () => {
    expect(marketThesisReadyForHypotheses({ product_summary: 'A biochip.', core_problem: null })).toBe(false);
    expect(marketThesisReadyForHypotheses({ product_summary: null, core_problem: 'Late diagnosis.' })).toBe(false);
  });
  it('is true once both required fields are present', () => {
    expect(marketThesisReadyForHypotheses({ product_summary: 'A biochip.', core_problem: 'Late diagnosis.' })).toBe(true);
  });
});
