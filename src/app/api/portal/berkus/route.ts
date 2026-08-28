// Prompt 164 C — read/write this investor's own Berkus Method estimate for
// one startup. Same pattern as /api/portal/scorecard/scores: session ->
// resolveActiveInvestorMember -> service-role read/write with an explicit
// ownership scope (RLS on the table is defense in depth, this check is the
// real boundary). Private judgment only — nothing here is ever readable by
// the startup or any other investor seat.
//
// Prompt 428 §A — widened for Simplified/Detailed: the investor now picks
// an explicit 1-5 level per factor (never derived from a BARS/Sherlock
// score — §428's own non-negotiable principle) plus a shared calibration,
// instead of hand-sliding a raw EUR value. `estimate` (the legacy
// sound_idea_eur/... shape) is kept EXACTLY as before — EvaluationToolsPanel's
// own Compare enrichment reads it directly and must keep working with zero
// changes of its own — `calibration` and `factors` are new, additive keys
// the new BerkusMethodTool reads instead.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';
import { parseEvidenceRefs, type BarsEvidenceRef } from '@/lib/bars-scoring';
import { berkusFactorEur, berkusTotalEur, type BerkusMode, type BerkusFactorLevel } from '@/lib/berkus';
import type { BerkusFactorKey } from '@/content/berkus/factors_v1';

// Not exported — App Router route files may only export HTTP methods and
// route config; the UI keeps its own copy of these (same "display truth vs
// enforcement truth" split every other route here uses — the migration's
// CHECK constraints are the real floor either way).
const FACTOR_KEYS: BerkusFactorKey[] = ['sound_idea', 'prototype', 'team', 'relationships', 'sales'];
const MIN_CALIBRATION_REF_EUR = 1;
const MAX_CALIBRATION_REF_EUR = 10_000_000;

interface FactorState { level: number | null; skipped: boolean; evidenceRefs: BarsEvidenceRef[]; note: string | null }
function emptyFactorState(): FactorState {
  return { level: null, skipped: false, evidenceRefs: [], note: null };
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const emptyFactors = Object.fromEntries(FACTOR_KEYS.map((key) => [key, emptyFactorState()])) as Record<BerkusFactorKey, FactorState>;
  const empty = { estimate: null, calibration: { refEur: 500000, note: null }, factors: emptyFactors };
  if (!url || !serviceKey) return NextResponse.json(empty);

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json(empty);

  const [{ data: estimateRow }, { data: factorRows }] = await Promise.all([
    admin.from('investor_berkus_estimates')
      .select('sound_idea_eur, prototype_eur, team_eur, relationships_eur, sales_eur, calibration_ref_eur, calibration_note, updated_at')
      .eq('investor_member_id', member.id).eq('startup_org_id', orgId).maybeSingle(),
    admin.from('berkus_factor_answers').select('factor, level, skipped, evidence_refs, note')
      .eq('investor_member_id', member.id).eq('startup_org_id', orgId),
  ]);

  const factors: Record<BerkusFactorKey, FactorState> = {
    sound_idea: emptyFactorState(), prototype: emptyFactorState(), team: emptyFactorState(),
    relationships: emptyFactorState(), sales: emptyFactorState(),
  };
  for (const row of factorRows ?? []) {
    const key = row.factor as BerkusFactorKey;
    if (key in factors) {
      factors[key] = {
        level: row.level as number | null, skipped: row.skipped as boolean,
        evidenceRefs: (row.evidence_refs ?? []) as BarsEvidenceRef[], note: row.note as string | null,
      };
    }
  }

  // estimate: unchanged shape, still the legacy *_eur columns — Compare's
  // own fetch reads this exact key untouched.
  const estimate = estimateRow
    ? {
        sound_idea_eur: estimateRow.sound_idea_eur, prototype_eur: estimateRow.prototype_eur, team_eur: estimateRow.team_eur,
        relationships_eur: estimateRow.relationships_eur, sales_eur: estimateRow.sales_eur, updated_at: estimateRow.updated_at,
      }
    : null;
  const calibration = { refEur: estimateRow?.calibration_ref_eur ?? 500000, note: (estimateRow?.calibration_note as string | null) ?? null };

  return NextResponse.json({ estimate, calibration, factors });
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

  const body = await req.json().catch(() => ({})) as {
    orgId?: string; mode?: BerkusMode;
    calibration?: { refEur?: number; note?: string | null };
    factors?: Partial<Record<BerkusFactorKey, { level?: number | null; skipped?: boolean; evidenceRefs?: unknown; note?: string | null }>>;
  };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  if (body.mode !== 'simplified' && body.mode !== 'detailed') {
    return NextResponse.json({ ok: false, error: 'mode must be "simplified" or "detailed".' }, { status: 400 });
  }
  const refEur = body.calibration?.refEur;
  if (typeof refEur !== 'number' || !Number.isInteger(refEur) || refEur < MIN_CALIBRATION_REF_EUR || refEur > MAX_CALIBRATION_REF_EUR) {
    return NextResponse.json({ ok: false, error: `calibration.refEur must be an integer between ${MIN_CALIBRATION_REF_EUR} and ${MAX_CALIBRATION_REF_EUR}.` }, { status: 400 });
  }
  const calibrationNote = typeof body.calibration?.note === 'string' ? body.calibration.note : null;

  const parsedFactors: Record<BerkusFactorKey, BerkusFactorLevel & { evidenceRefs: BarsEvidenceRef[]; note: string | null }> = {} as never;
  for (const key of FACTOR_KEYS) {
    const raw = body.factors?.[key];
    const skipped = raw?.skipped === true;
    let level: number | null = null;
    if (!skipped && raw?.level != null) {
      if (typeof raw.level !== 'number' || !Number.isInteger(raw.level) || raw.level < 0 || raw.level > 5) {
        return NextResponse.json({ ok: false, error: `${key}.level must be an integer 0-5.` }, { status: 400 });
      }
      level = raw.level;
    }
    const evidenceRefs = parseEvidenceRefs(raw?.evidenceRefs);
    if (evidenceRefs === null) return NextResponse.json({ ok: false, error: `${key}.evidenceRefs is malformed.` }, { status: 400 });
    const note = typeof raw?.note === 'string' ? raw.note : null;
    parsedFactors[key] = { key, level, skipped, evidenceRefs, note };
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  const now = new Date().toISOString();
  const perFactorEur: Record<BerkusFactorKey, number> = {} as never;
  for (const key of FACTOR_KEYS) {
    const f = parsedFactors[key];
    perFactorEur[key] = berkusFactorEur(body.mode, f.level, f.skipped, refEur);
  }
  const totalEur = berkusTotalEur(body.mode, FACTOR_KEYS.map((key) => parsedFactors[key]), refEur);

  const { error: estimateError } = await admin.from('investor_berkus_estimates').upsert({
    investor_member_id: member.id, startup_org_id: body.orgId,
    sound_idea_eur: perFactorEur.sound_idea, prototype_eur: perFactorEur.prototype, team_eur: perFactorEur.team,
    relationships_eur: perFactorEur.relationships, sales_eur: perFactorEur.sales,
    calibration_ref_eur: refEur, calibration_note: calibrationNote, updated_at: now,
  }, { onConflict: 'investor_member_id,startup_org_id' });
  if (estimateError) return NextResponse.json({ ok: false, error: estimateError.message }, { status: 500 });

  const { error: factorsError } = await admin.from('berkus_factor_answers').upsert(
    FACTOR_KEYS.map((key) => ({
      investor_member_id: member.id, startup_org_id: body.orgId, factor: key,
      level: parsedFactors[key].level, skipped: parsedFactors[key].skipped,
      evidence_refs: parsedFactors[key].evidenceRefs, note: parsedFactors[key].note, updated_at: now,
    })),
    { onConflict: 'investor_member_id,startup_org_id,factor' },
  );
  if (factorsError) return NextResponse.json({ ok: false, error: factorsError.message }, { status: 500 });

  // Prompt 408 §B.2 / Prompt 428 §A — every explicit Save also appends a
  // history snapshot; best-effort, same as before — a failure here never
  // fails the save itself, which already succeeded above. inputs carries
  // the full portable state (mode + calibration + per-factor level/
  // evidence/note) so a snapshot from either mode can be read back by the
  // other — level alone is the shared, mode-agnostic state; only the
  // EUR conversion is mode-specific (see berkus.ts's own comment).
  await admin.from('evaluation_snapshots').insert({
    investor_member_id: member.id, startup_org_id: body.orgId, kind: 'berkus',
    inputs: {
      mode: body.mode, calibration: { refEur, note: calibrationNote },
      factors: Object.fromEntries(FACTOR_KEYS.map((key) => [key, {
        level: parsedFactors[key].level, skipped: parsedFactors[key].skipped,
        evidenceRefs: parsedFactors[key].evidenceRefs, note: parsedFactors[key].note,
      }])),
    },
    outputs: { totalEur, perFactorEur },
  }).then(({ error: snapshotErr }) => {
    if (snapshotErr) console.error('[portal/berkus] snapshot insert failed', snapshotErr.message);
  });

  return NextResponse.json({ ok: true });
}
