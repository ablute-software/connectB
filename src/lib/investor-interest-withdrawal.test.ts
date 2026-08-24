import { describe, it, expect } from 'vitest';
import { canWithdrawInterest, type WithdrawWindowSignals } from './investor-interest-withdrawal';

const OPEN: WithdrawWindowSignals = {
  grantCreatedAfterDecision: false, founderMessagedAfterDecision: false,
  interestLevelEscalated: false, founderTaskStillOpen: true,
};

describe('canWithdrawInterest', () => {
  it('allows withdrawal when every signal is clean and the task is confirmed still open', () => {
    expect(canWithdrawInterest(OPEN)).toBe(true);
  });

  it('a grant created after the decision closes the window', () => {
    expect(canWithdrawInterest({ ...OPEN, grantCreatedAfterDecision: true })).toBe(false);
  });

  it('a founder message after the decision closes the window', () => {
    expect(canWithdrawInterest({ ...OPEN, founderMessagedAfterDecision: true })).toBe(false);
  });

  it('an escalated interest level closes the window', () => {
    expect(canWithdrawInterest({ ...OPEN, interestLevelEscalated: true })).toBe(false);
  });

  it('a closed (done) founder task closes the window', () => {
    expect(canWithdrawInterest({ ...OPEN, founderTaskStillOpen: false })).toBe(false);
  });

  it('fail-closed: an indeterminate (untracked) task refuses, same as a closed one', () => {
    expect(canWithdrawInterest({ ...OPEN, founderTaskStillOpen: null })).toBe(false);
  });

  it('any single closing signal is enough, regardless of the others', () => {
    expect(canWithdrawInterest({
      grantCreatedAfterDecision: false, founderMessagedAfterDecision: true,
      interestLevelEscalated: true, founderTaskStillOpen: true,
    })).toBe(false);
  });
});
