import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { resolvePeriod, activationFunnel, retentionBreakdown, relevantActivitySummary, type Period } from '@/lib/backoffice-metrics';

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { searchParams } = new URL(req.url);
  const period = (searchParams.get('period') as Period) || '30d';
  const { current } = resolvePeriod(period);

  const [funnel, retention, activity] = await Promise.all([
    activationFunnel(admin, current), retentionBreakdown(admin), relevantActivitySummary(admin, current),
  ]);

  return NextResponse.json({ ok: true, funnel, retention, activity });
}
