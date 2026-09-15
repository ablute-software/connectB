// Prompt 588 Bloco C — "your first month is on us" (the /investors pricing
// copy, InvestorPricingSection.tsx) has to be backed by a real date for the
// claim to be true. investor_billing.investor_access_started_at (migration
// see supabase/migrations/) is set once, on the investor's first read of
// their own profile (ensureInvestorAccessStarted, investor-access-period.ts)
// — this file is the pure date math on top of that timestamp, same
// pure/impure split as investor-billing-access.ts's own header note.
//
// "One month" is a calendar month from the start date (setMonth), not a
// fixed 30/31-day window — matches how every other monthly reset in this
// codebase already works (Watson's quota, the review quota, both anchored
// to calendar boundaries, per their own header comments in plans.ts).
export function earlyAccessEndsAt(startedAt: Date): Date {
  const end = new Date(startedAt.getTime());
  end.setMonth(end.getMonth() + 1);
  return end;
}

// True for exactly the [end - warnDays, end) window — before it, nothing to
// flag yet; at/after `end`, this prompt deliberately does NOT build the
// block (§Bloco C.3: "não construir o bloqueio ao dia 31 neste prompt"), so
// there is nothing left for this function to warn about once the date has
// actually passed.
export function isNearEarlyAccessEnd(startedAt: Date, now: Date, warnDays = 7): boolean {
  const end = earlyAccessEndsAt(startedAt).getTime();
  const msLeft = end - now.getTime();
  return msLeft > 0 && msLeft <= warnDays * 24 * 60 * 60 * 1000;
}
