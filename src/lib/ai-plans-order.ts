// Prompt 748 §A/§B — pure, no I/O. The `plans` table has no ordering column
// of its own (deliberately — see this prompt's own "Não fazer"); price is
// derived from PLANS (plans.ts), the single source of truth already used
// for what a founder is billed. Built-in tiers sort by PLANS's own order
// (== ascending monthlyEur, confirmed: idea 0, garage 85, motherfunding
// 149); custom plans have no real price to sort by, so they sort by label
// and always come after every built-in tier.
import { PLANS } from './plans';

export interface OrderablePlan { key: string; label: string; is_custom: boolean }

const BUILTIN_ORDER = new Map(PLANS.map((p, i) => [p.tier as string, i]));

export function sortPlansForDisplay<T extends OrderablePlan>(plans: T[]): T[] {
  return [...plans].sort((a, b) => {
    if (a.is_custom !== b.is_custom) return a.is_custom ? 1 : -1;
    if (!a.is_custom) {
      // A built-in-flagged row whose key isn't in PLANS (shouldn't happen,
      // but the prompt explicitly asks for this not to break the list)
      // sinks to the end of the built-in group instead of crashing or
      // silently landing first.
      const ai = BUILTIN_ORDER.get(a.key) ?? Number.POSITIVE_INFINITY;
      const bi = BUILTIN_ORDER.get(b.key) ?? Number.POSITIVE_INFINITY;
      if (ai !== bi) return ai - bi;
    }
    return a.label.localeCompare(b.label);
  });
}

export interface CreditPlan { key: string; label: string; monthly_ai_credits: number; is_custom: boolean }

// Prompt 748 §B — "a cheaper plan just became more generous than a pricier
// one" check. Only ever fires for the plan actually being saved, against
// every OTHER built-in plan at a different price point — a custom plan has
// no real price, so it's excluded both as the subject and as a comparison
// target ("Um plano custom fica de fora desta comparação"). Returns the
// first inversion found (there can be at most one meaningful pair to name
// with only 3 built-in tiers today); null means safe to save without a warning.
export function generosityInversionWarning(
  edited: { key: string; label: string }, newCredits: number, otherPlans: CreditPlan[],
): string | null {
  const editedPrice = PLANS.find((p) => p.tier === edited.key)?.monthlyEur;
  if (editedPrice === undefined) return null; // edited plan is custom (or an unknown key) — not priced, not comparable

  for (const other of otherPlans) {
    if (other.is_custom || other.key === edited.key) continue;
    const otherPrice = PLANS.find((p) => p.tier === other.key)?.monthlyEur;
    if (otherPrice === undefined || otherPrice === editedPrice) continue;

    const cheaper = editedPrice < otherPrice
      ? { label: edited.label, credits: newCredits } : { label: other.label, credits: other.monthly_ai_credits };
    const pricier = editedPrice < otherPrice
      ? { label: other.label, credits: other.monthly_ai_credits } : { label: edited.label, credits: newCredits };

    if (cheaper.credits > pricier.credits) {
      return `${cheaper.label} now has more credits than ${pricier.label}. Save anyway?`;
    }
  }
  return null;
}
