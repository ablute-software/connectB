import { describe, expect, it } from 'vitest';
import { toInvestorFacingLevelRows, type InterestLevelRowFull } from './investor-interest-level-db';

// relatorio_verificacao_..._8143c75_p136 §3 — the founder's own private
// note used to ride along in the full row object sent to the investor's
// browser. This locks in the fix: the projection must drop `note` (and
// every other founder-internal field) regardless of what's added to
// InterestLevelRowFull in the future.
describe('toInvestorFacingLevelRows', () => {
  const full: InterestLevelRowFull[] = [
    {
      id: 'row-1', level: 3, status: 'denied', requestedAt: '2026-08-01T00:00:00.000Z', decidedAt: '2026-08-02T00:00:00.000Z',
      note: 'Denied — tried to lowball us last round.', shareDirectEmail: false,
    },
  ];

  it('keeps only level and status', () => {
    const result = toInvestorFacingLevelRows(full);
    expect(result).toEqual([{ level: 3, status: 'denied' }]);
  });

  it('never includes the founder\'s private note under any key', () => {
    const result = toInvestorFacingLevelRows(full);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('lowball');
    expect(Object.keys(result[0])).toEqual(['level', 'status']);
  });

  it('drops id, requestedAt, decidedAt, and shareDirectEmail too', () => {
    const result = toInvestorFacingLevelRows(full);
    expect('id' in result[0]).toBe(false);
    expect('requestedAt' in result[0]).toBe(false);
    expect('decidedAt' in result[0]).toBe(false);
    expect('shareDirectEmail' in result[0]).toBe(false);
    expect('note' in result[0]).toBe(false);
  });
});
