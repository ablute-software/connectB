import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import {
  mainFundraisingFunnel, fundraisingRates, outcomesByStartup, investorSourceDistribution, dataRoomAccessSummary,
} from '@/lib/backoffice-metrics';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [funnel, rates, byStartup, sourceDistribution, dataRoom] = await Promise.all([
    mainFundraisingFunnel(admin), fundraisingRates(admin), outcomesByStartup(admin), investorSourceDistribution(admin), dataRoomAccessSummary(admin),
  ]);

  return NextResponse.json({ ok: true, funnel, rates, byStartup, sourceDistribution, dataRoom });
}
