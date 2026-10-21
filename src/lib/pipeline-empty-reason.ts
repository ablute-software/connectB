// WHY a founder's Pipeline is empty, in a form the screen can say in numbers.
//
// Nuno, 20/10/2026, looking at Mob2is: "I do not understand why the pipeline is empty. If an action is missing — if there is a reason — it should be on the screen,
// and then the option to fix it." The empty screen had three sentences, and the one for "profile complete, nothing deliverable" fitted four different situations
// (the quota is spent; the plan has none; nothing in the catalog matches; or — the Developer Viewer's case — the number was wrongly zero) behind the same reassuring
// "your next batch arrives with your plan's monthly renewal". This names the situation, with the numbers the server already computed (quota, delivered, the date of
// the next batch), and says what the founder can do about it. Pure, so the sentence a founder reads is tested rather than guessed.
import { nextMonthlyDeliveryDate } from './catalog-monthly-delivery';

/** What /api/pipeline-unlock says about this org (the page's UnlockState, reduced to what the reason needs). */
export interface UnlockFacts {
  gateComplete: boolean;
  /** Investors that could be unlocked RIGHT NOW: the quota left, capped by the matches that exist. */
  deliverable: number;
  /** An unlimited (developer) account has no quota ceiling. */
  unlimited: boolean;
  missing: string[];
  /** Catalog investors the plan includes so far (null when unlimited, or when the server did not say). */
  quota: number | null;
  /** Catalog investors already delivered against that quota (an exempt delivery, granted outside the plan, is not counted). */
  delivered: number;
}

export type PipelineEmptyReason =
  /** The profile gate is not complete: the fields still missing. */
  | { kind: 'profile_incomplete'; missing: string[] }
  /** Everything is in place and `count` investors are waiting for one click. */
  | { kind: 'ready_to_unlock'; count: number }
  /** Every investor the plan includes so far was delivered: the next batch is on `nextBatch`. */
  | { kind: 'quota_spent'; quota: number; nextBatch: Date }
  /** Part of the quota is unused but the catalog has nothing left that matches this company. */
  | { kind: 'no_matches_left'; quota: number | null; delivered: number }
  /** The account has no catalog investors included at all. */
  | { kind: 'plan_has_none' }
  /** Nothing is known (the server has not answered, or the unlock pack is not there to offer): the screen falls back to its generic sentence. */
  | { kind: 'unknown' };

/**
 * @param unlock       the numbers from /api/pipeline-unlock, or null when it has not answered
 * @param canUnlock    the catalog pack the Unlock button delivers exists (without it the button cannot render, whatever the numbers say)
 * @param now          injected, never read from the clock here
 */
export function pipelineEmptyReason(unlock: UnlockFacts | null, canUnlock: boolean, now: Date): PipelineEmptyReason {
  if (!unlock) return { kind: 'unknown' };
  if (!unlock.gateComplete) return { kind: 'profile_incomplete', missing: unlock.missing };
  if (unlock.deliverable > 0) return canUnlock ? { kind: 'ready_to_unlock', count: unlock.deliverable } : { kind: 'unknown' };
  // Nothing deliverable. Why?
  if (unlock.unlimited || unlock.quota === null) return { kind: 'no_matches_left', quota: null, delivered: unlock.delivered };
  if (unlock.quota <= 0) return { kind: 'plan_has_none' };
  if (unlock.delivered >= unlock.quota) return { kind: 'quota_spent', quota: unlock.quota, nextBatch: nextMonthlyDeliveryDate(now.toISOString()) };
  return { kind: 'no_matches_left', quota: unlock.quota, delivered: unlock.delivered };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "1 November 2026" — the same words for everyone (UTC), so a test and a founder in another time zone read the same day. */
export function formatBatchDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const investors = (n: number) => `${n} investor${n === 1 ? '' : 's'}`;

/**
 * The sentence under "No investors in the pipeline yet" for each reason. Everything it says is a number or a date the server computed — and each ending names the
 * way out (import your own contacts is always one; upgrading is one only when there is a higher plan to go to).
 */
export function pipelineEmptyCopy(reason: PipelineEmptyReason, opts: { onMaxPlan?: boolean } = {}): string {
  switch (reason.kind) {
    case 'profile_incomplete':
      return `To unlock investors from the catalog, complete your company profile${reason.missing.length ? ` — still missing: ${reason.missing.join(', ')}` : ''}. You can import your own contacts now.`;
    case 'ready_to_unlock':
      return `Your profile is complete — unlock your first ${reason.count} matched investor${reason.count === 1 ? '' : 's'}, or import your own contacts.`;
    case 'quota_spent':
      return `You have received all ${investors(reason.quota)} your plan includes so far. The next batch arrives on ${formatBatchDate(reason.nextBatch)}, with your plan’s monthly renewal${opts.onMaxPlan ? '' : ' — or upgrade your plan to unlock more now'}. You can also import your own contacts.`;
    case 'no_matches_left':
      return `${reason.quota === null ? `${reason.delivered} delivered so far. ` : `${reason.delivered} of ${reason.quota} delivered so far. `}There are no more catalog investors that match your profile right now. Matching uses your sectors, stage, ticket size and country — if any of those changed, update them in Settings and new matches can appear. You can also import your own contacts.`;
    case 'plan_has_none':
      return `No catalog investors are included for your account right now${opts.onMaxPlan ? '' : ' — see the plans to find one that includes them'}. You can import your own contacts.`;
    case 'unknown':
      return 'Your profile is complete. Your next batch of investors arrives with your plan’s monthly renewal — or import your own contacts now.';
  }
}
