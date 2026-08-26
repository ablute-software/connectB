// Prompt 142 Bloco 1 — CRUD for an investor's own scorecard criteria.
// Same investor-portal pattern as /api/portal/interest-level: session ->
// resolveActiveInvestorMember -> service-role reads/writes scoped by
// investor_member_id. investor_scorecard_criteria RLS exists too (defense
// in depth), but service role bypasses it — every write below filters by
// `investor_member_id = member.id` explicitly, which is the real boundary.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';
import { DEFAULT_NEW_CRITERION_WEIGHT } from '@/lib/investor-scorecard-weights';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ criteria: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ criteria: [] });

  const { data } = await admin.from('investor_scorecard_criteria')
    .select('id, label, weight, sort_order')
    .eq('investor_member_id', member.id)
    .order('sort_order', { ascending: true });
  return NextResponse.json({ criteria: data ?? [] });
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
    action?: 'create' | 'update' | 'delete' | 'reorder' | 'update_weights';
    id?: string; label?: string; weight?: number; order?: string[]; weights?: Record<string, number>;
  };

  if (body.action === 'create') {
    const label = body.label?.trim();
    if (!label) return NextResponse.json({ ok: false, error: 'Label is required.' }, { status: 400 });
    const { data: last } = await admin.from('investor_scorecard_criteria').select('sort_order')
      .eq('investor_member_id', member.id).order('sort_order', { ascending: false }).limit(1).maybeSingle();
    const nextOrder = (last?.sort_order ?? -1) + 1;
    // Prompt 388 §C.1 — a new criterion enters at the scale's own midpoint,
    // never a bare "1"; the constant-sum rule only ever applies to an
    // EXISTING criterion being dragged, so the total is simply allowed to
    // rise here, per the prompt's own words.
    const { error } = await admin.from('investor_scorecard_criteria').insert({
      investor_member_id: member.id, label, weight: body.weight ?? DEFAULT_NEW_CRITERION_WEIGHT, sort_order: nextOrder,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Prompt 388 §C.1 — one atomic batch write for a whole redistributed set
  // (a drag, or the redistribution after a delete): the client already ran
  // redistributeWeight/redistributeAfterRemoval (investor-scorecard-
  // weights.ts) and just needs every affected row persisted together —
  // never N sequential 'update' round-trips fighting a fast drag gesture.
  // Every id is re-checked against investor_member_id, same boundary as
  // every other action here — a weights map naming an id this member
  // doesn't own is simply skipped, never a cross-member write.
  if (body.action === 'update_weights') {
    if (!body.weights || typeof body.weights !== 'object') {
      return NextResponse.json({ ok: false, error: 'weights is required.' }, { status: 400 });
    }
    const entries = Object.entries(body.weights);
    for (const [id, weight] of entries) {
      if (typeof weight !== 'number' || !Number.isFinite(weight)) continue;
      const { error } = await admin.from('investor_scorecard_criteria').update({ weight })
        .eq('id', id).eq('investor_member_id', member.id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'update') {
    if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if (body.label !== undefined) patch.label = body.label.trim();
    if (body.weight !== undefined) patch.weight = body.weight;
    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });
    const { error } = await admin.from('investor_scorecard_criteria').update(patch)
      .eq('id', body.id).eq('investor_member_id', member.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'delete') {
    if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
    const { error } = await admin.from('investor_scorecard_criteria').delete()
      .eq('id', body.id).eq('investor_member_id', member.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'reorder') {
    if (!Array.isArray(body.order) || body.order.some((id) => typeof id !== 'string')) {
      return NextResponse.json({ ok: false, error: 'order must be an array of ids.' }, { status: 400 });
    }
    for (let i = 0; i < body.order.length; i++) {
      await admin.from('investor_scorecard_criteria').update({ sort_order: i })
        .eq('id', body.order[i]).eq('investor_member_id', member.id);
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
