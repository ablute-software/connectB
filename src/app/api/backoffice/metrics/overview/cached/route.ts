import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { metricsSnapshotsAvailable } from '@/lib/usage-sessions-capability';

// Prompt 296 §1 — serves the latest stored snapshot as-is, no recompute.
// This is the "adjust to traffic" mechanism itself: Overview's default load
// reads this (near-instant) instead of live-recomputing every indicator on
// every page open; a live recompute only happens via the popup's own
// "Atualizar agora" (POST .../refresh) or when no snapshot exists yet.
// Same payload shape /api/backoffice/metrics/overview itself returns, so
// the page's rendering code doesn't need to know which source it came from.
export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  if (!(await metricsSnapshotsAvailable())) return NextResponse.json({ ok: false, error: 'no cache available' });

  const { data: latest } = await admin.from('metrics_snapshots').select('computed_at, payload')
    .eq('scope', 'overview').order('computed_at', { ascending: false }).limit(1).maybeSingle();
  if (!latest) return NextResponse.json({ ok: false, error: 'no snapshot stored yet' });

  const payload = latest.payload as Record<string, unknown>;
  return NextResponse.json({ ok: true, computedAt: latest.computed_at, ...payload });
}
