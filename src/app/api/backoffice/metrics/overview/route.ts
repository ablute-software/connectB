// SherlockDeal_Metricas_BackOffice_V1, Section 6 — Overview: 12 indicators
// + alerts. Every number comes from src/lib/backoffice-metrics.ts, never
// re-derived here — this route only resolves the period filter and shapes
// the response.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import {
  resolvePeriod, pctDelta, newStartups, newInvestors, activatedStartups, activeFundraisingStartups,
  startupsWithRelevantActivity, activationRate7d, retention30d, mrr, netNewMrr, freeToPaidConversion,
  monthlyRevenueChurn, qualifiedConversationsPerActiveFundraisingStartup, medianTimeToFirstResponse, overviewAlerts,
  type Period,
} from '@/lib/backoffice-metrics';

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { searchParams } = new URL(req.url);
  const period = (searchParams.get('period') as Period) || '30d';
  const { current, previous } = resolvePeriod(period, searchParams.get('from') ?? undefined, searchParams.get('to') ?? undefined);

  const [
    newStartupsNow, newStartupsPrev, newInvestorsNow, newInvestorsPrev,
    activated, activeFundraising, relevantActivity, activation7d, retention,
    mrrNow, netNew, freeToPaid, conversations, timeToFirstResponse, alerts,
  ] = await Promise.all([
    newStartups(admin, current), newStartups(admin, previous),
    newInvestors(admin, current), newInvestors(admin, previous),
    activatedStartups(admin, current), activeFundraisingStartups(admin),
    startupsWithRelevantActivity(admin, current), activationRate7d(admin, current), retention30d(admin),
    mrr(admin), netNewMrr(admin, current), freeToPaidConversion(admin, current),
    qualifiedConversationsPerActiveFundraisingStartup(admin), medianTimeToFirstResponse(admin),
    overviewAlerts(admin, { from: new Date(Date.now() - 30 * 86400000), to: new Date() }),
  ]);
  const churn = await monthlyRevenueChurn(admin, current, mrrNow.total);

  return NextResponse.json({
    ok: true,
    period: { current: { from: current.from.toISOString(), to: current.to.toISOString() } },
    growth: {
      newStartups: { value: newStartupsNow, deltaPct: pctDelta(newStartupsNow, newStartupsPrev) },
      newInvestors: { value: newInvestorsNow, deltaPct: pctDelta(newInvestorsNow, newInvestorsPrev) },
      activatedStartups: activated.count,
      activeFundraisingStartups: activeFundraising,
      startupsWithRelevantActivity: relevantActivity,
      activationRate7d: activation7d,
      retention30d: retention,
    },
    revenue: {
      mrr: mrrNow.total,
      netNewMrr: netNew,
      freeToPaidConversion: freeToPaid,
      monthlyRevenueChurnPct: churn,
    },
    valueProof: {
      qualifiedConversations: conversations,
      medianDaysToFirstResponse: timeToFirstResponse,
    },
    alerts,
  });
}
