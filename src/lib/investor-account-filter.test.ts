import { describe, expect, it } from 'vitest';
import { isRegisteredInvestorAccount } from './investor-account-filter';

// Prompt 123 §C.4 regression — "new sign-ups wiring": a catalog entity that
// has never had a real user join it must NOT appear as an account; the
// moment its first membership row goes active, it must.
describe('isRegisteredInvestorAccount', () => {
  it('excludes a catalog-only entity with zero linked seats', () => {
    expect(isRegisteredInvestorAccount(0)).toBe(false);
  });
  it('includes an entity the instant it has its first seat', () => {
    expect(isRegisteredInvestorAccount(1)).toBe(true);
  });
  it('includes an entity with many seats', () => {
    expect(isRegisteredInvestorAccount(12)).toBe(true);
  });
});
