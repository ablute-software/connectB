import { describe, expect, it } from 'vitest';
import { countCriticalGaps, insufficientInfoDialog, shouldWarnBeforeSpending } from './ai-spend-confirm';
import type { WalletStatus } from './ai-credits';

describe('countCriticalGaps', () => {
  it('counts only critical and high severity — the exact filter ReviewPanel.tsx already applies', () => {
    const gaps = [{ severity: 'critical' }, { severity: 'high' }, { severity: 'medium' }, { severity: 'high' }];
    expect(countCriticalGaps(gaps)).toBe(3);
  });

  it('is zero for an empty or all-medium gap list', () => {
    expect(countCriticalGaps([])).toBe(0);
    expect(countCriticalGaps([{ severity: 'medium' }])).toBe(0);
  });
});

describe('shouldWarnBeforeSpending', () => {
  it('warns whenever there is at least one critical gap', () => {
    expect(shouldWarnBeforeSpending(1)).toBe(true);
    expect(shouldWarnBeforeSpending(5)).toBe(true);
  });

  it('never warns at zero — thin data with nothing critical missing is not thin enough to interrupt', () => {
    expect(shouldWarnBeforeSpending(0)).toBe(false);
  });
});

describe('insufficientInfoDialog', () => {
  const wallet: WalletStatus = { used: 3, monthlyLimit: 200, remaining: 197, resetAt: '2026-10-21T00:00:00Z', actionCost: 1, actionEnabled: true, isTest: false };

  it('names the action and the exact count, singular vs plural', () => {
    const d1 = insufficientInfoDialog({ actionLabel: 'Investability ranking', criticalGapCount: 1, wallet });
    expect(d1.message).toContain('1 crucial question is still unanswered');
    const d3 = insufficientInfoDialog({ actionLabel: 'Investability ranking', criticalGapCount: 3, wallet });
    expect(d3.message).toContain('3 crucial questions are still unanswered');
  });

  it('states the credit cost and this-month usage', () => {
    const d = insufficientInfoDialog({ actionLabel: 'Investability ranking', criticalGapCount: 1, wallet });
    expect(d.message).toContain('This uses 1 credit — you\'ve used 3 of 200 this month.');
  });

  it('an is_test wallet says unlimited rather than a specific count', () => {
    const testWallet: WalletStatus = { ...wallet, isTest: true };
    const d = insufficientInfoDialog({ actionLabel: 'Investability ranking', criticalGapCount: 1, wallet: testWallet });
    expect(d.message).toContain('unlimited AI credits');
    expect(d.message).not.toContain('you\'ve used');
  });

  it('degrades gracefully with no wallet status at all (still names the gaps, no usage line)', () => {
    const d = insufficientInfoDialog({ actionLabel: 'Investability ranking', criticalGapCount: 2, wallet: null });
    expect(d.message).toContain('2 crucial questions are still unanswered');
    expect(d.message).not.toContain('credit');
  });

  it('never blocks — always Confirm/Cancel, never destructive', () => {
    const d = insufficientInfoDialog({ actionLabel: 'Market data research', criticalGapCount: 1, wallet });
    expect(d.confirmLabel).toBe('Continue anyway');
    expect(d.cancelLabel).toBe('Fill in more information first');
    expect(d.destructive).toBe(false);
  });
});
