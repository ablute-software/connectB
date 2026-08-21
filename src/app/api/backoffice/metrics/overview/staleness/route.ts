import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { metricsSnapshotsAvailable } from '@/lib/usage-sessions-capability';

// Prompt 296 §1 — "vale a pena atualizar?" signal for the popup. Not a real
// diff of which indicators moved (that would mean recomputing the whole
// Overview just to decide whether to show a button offering to compute the
// whole Overview) — a deliberately coarse, documented proxy: total
// analytics_events rows logged since the last snapshot. Any tracked event
// might move at least one Overview indicator; this doesn't try to model
// exactly which, only whether there's been enough activity to be worth a
// fresh look. Threshold picked to mean "a handful of quiet days" stays
// silent, matching the prompt's own "se for baixo volume, reutiliza
// silenciosamente a cache" instruction.
const WORTH_REFRESHING_THRESHOLD = 15;

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  if (!(await metricsSnapshotsAvailable())) {
    return NextResponse.json({ ok: true, lastSnapshotAt: null, eventsSinceSnapshot: 0, worthRefreshing: false });
  }

  const { data: latest } = await admin.from('metrics_snapshots').select('computed_at')
    .eq('scope', 'overview').order('computed_at', { ascending: false }).limit(1).maybeSingle();

  if (!latest) {
    // No snapshot has ever been stored — nothing to compare against, so
    // there's no "keep the cache" option to offer; the popup itself decides
    // what to do with worthRefreshing=true plus lastSnapshotAt=null.
    return NextResponse.json({ ok: true, lastSnapshotAt: null, eventsSinceSnapshot: 0, worthRefreshing: true });
  }

  const { count } = await admin.from('analytics_events').select('id', { count: 'exact', head: true })
    .gt('event_timestamp', latest.computed_at as string);

  const eventsSinceSnapshot = count ?? 0;
  return NextResponse.json({
    ok: true,
    lastSnapshotAt: latest.computed_at,
    eventsSinceSnapshot,
    worthRefreshing: eventsSinceSnapshot >= WORTH_REFRESHING_THRESHOLD,
  });
}
