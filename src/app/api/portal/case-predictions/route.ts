// Prompt 408 §C — micro-predictions attached to an investor's case for one
// startup. Same pattern as case-decision/route.ts. Capture-only in this
// wave: resolved_at/outcome exist on the table (migration 0259) but
// nothing here ever sets them — that's the future calibration wave's own
// job, deliberately not built yet ("aqui só se capturam; deixa as
// colunas prontas").
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ predictions: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ predictions: [] });

  const { data } = await admin.from('investor_case_predictions')
    .select('id, prediction, horizon_months, created_at, resolved_at, outcome')
    .eq('investor_member_id', member.id).eq('startup_org_id', orgId)
    .order('created_at', { ascending: false });
  return NextResponse.json({ predictions: data ?? [] });
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

  const body = await req.json().catch(() => ({})) as { orgId?: string; prediction?: string; horizonMonths?: number };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  if (!body.prediction?.trim()) return NextResponse.json({ ok: false, error: 'prediction is required.' }, { status: 400 });
  if (!body.horizonMonths || !Number.isFinite(body.horizonMonths) || body.horizonMonths <= 0) {
    return NextResponse.json({ ok: false, error: 'horizonMonths must be a positive number.' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  const { error } = await admin.from('investor_case_predictions').insert({
    investor_member_id: member.id, startup_org_id: body.orgId,
    prediction: body.prediction.trim(), horizon_months: Math.round(body.horizonMonths),
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
