import { describe, expect, it } from 'vitest';
import { canInvestorMessage } from './deal-messages';

describe('canInvestorMessage', () => {
  it('refuses a card that does not exist (not in this investor\'s Pipeline)', () => {
    expect(canInvestorMessage(null)).toBe(false);
    expect(canInvestorMessage(undefined)).toBe(false);
  });

  it('refuses a bare discovery match — no interest expressed, no grant', () => {
    expect(canInvestorMessage({ status: 'open', hasDataRoomAccess: false })).toBe(false);
  });

  it('refuses a passed relationship with no active grant', () => {
    expect(canInvestorMessage({ status: 'passed', hasDataRoomAccess: false })).toBe(false);
  });

  it('allows once interest has been expressed, even without a data-room grant', () => {
    expect(canInvestorMessage({ status: 'interested', hasDataRoomAccess: false })).toBe(true);
  });

  it('allows with an active data-room grant, even before any decision', () => {
    expect(canInvestorMessage({ status: 'open', hasDataRoomAccess: true })).toBe(true);
  });
});
