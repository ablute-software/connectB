import { describe, expect, it } from 'vitest';
import { hasAnythingToShow, readinessChips, type ReadinessBreakdown } from './readiness-strip';

const b = (o: Partial<ReadinessBreakdown> = {}): ReadinessBreakdown => ({
  peopleCount: 0, linkedinCount: 0, hookCount: 0, hasForm: false, hasEmail: false, ...o,
});

describe('readinessChips', () => {
  it('reads like the prompt asks for a well-served firm', () => {
    const chips = readinessChips(b({ peopleCount: 18, linkedinCount: 14, hasForm: true, hasEmail: true }));
    expect(chips.map((c) => c.label)).toEqual(['18 people', '14 on LinkedIn', 'form ✓', 'email ✓', '0 hooks']);
  });

  it('shows zeros greyed rather than hiding them', () => {
    // "0 hooks" is why preflight will refuse the draft; hiding it would leave
    // the founder to find that out at the compose step.
    const chips = readinessChips(b({ peopleCount: 16, linkedinCount: 0, hasEmail: true }));
    expect(chips.find((c) => c.label === '14 on LinkedIn')).toBeUndefined();
    expect(chips.find((c) => c.label === '0 on LinkedIn')?.muted).toBe(true);
    expect(chips.find((c) => c.label === '0 hooks')?.muted).toBe(true);
  });

  it('omits a channel chip only when the channel does not exist', () => {
    expect(readinessChips(b({ hasForm: false, hasEmail: true })).map((c) => c.label)).toContain('email ✓');
    expect(readinessChips(b({ hasForm: false, hasEmail: true })).map((c) => c.label)).not.toContain('form ✓');
  });

  it('says "1 person" and "1 hook", not "1 people"', () => {
    const chips = readinessChips(b({ peopleCount: 1, hookCount: 1 }));
    expect(chips.map((c) => c.label)).toContain('1 person');
    expect(chips.map((c) => c.label)).toContain('1 hook');
  });
});

describe('hasAnythingToShow', () => {
  it('is false for the Hoxton case, so the strip stays hidden', () => {
    expect(hasAnythingToShow(b())).toBe(false);
  });

  it('is true when there is a channel even with no people', () => {
    expect(hasAnythingToShow(b({ hasForm: true }))).toBe(true);
  });

  it('is true when there are people even with no channel', () => {
    expect(hasAnythingToShow(b({ peopleCount: 3 }))).toBe(true);
  });
});
