// Prompt 179 §B — pure day/month decision logic for the monthly catalog
// quota-growth job, piggybacked on the daily /api/automations cron
// (vercel.json: "0 9 * * *" — Vercel Hobby plan allows only 1x/day, so the
// job runs every day but only ACTS on the 1st of the month).
//
// Deliberately no Date.now()/wall-clock read inside — the caller (the API
// route) passes "now" explicitly, same convention as completeMonthsSince in
// pipeline-unlock.ts, so this stays unit-testable and consistent with the
// workflow-script no-wall-clock-reads rule elsewhere in this codebase.
export function isFirstOfMonth(nowIso: string): boolean {
  return new Date(nowIso).getUTCDate() === 1;
}

// True exactly once per org per calendar month, even under same-day
// retries: catalogLastMonthlyDelivery is orgs.catalog_last_monthly_delivery,
// stamped with the FIRST DAY of the month the job last ran for this org
// (not the exact run timestamp) — so comparing it to "now"'s own
// year/month is a straight equality check, no drift from a mid-month
// stamp. A marker left over from any earlier month (including last year's
// day 1) is stale and the job is due again.
export function monthlyDeliveryDue(catalogLastMonthlyDelivery: string | null, nowIso: string): boolean {
  if (!isFirstOfMonth(nowIso)) return false;
  if (!catalogLastMonthlyDelivery) return true;
  const last = new Date(catalogLastMonthlyDelivery);
  const now = new Date(nowIso);
  return last.getUTCFullYear() !== now.getUTCFullYear() || last.getUTCMonth() !== now.getUTCMonth();
}

// The stamp to write back — always the 1st of "now"'s own month, in
// YYYY-MM-DD form (orgs.catalog_last_monthly_delivery is a `date` column).
export function monthlyDeliveryStamp(nowIso: string): string {
  const now = new Date(nowIso);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

// Case-1 copy in the pipeline's frosted-glass panel ("next batch arrives
// [date]") needs the NEXT day-1, not this one — see pipeline/page.tsx.
export function nextMonthlyDeliveryDate(nowIso: string): Date {
  const now = new Date(nowIso);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
