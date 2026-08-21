import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { metricsSnapshotsAvailable } from '@/lib/usage-sessions-capability';

// Prompt 296 §2 — generic trend-history reader for every clickable Stat/
// MiniStat. Every card names its own dot-path(s) into the SAME payload
// shape computeOverviewPayload() stores (src/lib/metrics-snapshot.ts) —
// this route only walks that JSON, it never recomputes a metric itself.
// One snapshot/day (the automations cron) plus any manual "Atualizar agora"
// refresh (§1) — history is necessarily sparse for a while; the client is
// responsible for the honest "not enough history yet" state, not this route.
function getPath(obj: unknown, path: string): number | null {
  const v = path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
  return typeof v === 'number' ? v : null;
}

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  if (!(await metricsSnapshotsAvailable())) return NextResponse.json({ ok: true, series: [] });

  const { searchParams } = new URL(req.url);
  const metricsParam = searchParams.get('metrics');
  if (!metricsParam) return NextResponse.json({ ok: false, error: 'metrics query param required (comma-separated dot-paths).' }, { status: 400 });
  const paths = metricsParam.split(',').map((p) => p.trim()).filter(Boolean);
  const limit = Math.min(Number(searchParams.get('limit')) || 90, 365);

  const { data, error } = await admin.from('metrics_snapshots').select('computed_at, payload')
    .eq('scope', 'overview').order('computed_at', { ascending: true }).limit(limit);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const series = paths.map((path) => ({
    path,
    points: (data ?? [])
      .map((row) => ({ computedAt: row.computed_at as string, value: getPath(row.payload, path) }))
      .filter((p): p is { computedAt: string; value: number } => p.value !== null),
  }));

  return NextResponse.json({ ok: true, series });
}
