import { describe, expect, it } from 'vitest';
import { decisionDedupKey, isNotStartupFaultChip, swipePassReasonForChips } from './investor-signal-events';

describe('isNotStartupFaultChip', () => {
  it('marks the three chips that are about the investor, not the startup', () => {
    expect(isNotStartupFaultChip('portfolio_competitor')).toBe(true);
    expect(isNotStartupFaultChip('no_capacity_now')).toBe(true);
    expect(isNotStartupFaultChip('already_knew')).toBe(true);
  });

  it('leaves every other chip unmarked', () => {
    expect(isNotStartupFaultChip('too_early')).toBe(false);
    expect(isNotStartupFaultChip('sector_thesis')).toBe(false);
    expect(isNotStartupFaultChip('valuation')).toBe(false);
  });
});

describe('swipePassReasonForChips', () => {
  it('maps the first chip that has a fixed-category equivalent', () => {
    expect(swipePassReasonForChips(['too_early'])).toBe('too_early');
    expect(swipePassReasonForChips(['sector_thesis'])).toBe('outside_thesis');
    expect(swipePassReasonForChips(['ticket_size'])).toBe('ticket_too_small');
  });

  it('picks the FIRST mappable chip when several are selected', () => {
    expect(swipePassReasonForChips(['valuation', 'ticket_size', 'too_early'])).toBe('ticket_too_small');
  });

  it('falls back to "other" for a chip with no fixed-category equivalent, or no chips at all', () => {
    expect(swipePassReasonForChips(['valuation'])).toBe('other');
    expect(swipePassReasonForChips(['no_capacity_now', 'already_knew'])).toBe('other');
    expect(swipePassReasonForChips([])).toBe('other');
  });
});

describe('decisionDedupKey', () => {
  it('is stable and unique per (firm, org, decision)', () => {
    const key = decisionDedupKey('firm-1', 'org-1', 'decision-1');
    expect(key).toBe('firm-1:org-1:decisao:decision-1');
    expect(decisionDedupKey('firm-1', 'org-1', 'decision-2')).not.toBe(key);
    expect(decisionDedupKey('firm-2', 'org-1', 'decision-1')).not.toBe(key);
  });
});
