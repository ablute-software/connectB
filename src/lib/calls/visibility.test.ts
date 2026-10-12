// Prompt 909 (adjustment for 907) — a test organisation's call is never listed to real startups.
import { describe, expect, it } from 'vitest';
import { appearsInOpenCalls, reachableByLink } from './visibility';

describe('"Open calls"', () => {
  it('a real organisation\'s listed call is seen by everybody', () => {
    expect(appearsInOpenCalls({ visibility: 'listed', promoterIsTest: false }, { isTestAccount: false })).toBe(true);
    expect(appearsInOpenCalls({ visibility: 'listed', promoterIsTest: false }, { isTestAccount: true })).toBe(true);
  });
  it('a TEST organisation\'s call is seen only by test accounts, never by a real startup', () => {
    expect(appearsInOpenCalls({ visibility: 'listed', promoterIsTest: true }, { isTestAccount: false })).toBe(false);
    expect(appearsInOpenCalls({ visibility: 'listed', promoterIsTest: true }, { isTestAccount: true })).toBe(true);
  });
  it('a call that is "reachable only through its link" is in nobody\'s list', () => {
    expect(appearsInOpenCalls({ visibility: 'unlisted', promoterIsTest: false }, { isTestAccount: true })).toBe(false);
  });
  it('whoever has the link reaches the call, test organisation or not', () => {
    expect(reachableByLink()).toBe(true);
  });
});
