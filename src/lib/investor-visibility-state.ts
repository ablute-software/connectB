// Prompt 850 §B — what the founder is told about their own visibility to
// investors, and the words for each state. Pure, so the About badge
// (VisibilityToggle) and the Dashboard banner (MatchDealVisibilityBanner)
// cannot say two different things about the same account — which is exactly
// what happened before Prompt 543, and what §A's change would otherwise
// reopen: the two surfaces were describing MatchDeal publication while the
// investor pipeline was deciding on something else entirely.
//
// After §A, "can investors find me" has exactly three answers the founder
// controls, and one they do not:
//
//   incomplete       the nine-field profile gate is not finished. Not a
//                    MatchDeal state — the SAME gate that unlocks the
//                    founder's own Pipeline (pipeline-unlock.ts), which is
//                    what eligibility now reads.
//   visible          the gate is complete and nobody has switched it off.
//   hidden           the founder switched it off. This is the opt-out
//                    Prompt 850 §B makes reachable: before it, "Suspend"
//                    was only offered once a founder had PUBLISHED on
//                    MatchDeal, so a founder who never published could not
//                    opt out at all — while §A makes them discoverable.
//   platform_hidden  the platform switched it off. Not the founder's to
//                    change; it outranks everything else on screen.
//
// Publishing on MatchDeal is deliberately NOT one of these states any more.
// It is a separate act with its own button ("Publish your card on
// MatchDeal") and its own surface (the swipe deck); it no longer decides
// whether investors can find the startup.
export type InvestorVisibilityState = 'incomplete' | 'visible' | 'hidden' | 'platform_hidden';

export function investorVisibilityState(params: {
  gateComplete: boolean;
  ownerSuspended: boolean;
  platformSuspended: boolean;
}): InvestorVisibilityState {
  if (params.platformSuspended) return 'platform_hidden';
  // Switching yourself off is a deliberate act and outranks incompleteness
  // on screen — same precedence matchdealStartupState already uses, for the
  // same reason: a founder who chose this must not be told they simply
  // forgot to fill something in.
  if (params.ownerSuspended) return 'hidden';
  if (!params.gateComplete) return 'incomplete';
  return 'visible';
}

export interface InvestorVisibilityCopy {
  /** The pill next to the switch. */
  badge: string;
  /** The sentence under it. */
  detail: string;
  /** Amber for anything that means "investors cannot see you". */
  tone: 'ok' | 'warn' | 'blocked';
}

export function investorVisibilityCopy(
  state: InvestorVisibilityState,
  opts: { missingCount?: number; pipelineFirmCount?: number | null } = {},
): InvestorVisibilityCopy {
  const missing = opts.missingCount ?? 0;
  switch (state) {
    case 'platform_hidden':
      return { badge: 'Suspended by the platform', detail: "Contact support — this wasn't your choice.", tone: 'blocked' };
    case 'hidden':
      return { badge: 'Hidden', detail: 'Hidden from investor pipelines by you.', tone: 'warn' };
    case 'incomplete':
      return {
        badge: 'Not visible yet',
        detail: `Investors can't find you yet — ${missing} field${missing === 1 ? '' : 's'} missing.`,
        tone: 'warn',
      };
    case 'visible': {
      // The count is real or absent — never a placeholder, never rounded up
      // from nothing. Zero says nothing extra: "0 investor firms have you"
      // is a discouraging way to phrase "you are live and it is early".
      const n = opts.pipelineFirmCount ?? null;
      return {
        badge: 'Visible to investors',
        detail: n && n > 0
          ? `Investors can find you — ${n} investor firm${n === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} you in their pipeline.`
          : 'Investors can find you.',
        tone: 'ok',
      };
    }
  }
}
