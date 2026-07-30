// Investor Workspace Interoperability (prompt 62.4) — CSV export for the
// Pipeline and Archive. Dumps the exact same data those tabs already show
// (via the extracted getPipelineWaves/getArchiveEntries) — no separate
// query path, no schema.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { getPipelineWaves } from '@/lib/investor-pipeline';
import { getArchiveEntries } from '@/lib/investor-archive';
import { toCsv } from '@/lib/csv';

const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const type = new URL(req.url).searchParams.get('type');
  if (type !== 'pipeline' && type !== 'archive') {
    return NextResponse.json({ error: 'type must be "pipeline" or "archive".' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  let csv: string;
  let filename: string;

  if (type === 'pipeline') {
    const result = await getPipelineWaves(sb, admin, user.id, email);
    const rows = (result.linked && result.waves ? result.waves : []).flatMap((w) => w.items.map((c) => ({
      name: c.name, stage: c.stage ? (STAGE_LABELS[c.stage] ?? c.stage) : '', sectors: c.sectors.join('; '),
      match_score: c.matchScore, wave: w.index + 1, status: c.status, round_target_eur: c.roundTargetEur ?? '',
    })));
    csv = toCsv(rows, ['name', 'stage', 'sectors', 'match_score', 'wave', 'status', 'round_target_eur']);
    filename = 'pipeline.csv';
  } else {
    const entries = await getArchiveEntries(admin, user.id, email);
    const rows = entries.map((e) => ({
      name: e.orgName, source: e.source, reason: e.reasonDetail ?? '', archived_at: e.archivedAt,
      now_summary: e.now?.text ?? '',
    }));
    csv = toCsv(rows, ['name', 'source', 'reason', 'archived_at', 'now_summary']);
    filename = 'archive.csv';
  }

  return new NextResponse(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"` },
  });
}
