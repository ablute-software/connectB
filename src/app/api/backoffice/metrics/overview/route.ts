// SherlockDeal_Metricas_BackOffice_V1, Section 6 — Overview: 12 indicators
// + alerts. Every number comes from src/lib/backoffice-metrics.ts, never
// re-derived here — this route only resolves the period filter and shapes
// the response.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import {
  resolvePeriod, pctDelta, newStartups, newInvestors, newRegisteredInvestorAccounts, activatedStartups, activeFundraisingStartups,
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
    newRegisteredInvestorAccountsNow, newRegisteredInvestorAccountsPrev,
    activated, activeFundraising, relevantActivity, activation7d, retention,
    mrrNow, netNew, freeToPaid, conversations, timeToFirstResponse, alerts,
  ] = await Promise.all([
    newStartups(admin, current), newStartups(admin, previous),
    newInvestors(admin, current), newInvestors(admin, previous),
    newRegisteredInvestorAccounts(admin, current), newRegisteredInvestorAccounts(admin, previous),
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
      // Prompt 124 M9/C7 — two separate cards, always shown together: the
      // catalog number (imports/enrichment — most never touched by a real
      // user) must never stand in for real adoption.
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
      // Prompt 296 §3 — always shown alongside the other, never alone.
      mrrPotential: mrrNow.totalPotential,
      // Prompt 569 — the only one backed by a charge. mrr/mrrPotential both
      // come from orgs.plan, which the back-office flips by hand.
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
  });
}
