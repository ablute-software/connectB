// Prompt 917 (Adenda 1, Part B) — back office: the corrections people make to the proposals of the import from documents, and how the proposals were made. A simple view:
// which corrections happen most (a question's kind changed, a question deleted…), who made the item they changed (the platform's own reader or the AI), and how many imports
// were read by the platform alone, by the platform and the AI, or by the AI. It is where the rules of the internal reader get better. Platform admin only; read only.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { summariseCorrections } from '@/lib/calls/ai-import/corrections';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  let corr: unknown; let runs: unknown;
  try {
    const [a, b] = await Promise.all([
      admin.from('call_import_corrections').select('kind, source, detail').order('created_at', { ascending: false }).limit(5000),
      admin.from('call_import_runs').select('mode, quality, duration_ms, status').in('status', ['proposed', 'applied', 'discarded']).order('created_at', { ascending: false }).limit(1000),
    ]);
    if (a.error || b.error) return NextResponse.json({ ok: true, available: false });   // e.g. the migration is not applied yet: the panel hides, the page works
    corr = a.data; runs = b.data;
  } catch { return NextResponse.json({ ok: true, available: false }); }
  const rows = (runs ?? []) as Row[];
  const byMode: Record<string, number> = { internal: 0, 'internal+ai': 0, ai: 0, unknown: 0 };
  let cov = 0; let conf = 0; let n = 0; let ms = 0; let nms = 0;
  for (const r of rows) {
    const m = typeof r.mode === 'string' && r.mode in byMode ? (r.mode as string) : 'unknown';
    byMode[m]++;
    const q = (r.quality ?? null) as { coverage?: number; typeConfidence?: number } | null;
    if (q && typeof q.coverage === 'number') { cov += q.coverage; conf += q.typeConfidence ?? 0; n++; }
    if (typeof r.duration_ms === 'number') { ms += r.duration_ms; nms++; }
  }
  return NextResponse.json({
    ok: true, available: true,
    corrections: summariseCorrections(((corr ?? []) as Row[]).map((r) => ({ kind: String(r.kind), source: (r.source as string | null) ?? null, detail: (r.detail as Record<string, unknown> | null) ?? null }))),
    runs: { total: rows.length, byMode, avgCoverage: n ? cov / n : null, avgTypeConfidence: n ? conf / n : null, avgDurationMs: nms ? Math.round(ms / nms) : null },
  });
}
