// Investor Workspace Interoperability (prompt 62.4) — CSV export for the
// Pipeline and Archive. Dumps the exact same data those tabs already show
// (via the extracted getPipelineWaves/getArchiveEntries) — no separate
// query path, no schema.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { getPipelineWaves } from '@/lib/investor-pipeline';
import { isUnavailableCard } from '@/lib/closed-org-card';
import { closedOrgGuard, STARTUP_UNAVAILABLE_MESSAGE } from '@/lib/org-closed';
import { getArchiveEntries } from '@/lib/investor-archive';
import { toCsv } from '@/lib/csv';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { getInteractionTimeline } from '@/lib/investor-interaction-log';

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
  if (type !== 'pipeline' && type !== 'archive' && type !== 'interaction-log') {
    return NextResponse.json({ error: 'type must be "pipeline", "archive", or "interaction-log".' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  let csv: string;
  let filename: string;

  if (type === 'interaction-log') {
    const orgId = new URL(req.url).searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required for interaction-log.' }, { status: 400 });
    // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
    const closedBlock = await closedOrgGuard(admin, orgId);
    if (closedBlock) return closedBlock;
    const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
    const entries = investorCatalogEntityId ? await getInteractionTimeline(admin, { investorCatalogEntityId, email, orgId }) : [];
    const rows = entries.map((e) => ({
      at: e.at, kind: e.kind, channel: e.channel ?? '', person: e.personName ?? '', content: e.content,
      links: e.links.map((l) => `${l.label} (${l.url})`).join('; '),
      document: e.document ? e.document.name : '',
    }));
    csv = toCsv(rows, ['at', 'kind', 'channel', 'person', 'content', 'links', 'document']);
    filename = 'interaction-log.csv';
  } else if (type === 'pipeline') {
    const result = await getPipelineWaves(sb, admin, user.id, email);
    // Prompt 556 §C — a closed startup exports as its name, its wave and
    // the investor's own decision, and nothing else. It is deliberately NOT
    // dropped from the CSV: the investor's history with it is theirs, and a
    // row silently vanishing from an export is worse than a row that says
    // what happened.
    const rows = (result.linked && result.waves ? result.waves : []).flatMap((w) => w.items.map((c) => (
      isUnavailableCard(c)
        ? {
            name: c.name, stage: '', sectors: '', match_score: '',
            wave: w.index + 1, status: STARTUP_UNAVAILABLE_MESSAGE, round_target_eur: '',
          }
        : {
            name: c.name, stage: c.stage ? (STAGE_LABELS[c.stage] ?? c.stage) : '', sectors: c.sectors.join('; '),
            match_score: c.matchScore, wave: w.index + 1, status: c.status, round_target_eur: c.roundTargetEur ?? '',
          }
    )));
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
