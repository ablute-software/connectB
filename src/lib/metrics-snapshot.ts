// Prompt 295 §3 — history for the Overview dashboard. computeAndStoreOverviewSnapshot()
// reuses the EXACT SAME computation functions /api/backoffice/metrics/
// overview/route.ts already calls — never a second, divergent
// implementation of the same indicator (Section 13.2's own rule, see the
// header of backoffice-metrics.ts). This file only adds the "compute once,
// persist to metrics_snapshots" wrapper around that existing logic.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolvePeriod, pctDelta, newStartups, newInvestors, newRegisteredInvestorAccounts, activatedStartups, activeFundraisingStartups,
  startupsWithRelevantActivity, activationRate7d, retention30d, mrr, netNewMrr, freeToPaidConversion,
  monthlyRevenueChurn, qualifiedConversationsPerActiveFundraisingStartup, medianTimeToFirstResponse, overviewAlerts,
  acquisitionBreakdown, plansAndSubscriptions, revenueBreakdown, promoBreakdown,
} from './backoffice-metrics';
import { metricsSnapshotsAvailable } from './usage-sessions-capability';

// Same default period the Overview route itself defaults to when no
// ?period= query param is given — the snapshot has no request to read a
// param from, so it always captures the same '30d' window the dashboard
// shows on a fresh load.
const SNAPSHOT_PERIOD = '30d' as const;

export async function computeOverviewPayload(admin: SupabaseClient) {
  const { current, previous } = resolvePeriod(SNAPSHOT_PERIOD);

  const [
    newStartupsNow, newStartupsPrev, newInvestorsNow, newInvestorsPrev,
    newRegisteredInvestorAccountsNow, newRegisteredInvestorAccountsPrev,
    activated, activeFundraising, relevantActivity, activation7d, retention,
    mrrNow, netNew, freeToPaid, conversations, timeToFirstResponse, alerts,
    acquisition, plans, revenue, promo,
  ] = await Promise.all([
    newStartups(admin, current), newStartups(admin, previous),
    newInvestors(admin, current), newInvestors(admin, previous),
    newRegisteredInvestorAccounts(admin, current), newRegisteredInvestorAccounts(admin, previous),
    activatedStartups(admin, current), activeFundraisingStartups(admin),
    startupsWithRelevantActivity(admin, current), activationRate7d(admin, current), retention30d(admin),
    mrr(admin), netNewMrr(admin, current), freeToPaidConversion(admin, current),
    qualifiedConversationsPerActiveFundraisingStartup(admin), medianTimeToFirstResponse(admin),
    overviewAlerts(admin, { from: new Date(Date.now() - 30 * 86400000), to: new Date() }),
    // Prompt 296 §2/§3 — the SAME functions /api/backoffice/metrics/growth
    // already calls, captured into the SAME snapshot as Overview. One daily
    // snapshot, both tabs' history — not a second, separately-scheduled
    // capture. This is what lets every Growth & Revenue MiniStat (not just
    // Overview's own Stat cards) have a real trend to draw, per §2's "every
    // stat card becomes clickable" ask.
    acquisitionBreakdown(admin, current), plansAndSubscriptions(admin, current), revenueBreakdown(admin, current), promoBreakdown(admin, current),
  ]);
  const churn = await monthlyRevenueChurn(admin, current, mrrNow.total);

  return {
    period: { current: { from: current.from.toISOString(), to: current.to.toISOString() } },
    growth: {
      newStartups: { value: newStartupsNow, deltaPct: pctDelta(newStartupsNow, newStartupsPrev) },
      newCatalogEntities: { value: newInvestorsNow, deltaPct: pctDelta(newInvestorsNow, newInvestorsPrev) },
      newRegisteredInvestorAccounts: { value: newRegisteredInvestorAccountsNow, deltaPct: pctDelta(newRegisteredInvestorAccountsNow, newRegisteredInvestorAccountsPrev) },
      activatedStartups: activated.count,
      activeFundraisingStartups: activeFundraising,
      startupsWithRelevantActivity: relevantActivity,
      activationRate7d: activation7d,
      retention30d: retention,
    },
    revenue: {
      mrr: mrrNow.total,
      mrrPotential: mrrNow.totalPotential,
      mrrBilled: mrrNow.billed,
      discountsValue: mrrNow.discountsValue,
      netNewMrr: netNew,
      freeToPaidConversion: freeToPaid,
      monthlyRevenueChurnPct: churn,
    },
    valueProof: {
      qualifiedConversations: conversations.conversations,
      medianDaysToFirstResponse: timeToFirstResponse,
    },
    alerts,
    // Prompt 296 §2/§3 — Growth & Revenue tab's own fields, unmodified shape
    // from /api/backoffice/metrics/growth, kept under their own key so the
    // history endpoint can address them by the exact same dot-path the tab
    // itself already uses (growthDetail.revenue.arr, growthDetail.plans.paid, …).
    growthDetail: { acquisition, plans, revenue, promo },
  };
}

export async function computeAndStoreOverviewSnapshot(
  admin: SupabaseClient,
  opts: { triggeredBy: 'manual' | 'daily_cron'; createdBy?: string | null },
): Promise<{ stored: boolean; payload?: Awaited<ReturnType<typeof computeOverviewPayload>> }> {
  if (!(await metricsSnapshotsAvailable())) return { stored: false };
  const payload = await computeOverviewPayload(admin);
  await admin.from('metrics_snapshots').insert({
    scope: 'overview', period: SNAPSHOT_PERIOD, payload,
    triggered_by: opts.triggeredBy, created_by: opts.createdBy ?? null,
  });
  return { stored: true, payload };
}
