// Prompt 914 — the "Plan" line of the Organisation card: the plan the org is on RIGHT NOW and, when it is not simply the stored one, why
// ("free trial via PIONEER_100 until 08 Jan 2027"). Its own file so it renders without the card's store and effects: the card only
// fetches /api/me when auth is on, which the local verification server never is, so this is what a test (and the page) can reach.
import { planName } from '@/lib/plans';
import type { PlanTier } from '@/lib/types';

export function PlanRow({ plan, originText }: { plan: PlanTier; originText: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">Plan</dt>
      <dd>
        {planName(plan)}
        {originText && <span className="block text-xs text-emerald-700" data-testid="org-plan-origin">{originText}</span>}
      </dd>
    </div>
  );
}
