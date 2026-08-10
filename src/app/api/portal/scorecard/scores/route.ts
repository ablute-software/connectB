// Prompt 142 Bloco 1 — reading/writing this investor's own scores for one
// startup. Same pattern as criteria/route.ts.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ items: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ items: [] });

  const { data: criteria } = await admin.from('investor_scorecard_criteria')
    .select('id, label, weight').eq('investor_member_id', member.id).order('sort_order', { ascending: true });
  if (!criteria || criteria.length === 0) return NextResponse.json({ items: [] });

  const { data: scores } = await admin.from('investor_scorecard_scores')
    .select('criteria_id, score, note').eq('startup_org_id', orgId).in('criteria_id', criteria.map((c) => c.id));
  const scoreByCriteria = new Map((scores ?? []).map((s) => [s.criteria_id as string, s as { score: number; note: string | null }]));

  const items = criteria.map((c) => {
    const s = scoreByCriteria.get(c.id as string);
    return { criteriaId: c.id, label: c.label, weight: c.weight, score: s?.score ?? null, note: s?.note ?? null };
  });
  return NextResponse.json({ items });
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

  const body = await req.json().catch(() => ({})) as { criteriaId?: string; orgId?: string; score?: number; note?: string };
  if (!body.criteriaId || !body.orgId) return NextResponse.json({ ok: false, error: 'criteriaId and orgId are required.' }, { status: 400 });
  if (typeof body.score !== 'number' || body.score < 0 || body.score > 10) {
    return NextResponse.json({ ok: false, error: 'score must be between 0 and 10.' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  // Service role bypasses RLS, so this ownership check is the real
  // boundary — confirms the criterion being scored actually belongs to the
  // caller before writing anything against it.
  const { data: criteria } = await admin.from('investor_scorecard_criteria').select('id')
    .eq('id', body.criteriaId).eq('investor_member_id', member.id).maybeSingle();
  if (!criteria) return NextResponse.json({ ok: false, error: 'Criterion not found.' }, { status: 404 });

  const { error } = await admin.from('investor_scorecard_scores').upsert({
    criteria_id: body.criteriaId, startup_org_id: body.orgId, score: body.score, note: body.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'criteria_id,startup_org_id' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
