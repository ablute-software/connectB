import { describe, expect, it } from 'vitest';
import { sortPlansForDisplay, generosityInversionWarning, type OrderablePlan, type CreditPlan } from './ai-plans-order';

describe('sortPlansForDisplay — Prompt 748 §A', () => {
  it('orders built-in plans by PLANS (price), not by key', () => {
    const rows: OrderablePlan[] = [
      { key: 'garage', label: 'List of Suspects', is_custom: false },
      { key: 'idea', label: 'Elementary, my dear', is_custom: false },
      { key: 'motherfunding', label: "It's the butler!", is_custom: false },
    ];
    expect(sortPlansForDisplay(rows).map((p) => p.key)).toEqual(['idea', 'garage', 'motherfunding']);
  });

  it('puts every custom plan after every built-in plan, sorted by label', () => {
    const rows: OrderablePlan[] = [
      { key: 'zz_test', label: 'Zeta Batch', is_custom: true },
      { key: 'motherfunding', label: "It's the butler!", is_custom: false },
      { key: 'accel_9', label: 'Accelerator Batch 9', is_custom: true },
      { key: 'idea', label: 'Elementary, my dear', is_custom: false },
    ];
    expect(sortPlansForDisplay(rows).map((p) => p.key)).toEqual(['idea', 'motherfunding', 'accel_9', 'zz_test']);
  });

  it('does not crash or misplace a built-in-flagged row whose key PLANS does not recognize', () => {
    const rows: OrderablePlan[] = [
      { key: 'idea', label: 'Elementary, my dear', is_custom: false },
      { key: 'mystery_tier', label: 'Mystery Tier', is_custom: false },
      { key: 'garage', label: 'List of Suspects', is_custom: false },
    ];
    // Unrecognized key sinks to the end of the built-in group rather than
    // landing first or throwing.
    expect(sortPlansForDisplay(rows).map((p) => p.key)).toEqual(['idea', 'garage', 'mystery_tier']);
  });

  it('is stable when the list is already in order', () => {
    const rows: OrderablePlan[] = [
      { key: 'idea', label: 'Elementary, my dear', is_custom: false },
      { key: 'garage', label: 'List of Suspects', is_custom: false },
      { key: 'motherfunding', label: "It's the butler!", is_custom: false },
    ];
    expect(sortPlansForDisplay(rows)).toEqual(rows);
  });
});

describe('generosityInversionWarning — Prompt 748 §B', () => {
  const idea: CreditPlan = { key: 'idea', label: 'Elementary, my dear', monthly_ai_credits: 80, is_custom: false };
  const garage: CreditPlan = { key: 'garage', label: 'List of Suspects', monthly_ai_credits: 200, is_custom: false };
  const motherfunding: CreditPlan = { key: 'motherfunding', label: "It's the butler!", monthly_ai_credits: 500, is_custom: false };

  it('warns when editing the cheaper plan to exceed a pricier one', () => {
    const warning = generosityInversionWarning({ key: 'idea', label: 'Elementary, my dear' }, 250, [garage, motherfunding]);
    expect(warning).toBe('Elementary, my dear now has more credits than List of Suspects. Save anyway?');
  });

  it('warns when editing the pricier plan below a cheaper one', () => {
    const warning = generosityInversionWarning({ key: 'garage', label: 'List of Suspects' }, 50, [idea, motherfunding]);
    expect(warning).toBe('Elementary, my dear now has more credits than List of Suspects. Save anyway?');
  });

  it('does not warn for a normal, still-monotonic value', () => {
    expect(generosityInversionWarning({ key: 'idea', label: 'Elementary, my dear' }, 100, [garage, motherfunding])).toBeNull();
    expect(generosityInversionWarning({ key: 'garage', label: 'List of Suspects' }, 220, [idea, motherfunding])).toBeNull();
  });

  it('never warns when the edited plan is custom', () => {
    expect(generosityInversionWarning({ key: 'zz_test', label: 'Zeta Batch' }, 999999, [idea, garage, motherfunding])).toBeNull();
  });

  it('excludes custom plans from the comparison set entirely', () => {
    const customRow: CreditPlan = { key: 'zz_test', label: 'Zeta Batch', monthly_ai_credits: 1, is_custom: true };
    // idea (cheap) now way more generous than a custom plan — never warned about, custom has no real price.
    expect(generosityInversionWarning({ key: 'idea', label: 'Elementary, my dear' }, 5000, [customRow])).toBeNull();
  });

  it('skips the edited plan itself if it appears in otherPlans (no self-comparison)', () => {
    const selfRow: CreditPlan = { key: 'garage', label: 'List of Suspects', monthly_ai_credits: 10, is_custom: false };
    expect(generosityInversionWarning({ key: 'garage', label: 'List of Suspects' }, 999, [selfRow])).toBeNull();
  });
});
