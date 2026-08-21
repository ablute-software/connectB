import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { computeAndStoreOverviewSnapshot } from '@/lib/metrics-snapshot';

// Prompt 296 §1 — "Atualizar agora" from the staleness popup: a manual,
// on-demand recompute + store, same computeAndStoreOverviewSnapshot() the
// daily cron already uses (never a second, divergent implementation),
// just with triggered_by:'manual' and created_by set so the audit trail
// tells the two apart.
export async function POST() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const result = await computeAndStoreOverviewSnapshot(admin, { triggeredBy: 'manual', createdBy: userId });
  if (!result.stored) return NextResponse.json({ ok: false, error: 'metrics_snapshots not available yet.' });

  return NextResponse.json({ ok: true, ...result.payload });
}
