// Prompt 411 §D — this investor's own BARS answers/flag-states/axis-state
// for one startup, plus the server-computed per-axis result and
// cross-axis contradictions ("o servidor devolve o computeAxisResult
// para a UI não duplicar o motor"). Same pattern as berkus/route.ts:
// session -> resolveActiveInvestorMember -> service-role client ->
// ownership-scoped query. Private judgment only, same as every other
// /api/portal/* evaluation tool.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';
import { getBarsBank } from '@/lib/bars-banks';
import {
  computeAxisResult, crossAxisContradictions, parseEvidenceRefs,
  type AxisResult, type BarsAnswerRecord, type BarsAxisStateRecord, type BarsEvidenceRef, type BarsFlagState, type BarsFlagStateRecord,
} from '@/lib/bars-scoring';
import type { BarsAxis } from '@/lib/bars-types';
import type { CompanyPhase } from '@/lib/types';

const AXES: BarsAxis[] = ['team', 'market', 'product', 'technology'];
const FLAG_STATES: BarsFlagState[] = ['unverified', 'confirmed', 'cleared'];

function isAxis(x: unknown): x is BarsAxis {
  return typeof x === 'string' && (AXES as string[]).includes(x);
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const empty = { companyPhase: null, answers: [], flagStates: [], axisStates: [], computed: {}, contradictions: [] };
  if (!url || !serviceKey) return NextResponse.json(empty);

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json(empty);

  const [{ data: answerRows }, { data: flagRows }, { data: axisRows }, { data: profile }] = await Promise.all([
    admin.from('bars_answers').select('axis, bank_version, question_id, level, skipped, evidence_refs, note, updated_at')
      .eq('investor_member_id', member.id).eq('startup_org_id', orgId),
    admin.from('bars_red_flag_states').select('flag_id, bank_version, state, evidence_refs, note, updated_at')
      .eq('investor_member_id', member.id).eq('startup_org_id', orgId),
    admin.from('bars_axis_state').select('axis, not_material, updated_at')
      .eq('investor_member_id', member.id).eq('startup_org_id', orgId),
    admin.from('matchdeal_profiles').select('company_phase').eq('membership_id', orgId).eq('kind', 'startup').maybeSingle(),
  ]);

  // Missing/incomplete profile falls back to the earliest stage, which
  // under-includes (fewer questions read as applicable) rather than
  // assuming evidence a company at an unknown, possibly-earlier stage
  // couldn't have — the safer direction for a stage-gated evidence bar.
  const companyPhase: CompanyPhase = (profile?.company_phase as CompanyPhase | null) ?? 'concept_idea';

  const answers: BarsAnswerRecord[] = (answerRows ?? []).map((r) => ({
    questionId: r.question_id as string, level: r.level as number | null, skipped: r.skipped as boolean,
    evidenceRefs: (r.evidence_refs ?? []) as BarsEvidenceRef[],
  }));
  const flagStates: BarsFlagStateRecord[] = (flagRows ?? []).map((r) => ({
    flagId: r.flag_id as string, state: r.state as BarsFlagState,
  }));

  const computed: Partial<Record<BarsAxis, AxisResult>> = {};
  for (const axis of AXES) {
    const bank = getBarsBank(axis);
    const row = (axisRows ?? []).find((r) => r.axis === axis);
    const axisState: BarsAxisStateRecord | null = row ? { notMaterial: row.not_material as boolean } : null;
    computed[axis] = computeAxisResult(bank, answers, flagStates, axisState, companyPhase);
  }

  const answersByQuestion: Record<string, number | null | undefined> = {};
  for (const a of answers) if (!a.skipped) answersByQuestion[a.questionId] = a.level;
  const contradictions = crossAxisContradictions(computed, answersByQuestion);

  return NextResponse.json({
    companyPhase, answers: answerRows ?? [], flagStates: flagRows ?? [], axisStates: axisRows ?? [],
    computed, contradictions,
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

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const orgId = typeof body.orgId === 'string' ? body.orgId : null;
  if (!orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  if (!isAxis(body.axis)) return NextResponse.json({ ok: false, error: 'axis must be one of team/market/product/technology.' }, { status: 400 });
  const axis = body.axis;
  const bank = getBarsBank(axis);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  if (body.kind === 'answer') {
    const questionId = typeof body.questionId === 'string' ? body.questionId : null;
    if (!questionId || !bank.questions.some((q) => q.id === questionId)) {
      return NextResponse.json({ ok: false, error: 'Unknown question id for this axis.' }, { status: 400 });
    }
    const skipped = body.skipped === true;
    let level: number | null = null;
    if (!skipped && body.level != null) {
      if (typeof body.level !== 'number' || !Number.isInteger(body.level) || body.level < 1 || body.level > 5) {
        return NextResponse.json({ ok: false, error: 'level must be an integer 1-5.' }, { status: 400 });
      }
      level = body.level;
    }
    const evidenceRefs = parseEvidenceRefs(body.evidenceRefs);
    if (evidenceRefs === null) return NextResponse.json({ ok: false, error: 'evidenceRefs is malformed.' }, { status: 400 });
    const note = typeof body.note === 'string' ? body.note : null;

    const { error } = await admin.from('bars_answers').upsert({
      investor_member_id: member.id, startup_org_id: orgId, axis, bank_version: bank.version,
      question_id: questionId, level, skipped, evidence_refs: evidenceRefs, note,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'investor_member_id,startup_org_id,question_id' });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.kind === 'flag') {
    const flagId = typeof body.flagId === 'string' ? body.flagId : null;
    if (!flagId || !bank.redFlags.some((f) => f.id === flagId)) {
      return NextResponse.json({ ok: false, error: 'Unknown red flag id for this axis.' }, { status: 400 });
    }
    if (typeof body.state !== 'string' || !FLAG_STATES.includes(body.state as BarsFlagState)) {
      return NextResponse.json({ ok: false, error: 'state must be one of unverified/confirmed/cleared.' }, { status: 400 });
    }
    const evidenceRefs = parseEvidenceRefs(body.evidenceRefs);
    if (evidenceRefs === null) return NextResponse.json({ ok: false, error: 'evidenceRefs is malformed.' }, { status: 400 });
    const note = typeof body.note === 'string' ? body.note : null;

    const { error } = await admin.from('bars_red_flag_states').upsert({
      investor_member_id: member.id, startup_org_id: orgId, flag_id: flagId, bank_version: bank.version,
      state: body.state, evidence_refs: evidenceRefs, note, updated_at: new Date().toISOString(),
    }, { onConflict: 'investor_member_id,startup_org_id,flag_id' });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.kind === 'axis_state') {
    if (typeof body.notMaterial !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'notMaterial must be a boolean.' }, { status: 400 });
    }
    const { error } = await admin.from('bars_axis_state').upsert({
      investor_member_id: member.id, startup_org_id: orgId, axis, not_material: body.notMaterial,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'investor_member_id,startup_org_id,axis' });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'kind must be one of answer/flag/axis_state.' }, { status: 400 });
}
