// Prompt 388 §C.2 — per-(criteria, dossier tab, startup) investor-private
// scores. Same investor-portal pattern as /api/portal/scorecard/scores:
// session -> resolveActiveInvestorMember -> service-role reads/writes
// scoped to THIS member's own criteria — investor_dossier_tab_scores RLS
// exists too (defense in depth, migration 0251), but every write below
// still filters explicitly, which is the real boundary.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { closedOrgGuard } from '@/lib/org-closed';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';

const TABS = ['about', 'swot', 'roadmap', 'clarifications', 'round', 'market', 'team'] as const;
type Tab = typeof TABS[number];

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ items: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get('orgId');
  const tab = searchParams.get('tab');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });
  if (tab && !(TABS as readonly string[]).includes(tab)) {
    return NextResponse.json({ error: 'tab, when given, must be one of the 7 dossier tabs.' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ items: [] });

  const { data: criteria } = await admin.from('investor_scorecard_criteria')
    .select('id, label, weight, sort_order').eq('investor_member_id', member.id).order('sort_order', { ascending: true });
  if (!criteria || criteria.length === 0) return NextResponse.json({ items: [] });

  // Prompt 388 §C.3 — omitting `tab` returns every entry across every tab
  // for this org, not grouped by tab: what the read-only weighted-average
  // table (ScorecardPanel.tsx) needs to compute Σ(weight×score)/Σ(weight)
  // over ALL of an org's rated entries, never just one tab's worth.
  let query = admin.from('investor_dossier_tab_scores')
    .select('criteria_id, tab, score, note').eq('startup_org_id', orgId).in('criteria_id', criteria.map((c) => c.id));
  if (tab) query = query.eq('tab', tab);
  const { data: scores } = await query;

  if (tab) {
    const scoreByCriteria = new Map((scores ?? []).map((s) => [s.criteria_id as string, { score: s.score as number | null, note: s.note as string | null }]));
    // Prompt 388 §C.2 — "por avaliar" is the absence of a row here, never a
    // stored 0: every criterion is listed regardless, `score: null` when
    // this tab has no row for it yet.
    const items = criteria.map((c) => ({
      criteriaId: c.id as string, label: c.label as string, weight: c.weight as number,
      score: scoreByCriteria.get(c.id as string)?.score ?? null, note: scoreByCriteria.get(c.id as string)?.note ?? null,
    }));
    return NextResponse.json({ items });
  }

  // No `tab` — raw rows across all tabs, plus the criteria list (with
  // weight/label), so the caller can compute both the per-criterion and
  // the overall weighted average itself without a second round trip.
  return NextResponse.json({
    criteria: criteria.map((c) => ({ id: c.id, label: c.label, weight: c.weight })),
    rows: (scores ?? []).map((s) => ({ criteriaId: s.criteria_id, tab: s.tab, score: s.score })),
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as {
    criteriaId?: string; orgId?: string; tab?: Tab; score?: number; note?: string;
  };
  if (!body.criteriaId || !body.orgId || !body.tab || !(TABS as readonly string[]).includes(body.tab)) {
    return NextResponse.json({ ok: false, error: 'criteriaId, orgId and a valid tab are required.' }, { status: 400 });
  }
  if (typeof body.score !== 'number' || body.score < 0 || body.score > 10) {
    return NextResponse.json({ ok: false, error: 'score must be between 0 and 10.' }, { status: 400 });
  }

  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, body.orgId);
  if (closedBlock) return closedBlock;

  // Ownership check via the criterion, same boundary the RLS policy itself
  // encodes (migration 0251) — belt and suspenders under service role.
  const { data: criterion } = await admin.from('investor_scorecard_criteria')
    .select('id').eq('id', body.criteriaId).eq('investor_member_id', member.id).maybeSingle();
  if (!criterion) return NextResponse.json({ ok: false, error: 'Criterion not found.' }, { status: 404 });

  const { error } = await admin.from('investor_dossier_tab_scores').upsert({
    criteria_id: body.criteriaId, startup_org_id: body.orgId, tab: body.tab,
    score: body.score, note: body.note?.trim() || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'criteria_id,tab,startup_org_id' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
