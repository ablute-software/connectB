// Prompt 922 (I1) — the Evaluation grid step: read the grid of a call (criteria, live weights, formula, examples, settings) and replace it.
//
//   draft                       edited in place;
//   validated / scheduled       locked, like the form ("Edit configuration" first);
//   open and later              edited in place UNTIL the first evaluation is SUBMITTED; from then on the grid is frozen: a change makes a NEW version, asks first (naming how many evaluations were made on the
//                               current one — they keep their version) and is recorded with the before and the after;
//   archived                    nothing changes.
// Only whoever may "Configure call". Optimistic concurrency on the step's own revision. The weights are NOT forced to 100 while the grid is being built (the step shows ⚠ and the call cannot be confirmed until
// they add up); every other rule is enforced. The blind option and "comment required for all" cannot change once an evaluation exists.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { parseCriteriaPayload, parseSettingsPayload, sameScoring, scoringOf } from '@/lib/calls/eval-grid';
import { diffProposal, type GridProposal } from '@/lib/calls/eval-grid-reader';
import { NOT_READY_BODY, bumpGrid, evaluationCounts, evaluationReady, loadCriteria, loadImportRun, loadSettings, markImportApplied, recomputeGrades, resultsPublished, saveSettings, writeCriteria } from '@/lib/calls/eval-grid-store';
import { buildGridView, gridMode } from '@/lib/calls/eval-grid-view';
import { loadCall, loadFields, loadPhases, logCallEvent } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';

async function viewOf(admin: Parameters<typeof loadCriteria>[0], callId: string) {
  const call = (await loadCall(admin, callId))!;
  const version = call.evalGridVersion ?? 1;
  const [criteria, settings, evaluations, phases, fields, scoringLocked] = await Promise.all([loadCriteria(admin, callId, version), loadSettings(admin, callId), evaluationCounts(admin, callId), loadPhases(admin, callId), loadFields(admin, callId), resultsPublished(admin, callId)]);
  return buildGridView({ status: call.status, version, rev: call.evalGridRev ?? 0, criteria, settings, evaluations, phases: phases.map((p) => ({ id: p.id, name: p.name })), fields, scoringLocked });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  return NextResponse.json({ ok: true, canManage: auth.promoter.canManage, ...(await viewOf(auth.admin, auth.call.id)) });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  const { call } = auth;
  const body = await req.json().catch(() => ({})) as { baseRev?: number; criteria?: unknown; settings?: unknown; confirm?: boolean; importRunId?: string };
  const counts = await evaluationCounts(auth.admin, call.id);
  const mode = gridMode(call.status, counts.submitted);
  if (mode === 'locked') return NextResponse.json({ ok: false, code: 'locked', error: 'The evaluation grid is locked. Use “Edit configuration” before the call opens.' }, { status: 409 });
  if (mode === 'archived') return NextResponse.json({ ok: false, code: 'locked', error: 'An archived call cannot be changed.' }, { status: 409 });
  if (!Number.isInteger(body.baseRev)) return NextResponse.json({ ok: false, error: 'Missing baseRev.' }, { status: 400 });

  const phases = await loadPhases(auth.admin, call.id);
  const fields = await loadFields(auth.admin, call.id);
  const parsed = parseCriteriaPayload(body.criteria, { fields });
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const ps = parseSettingsPayload(body.settings, phases.map((p) => p.id));
  if (!ps.ok) return NextResponse.json({ ok: false, error: ps.error }, { status: 400 });

  const version = call.evalGridVersion ?? 1;
  const [before, beforeSettings] = await Promise.all([loadCriteria(auth.admin, call.id, version), loadSettings(auth.admin, call.id)]);
  if (counts.started > 0 && (ps.settings.blind !== beforeSettings.blind || ps.settings.commentRequiredForAll !== beforeSettings.commentRequiredForAll)) {
    return NextResponse.json({ ok: false, code: 'settings_locked', error: 'Blind evaluation and “comment required for all” cannot change once an evaluation has been started.' }, { status: 409 });
  }
  // Prompt 922, Adenda 3 — how the criteria are combined: once results were published it is fixed; after the first submitted evaluation a change asks first, recalculates every final score and is recorded.
  const scoringBefore = scoringOf(beforeSettings); const scoringAfter = scoringOf(ps.settings);
  const scoringChanged = !sameScoring(scoringBefore, scoringAfter);
  if (scoringChanged && (await resultsPublished(auth.admin, call.id))) {
    return NextResponse.json({ ok: false, code: 'scoring_locked', error: 'The results were published: the way the criteria are combined can no longer be changed.' }, { status: 409 });
  }
  const norm = (cs: { name: string; weight: number; scaleMin: number; scaleMax: number; section: string | null; guidance: string; levels: unknown; commentRequired: boolean; minScore: number | null; linkedFields?: string[]; auto?: unknown; linkNotice?: boolean }[]) =>
    cs.map((c) => [c.name, c.weight, c.scaleMin, c.scaleMax, c.section, c.guidance, c.levels, c.commentRequired, c.minScore, c.linkedFields ?? [], c.auto ?? null, c.linkNotice === true]);
  const criteriaSame = same(norm(before), norm(parsed.criteria));
  const settingsSame = same(beforeSettings, ps.settings);
  if (criteriaSame && settingsSame) return NextResponse.json({ ok: true, unchanged: true, ...(await viewOf(auth.admin, call.id)) });

  // Only the criteria are frozen by a submitted evaluation; the settings that stay editable (how many evaluators, divergence, deadlines) never make a version.
  const recalcSentence = `Final scores will be recalculated for all applications: from ${scoringBefore.mode === 'weighted' ? 'weighted' : `equal weight (${scoringBefore.aggregation === 'sum' ? 'sum of points' : 'average'})`} to ${scoringAfter.mode === 'weighted' ? 'weighted' : `equal weight (${scoringAfter.aggregation === 'sum' ? 'sum of points' : 'average'})`}. The ranking follows.`;
  if (scoringChanged && counts.submitted > 0 && body.confirm !== true && !(mode === 'versioned' && !criteriaSame)) {
    return NextResponse.json({ ok: false, code: 'needs_confirm', kind: 'scoring', evaluations: counts.submitted, error: `${counts.submitted} evaluation${counts.submitted === 1 ? ' was' : 's were'} already submitted. ${recalcSentence}` }, { status: 409 });
  }
  let newVersion: number | null = null;
  if (mode === 'versioned' && !criteriaSame) {
    if (body.confirm !== true) {
      return NextResponse.json({
        ok: false, code: 'needs_confirm', evaluations: counts.submitted, nextVersion: version + 1,
        error: `The grid is frozen because ${counts.submitted} evaluation${counts.submitted === 1 ? ' was' : 's were'} already submitted on version ${version}. This change makes version ${version + 1}; those evaluations keep version ${version} and stay as they are, and the consolidation shows the version of each.${scoringChanged ? ` ${recalcSentence}` : ''} Continue?`,
      }, { status: 409 });
    }
    newVersion = version + 1;
  }
  const bumped = await bumpGrid(auth.admin, call, body.baseRev as number, newVersion);
  if (!bumped) return NextResponse.json({ ok: false, code: 'conflict', error: 'Someone else changed the evaluation grid. Reload to see their changes.' }, { status: 409 });
  let recalculated = 0;
  try {
    if (!criteriaSame) await writeCriteria(auth.admin, call.id, bumped.version, parsed.criteria);
    if (!settingsSame) await saveSettings(auth.admin, call.id, ps.settings, auth.userId);
    if (scoringChanged) recalculated = await recomputeGrades(auth.admin, call.id, scoringAfter);
  } catch (e) {
    console.error('[calls] evaluation grid not saved:', (e as Error).message);
    return NextResponse.json({ ok: false, error: 'The grid could not be saved. Please try again.' }, { status: 500 });
  }
  // A grid read from a document: what the administrator changed in the proposal is kept for this call (so the platform's reader can improve).
  if (body.importRunId) {
    const run = await loadImportRun(auth.admin, call.id, body.importRunId);
    if (run && run.status === 'proposed') await markImportApplied(auth.admin, call.id, run.id, diffProposal(run.proposal as GridProposal, parsed.criteria));
  }
  if (scoringChanged) await logCallEvent(auth.admin, call.id, 'eval_scoring_changed', auth.userId, { from: scoringBefore, to: scoringAfter, evaluations: recalculated });
  await logCallEvent(auth.admin, call.id, 'eval_grid_changed', auth.userId, {
    mode, version: bumped.version, criteria: { before: before.length, after: parsed.criteria.length }, settingsChanged: !settingsSame, fromImport: !!body.importRunId,
    before: before.map((c) => `${c.name} ${c.weight}% ${c.scaleMin}–${c.scaleMax}`), after: parsed.criteria.map((c) => `${c.name} ${c.weight}% ${c.scaleMin}–${c.scaleMax}`),
  });
  return NextResponse.json({ ok: true, ...(await viewOf(auth.admin, call.id)) });
}
