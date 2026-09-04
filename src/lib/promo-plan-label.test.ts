// Prompt 567 — the promo-code list showed internal slugs.
//
// The back-office row printed `applicable_plans.join(', ')`, so "garage,
// motherfunding" sat beside properly formatted labels ("Free trial", "🏅
// Pioneer", "Redemption window closed"). Those slugs are real, current, paid
// plans — nothing was renamed or removed; only the display was wrong.
//
// The mapping lives inline in the page (a one-line lookup over PLANS, not a
// second slug-to-name table), so what is pinned here is the rule it must
// follow, including the fallback the obvious helper gets wrong.
import { describe, expect, it } from 'vitest';
import { PLANS, planName } from '@/lib/plans';

const planLabelForSlug = (slug: string): string =>
  PLANS.find((p) => p.tier === slug)?.name ?? slug;

describe('promo-code plan labels', () => {
  it('shows the commercial name for the two promo-eligible plans', () => {
    expect(planLabelForSlug('garage')).toBe('List of Suspects');
    expect(planLabelForSlug("motherfunding")).toBe("It's the butler!");
  });

  it('renders a whole applicable_plans array the way the row does', () => {
    expect(['garage', 'motherfunding'].map(planLabelForSlug).join(', '))
      .toBe("List of Suspects, It's the butler!");
  });

  it('falls back to the raw slug for a plan that no longer exists', () => {
    // The requirement: show SOMETHING, never undefined or blank.
    expect(planLabelForSlug('some_removed_plan')).toBe('some_removed_plan');
    expect(planLabelForSlug('')).toBe('');
  });

  it('is not planName(), which would mislabel an unknown slug as the free tier', () => {
    // planRow() resolves anything unknown to PLANS[0]. Using it here would
    // turn a removed plan into "Elementary, my dear" — a confident wrong
    // answer, which is worse than the slug.
    expect(planName('some_removed_plan' as never)).toBe(PLANS[0].name);
    expect(planLabelForSlug('some_removed_plan')).not.toBe(PLANS[0].name);
  });
});
