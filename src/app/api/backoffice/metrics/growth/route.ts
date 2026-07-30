import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import {
  resolvePeriod, acquisitionBreakdown, plansAndSubscriptions, revenueBreakdown, promoBreakdown, type Period,
} from '@/lib/backoffice-metrics';

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { searchParams } = new URL(req.url);
  const period = (searchParams.get('period') as Period) || '30d';
  const { current } = resolvePeriod(period);

  const [acquisition, plans, revenue, promo] = await Promise.all([
    acquisitionBreakdown(admin, current), plansAndSubscriptions(admin, current), revenueBreakdown(admin, current), promoBreakdown(admin, current),
  ]);

  return NextResponse.json({ ok: true, acquisition, plans, revenue, promo });
}
