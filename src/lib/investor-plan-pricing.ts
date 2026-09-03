// Prompt 550 — the price a card shows, in its own module.
//
// Extracted out of InvestorPlanGrid.tsx so it can be unit-tested: vitest here
// cannot parse JSX on import, so a test that reaches into the .tsx fails
// before it runs a single assertion. The rule the prompt actually cares about
// — "the annual toggle changes the displayed price" — is arithmetic, and this
// is where it lives.
import type { INVESTOR_PLANS } from './plans';

export type BillingMode = 'monthly' | 'annual';

export function priceFor(plan: typeof INVESTOR_PLANS[number], billing: BillingMode): number {
  return billing === 'monthly' ? plan.monthlyEur : (plan.annualPerMonthEur ?? plan.monthlyEur);
}
