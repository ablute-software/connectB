// Prompt 164 C — read/write this investor's own Berkus Method estimate for
// one startup. Same pattern as /api/portal/scorecard/scores: session ->
// resolveActiveInvestorMember -> service-role read/write with an explicit
// ownership scope (RLS on the table is defense in depth, this check is the
// real boundary). Private judgment only — nothing here is ever readable by
// the startup or any other investor seat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';

// Not exported — App Router route files may only export HTTP methods and
// route config; the UI keeps its own copy of this ceiling (same "display
// truth vs enforcement truth" split every other route here uses — the
// migration's CHECK constraints are the real floor either way).
const BERKUS_FACTOR_MAX_EUR = 500000;
const FACTOR_KEYS = ['sound_idea_eur', 'prototype_eur', 'team_eur', 'relationships_eur', 'sales_eur'] as const;

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ estimate: null });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ estimate: null });

  const { data } = await admin.from('investor_berkus_estimates')
    .select('sound_idea_eur, prototype_eur, team_eur, relationships_eur, sales_eur, updated_at')
    .eq('investor_member_id', member.id).eq('startup_org_id', orgId).maybeSingle();
  return NextResponse.json({ estimate: data ?? null });
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

  const body = await req.json().catch(() => ({})) as { orgId?: string } & Partial<Record<typeof FACTOR_KEYS[number], number>>;
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  const patch: Record<string, number> = {};
  for (const k of FACTOR_KEYS) {
    const v = body[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > BERKUS_FACTOR_MAX_EUR) {
      return NextResponse.json({ ok: false, error: `${k} must be a number between 0 and ${BERKUS_FACTOR_MAX_EUR}.` }, { status: 400 });
    }
    patch[k] = Math.round(v);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  const { error } = await admin.from('investor_berkus_estimates').upsert({
    investor_member_id: member.id, startup_org_id: body.orgId, ...patch,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'investor_member_id,startup_org_id' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Prompt 408 §B.2 — every explicit "Save estimate" also appends a
  // history snapshot; the upsert above still keeps the single live row
  // (used everywhere else Berkus is read) untouched in shape. Best-effort:
  // a failure here never fails the save itself, which is the part the
  // investor actually asked for and already succeeded above.
  await admin.from('evaluation_snapshots').insert({
    investor_member_id: member.id, startup_org_id: body.orgId, kind: 'berkus',
    inputs: patch, outputs: { totalEur: FACTOR_KEYS.reduce((sum, k) => sum + (patch[k] ?? 0), 0) },
  }).then(({ error: snapshotErr }) => {
    if (snapshotErr) console.error('[portal/berkus] snapshot insert failed', snapshotErr.message);
  });

  return NextResponse.json({ ok: true });
}
