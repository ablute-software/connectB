// Pure eligibility engine (onboarding_sherlockdeal_v2.md §7 + the
// interruption budget in §2). No I/O — the provider (OnboardingProvider.tsx)
// owns persistence and session counters, and hands this a plain context.
//
// Eligibility order, exactly as specified: opted_out false -> key not yet
// seen -> the item's own trigger condition true -> session budget not
// exhausted -> last_shown_at more than 24h ago (modals only) -> any
// prerequisite keys already seen.
import type { OnboardingItem } from './content';

export interface OnboardingCtx {
  seen: Record<string, string>;
  optedOut: boolean;
  lastShownAt: string | null;
  now: Date;
  sessionModalsShown: number;
  sessionCoachmarksShown: number;
  /** Whether each item's own trigger condition currently holds — set by the component that owns that moment (e.g. Pipeline sets 'waves'). */
  conditions: Record<string, boolean>;
  /** Optional per-item prerequisite keys — must already be in `seen`. */
  requires?: Record<string, string[]>;
}

export const SESSION_MODAL_MAX = 1;
export const SESSION_COACHMARK_MAX = 2;
export const MODAL_COOLDOWN_HOURS = 24;

export function isEligible(item: OnboardingItem, ctx: OnboardingCtx): boolean {
  if (ctx.optedOut) return false;
  if (ctx.seen[item.key]) return false;
  if (!ctx.conditions[item.key]) return false;

  if (item.type === 'modal') {
    if (ctx.sessionModalsShown >= SESSION_MODAL_MAX) return false;
    if (ctx.lastShownAt) {
      const hoursSince = (ctx.now.getTime() - new Date(ctx.lastShownAt).getTime()) / 3_600_000;
      if (hoursSince < MODAL_COOLDOWN_HOURS) return false;
    }
  } else if (item.type === 'coachmark') {
    // "Max 1 coach mark simultaneously" (§2) doesn't need its own check
    // here: pickEligible only ever returns ONE item total across the whole
    // registry (lowest order wins), so at most one coach mark (or modal)
    // is ever the current eligibleKey by construction — a separate
    // "currently open" flag would have to exclude itself to avoid making
    // an open coach mark immediately ineligible for its own open state.
    if (ctx.sessionCoachmarksShown >= SESSION_COACHMARK_MAX) return false;
  }

  const prereqs = ctx.requires?.[item.key] ?? [];
  if (prereqs.some((k) => !ctx.seen[k])) return false;

  return true;
}

// Lowest `order` wins when more than one item is eligible in the same
// tick; everything else waits for a future session/tick.
export function pickEligible(items: OnboardingItem[], ctx: OnboardingCtx): OnboardingItem | null {
  const eligible = items.filter((i) => isEligible(i, ctx)).sort((a, b) => a.order - b.order);
  return eligible[0] ?? null;
}
