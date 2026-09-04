// Prompt 850 §D — the one line under the investor Pipeline header that says
// what the monthly plan cap is actually doing, computed from real numbers
// and never invented.
//
// The model it describes (confirmed, not changed, by this prompt): a
// discovery admission is PERMANENT — investor_pipeline_admissions, migration
// 0157 — and the budget is `monthlyCap - (admissions created this calendar
// month)`. So the pipeline is CUMULATIVE, never re-shuffled: 30 candidates
// against Pro Scout's 10/month is 10 in month one, 20 in month two, 30 in
// month three. The plan caps how many NEW startups arrive, not how many you
// can hold.
//
// The privacy limit is absolute and is why `hasUnadmittedCandidates` is a
// boolean and not a count: this line may never say how many startups exist
// on the platform and are being withheld. It distinguishes only "there is
// more behind the cap" from "you are seeing everything that matches" —
// which is the difference the investor is entitled to know about their own
// plan, and nothing about the supply side.
export interface PipelineQuota {
  monthlyCap: number;
  /** Admissions created this calendar month WHOSE ORG IS STILL ELIGIBLE — an
   *  org that was admitted and then closed or suspended stops consuming the
   *  investor's quota (Prompt 850 §D's one correction to the existing
   *  behaviour). */
  admittedThisMonth: number;
  /** Whether at least one eligible candidate was held back by the cap. Never
   *  a count, never surfaced as one. */
  hasUnadmittedCandidates: boolean;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Formatted by hand rather than through toLocaleDateString: the string has
// to be identical in a unit test, on a server with a different default
// locale, and in whatever ICU build the runtime happens to ship.
export function firstOfNextMonth(nowIso: string): string {
  const now = new Date(nowIso);
  const month = now.getUTCMonth();
  const rolls = month === 11;
  return `1 ${MONTHS[rolls ? 0 : month + 1]}${rolls ? ` ${now.getUTCFullYear() + 1}` : ''}`;
}

export function pipelineQuotaLine(quota: PipelineQuota | null | undefined, nowIso: string): string | null {
  if (!quota || quota.monthlyCap <= 0) return null;
  const { monthlyCap, admittedThisMonth, hasUnadmittedCandidates } = quota;
  // Nothing is being withheld — say so plainly, and say what the plan
  // allows, so an empty-looking month reads as "the market is small today",
  // not "the product is broken". This wins over the spent-budget wording
  // even when the budget IS spent: there is nothing waiting for the reset.
  if (!hasUnadmittedCandidates) {
    return `You're seeing every startup that matches today. Your plan allows ${monthlyCap} new ${monthlyCap === 1 ? 'one' : 'ones'} a month.`;
  }
  if (admittedThisMonth >= monthlyCap) {
    return `${monthlyCap} of ${monthlyCap} new startups this month · the next ${monthlyCap} unlock on ${firstOfNextMonth(nowIso)}`;
  }
  return `${admittedThisMonth} of ${monthlyCap} new startups this month`;
}
