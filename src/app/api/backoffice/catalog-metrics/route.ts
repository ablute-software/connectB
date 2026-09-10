// Prompt 644 §2.4 — the catalogue's history, for the chart under the
// "Catalog stats" cards. Read-only. Two RPCs, both defined in the database
// and nowhere else: catalog_metrics_series(from, to, metrics) returns
// day/metric/value from the daily table plus today's live values from
// catalog_metrics_compute() — the cards are the last point of the curve by
// construction — and catalog_metrics_definitions() carries the label, the
// definition text and the date each series is reconstructible from, so the
// tooltip can say "no data before <date>" instead of drawing a zero.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get('to') ?? today;
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  if (!DAY.test(from) || !DAY.test(to)) return NextResponse.json({ ok: false, error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
  const metricsParam = url.searchParams.get('metrics');
  const metrics = metricsParam ? metricsParam.split(',').map((m) => m.trim()).filter(Boolean) : null;

  const [series, definitions] = await Promise.all([
    admin.rpc('catalog_metrics_series', { p_from: from, p_to: to, p_metrics: metrics }),
    admin.rpc('catalog_metrics_definitions'),
  ]);
  if (series.error) return NextResponse.json({ ok: false, error: series.error.message }, { status: 200 });
  if (definitions.error) return NextResponse.json({ ok: false, error: definitions.error.message }, { status: 200 });

  const rows = ((series.data ?? []) as { day: string; metric: string; value: number | string | null }[])
    .map((r) => ({ day: r.day, metric: r.metric, value: r.value === null || r.value === undefined ? null : Number(r.value) }));

  return NextResponse.json({ ok: true, from, to, rows, definitions: definitions.data ?? [] });
}
