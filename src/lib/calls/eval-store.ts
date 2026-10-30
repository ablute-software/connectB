// Prompt 922 (I3) — the evaluator's side, against the database. One evaluation per evaluator and application; scores per criterion on the grid VERSION the evaluation started on (a later version of the grid never
// changes it); everything is decided HERE, never in the browser:
//   • who may open it: an evaluator only for an application ASSIGNED to them and only while they still have "Evaluate assigned applications"; an administrator (Configure call) any, read-only for what is not theirs;
//   • blind evaluation: the application leaves the server already masked (eval-mask.ts) unless the reader is an administrator;
//   • colleagues' evaluations: only with "View colleagues' evaluations" AND after submitting their own — never the private note, which only an administrator reads;
//   • autosave with a revision (two tabs never overwrite each other silently); once submitted it is read-only; only an administrator reopens it, with a reason that is kept with what was there;
//   • a closed evaluation ("Close evaluation") accepts nothing.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callPermissions, type CallAuth, type CallsAuth } from './access';
import { createNotice } from './applicant/notices';
import { loadSubmission } from './applicant/store';
import { GENERIC_EMAIL_DOMAINS } from './duplicates';
import { autoDrift, autoResultsFor, liveScores, overrideMove, resolveScore, type AutoResult, type HeldScore, type ScoreSource } from './eval-auto';
import { belowMinimum, weightedGrade, type Criterion, type GridSettings } from './eval-grid';
import { loadCriteria, loadSettings } from './eval-grid-store';
import { buildRedactor, identifiersOf, maskAnswers, maskFileName, type Redactor } from './eval-mask';
import { localDay } from './eligibility';
import { loadCall, loadFields } from './store';
import { callOrg, loadCallTeam, loadCategories, describePeople } from './team-store';
import type { AnswerValue, Call, FormField } from './types';

type Row = Record<string, unknown>;
export type EvalState = 'not_started' | 'in_progress' | 'submitted';
export const MAX_COMMENT = 2000;
export const MAX_NOTE = 5000;

// --- Access ----------------------------------------------------------------------------------------------------------------------------------------------

export interface AppRow { id: string; reference: string | null; startupOrgId: string | null; applicantUserId: string; submissionId: string; submittedAt: string | null }
export type Gate =
  | { ok: true; app: AppRow; admin: boolean; assigned: boolean; masked: boolean; settings: GridSettings }
  | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): Gate => ({ ok: false, status, error });

export async function gateFor(auth: CallAuth, applicationId: string): Promise<Gate> {
  const { data } = await auth.admin.from('call_applications').select('id, reference, startup_org_id, applicant_user_id, status, current_submission_id, submitted_at').eq('id', applicationId).eq('call_id', auth.call.id).eq('status', 'submitted').maybeSingle();
  const a = data as Row | null;
  if (!a || !a.current_submission_id) return refuse(404, 'That application does not exist.');
  const admin = auth.perms.configure_call;
  const { data: asg } = await auth.admin.from('call_eval_assignments').select('id').eq('call_id', auth.call.id).eq('application_id', applicationId).eq('evaluator_user_id', auth.userId).eq('status', 'assigned').maybeSingle();
  const assigned = !!asg && auth.perms.evaluate_assigned;
  if (!admin && !assigned) return refuse(403, 'This application is not assigned to you.');
  const settings = await loadSettings(auth.admin, auth.call.id);
  return {
    ok: true, admin, assigned, masked: settings.blind && !admin, settings,
    app: { id: a.id as string, reference: (a.reference as string | null) ?? null, startupOrgId: (a.startup_org_id as string | null) ?? null, applicantUserId: a.applicant_user_id as string, submissionId: a.current_submission_id as string, submittedAt: (a.submitted_at as string | null) ?? null },
  };
}

// --- The evaluation row ----------------------------------------------------------------------------------------------------------------------------------

export interface EvalRow { id: string; status: 'in_progress' | 'submitted'; gridVersion: number; revision: number; overallComment: string; privateNote: string; gradePercent: number | null; reopenedCount: number; submittedAt: string | null; submissionId: string | null; userId: string }
const toEval = (r: Row): EvalRow => ({
  id: r.id as string, status: r.status === 'submitted' ? 'submitted' : 'in_progress', gridVersion: Number(r.grid_version ?? 1), revision: Number(r.revision ?? 0), overallComment: String(r.overall_comment ?? ''), privateNote: String(r.private_note ?? ''),
  gradePercent: r.grade_percent === null || r.grade_percent === undefined ? null : Number(r.grade_percent), reopenedCount: Number(r.reopened_count ?? 0), submittedAt: (r.submitted_at as string | null) ?? null, submissionId: (r.submission_id as string | null) ?? null, userId: r.evaluator_user_id as string,
});
export type ScoreMap = Record<string, { score: number | null; comment: string; source?: ScoreSource; autoValue?: number | null }>;

export async function loadEvaluation(admin: SupabaseClient, applicationId: string, userId: string): Promise<{ row: EvalRow; scores: ScoreMap } | null> {
  const { data } = await admin.from('call_evaluations').select('*').eq('application_id', applicationId).eq('evaluator_user_id', userId).maybeSingle();
  if (!data) return null;
  const row = toEval(data as Row);
  return { row, scores: await loadScores(admin, row.id) };
}
async function loadScores(admin: SupabaseClient, evaluationId: string): Promise<ScoreMap> {
  const { data } = await admin.from('call_eval_scores').select('criterion_id, score, comment, source, auto_value').eq('evaluation_id', evaluationId);
  const out: ScoreMap = {};
  for (const s of (data ?? []) as Row[]) out[s.criterion_id as string] = {
    score: s.score === null || s.score === undefined ? null : Number(s.score), comment: String(s.comment ?? ''),
    source: s.source === 'auto' || s.source === 'override' ? s.source : 'manual', autoValue: s.auto_value === null || s.auto_value === undefined ? null : Number(s.auto_value),
  };
  return out;
}
const numericScores = (m: ScoreMap): Record<string, number | null> => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.score]));

// --- What the screen shows -------------------------------------------------------------------------------------------------------------------------------

async function identityOf(admin: SupabaseClient, app: AppRow, startupName: string | null): Promise<Redactor> {
  const ids = new Set<string>([app.applicantUserId]);
  if (app.startupOrgId) { const { data } = await admin.from('org_members').select('user_id').eq('org_id', app.startupOrgId); for (const r of (data ?? []) as Row[]) if (r.user_id) ids.add(r.user_id as string); }
  const people: { name?: string | null; email?: string | null }[] = [];
  for (const id of ids) {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      const u = data?.user; const meta = (u?.user_metadata ?? {}) as Row;
      if (u) people.push({ email: u.email ?? null, name: (meta.full_name as string | undefined) ?? (meta.name as string | undefined) ?? null });
    } catch { /* a person we cannot read is a person we cannot mask by name: their email answers are still hidden whole */ }
  }
  return buildRedactor(identifiersOf({ startupName, people, genericDomains: GENERIC_EMAIL_DOMAINS }));
}

export interface EvaluationPayload {
  call: { id: string; name: string; timezone: string; closed: boolean };
  role: 'admin' | 'evaluator'; canEdit: boolean; canReopen: boolean; blind: boolean;
  application: { id: string; reference: string | null; startupName: string | null; submittedAt: string | null; version: number };
  fields: FormField[]; answers: Record<string, AnswerValue>; currency: string;
  documents: { fileId: string; fieldId: string; fileName: string; size: number | null; url: string }[];
  grid: { version: number; criteria: Criterion[]; commentRequiredForAll: boolean };
  evaluation: { id: string | null; status: EvalState; scores: ScoreMap; overallComment: string; privateNote: string; revision: number; gradePercent: number | null; submittedAt: string | null; reopenedCount: number };
  below: { id: string; name: string; score: number; min: number }[];
  /** Criteria that score themselves from an answer (Adenda 1, B): what the answer is worth, why, and whether the evaluator may change it. */
  autos: Record<string, { status: 'scored' | 'missing'; points: number | null; because: string; override: boolean; fieldId: string }>;
  /** Administrators only: submitted evaluations whose automatic points no longer match the application's answers (a warning; nothing changes by itself). */
  drift: { criterionId: string; name: string; held: number; now: number }[];
  deadline: { day: string; daysLeft: number } | null;
  colleagues: { userId: string; evaluator: string | null; scores: ScoreMap; overallComment: string; gradePercent: number | null; privateNote?: string; drift?: { criterionId: string; name: string; held: number; now: number }[] }[] | null;
}

const daysBetween = (from: string, to: string): number => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000);
/** The next deadline of the evaluation (today or later); when all have passed, the last one (negative days left). */
export function nextDeadline(settings: Pick<GridSettings, 'deadlines'>, call: Pick<Call, 'timezone'>, now: Date = new Date()): { day: string; daysLeft: number } | null {
  const today = localDay(now.toISOString(), call.timezone);
  const days = settings.deadlines.map((d) => d.day).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (days.length === 0) return null;
  const day = days.find((d) => d >= today) ?? days[days.length - 1];
  return { day, daysLeft: daysBetween(today, day) };
}

export async function buildPayload(auth: CallAuth, gate: Extract<Gate, { ok: true }>): Promise<EvaluationPayload> {
  const { admin, call } = auth;
  const sub = await loadSubmission(admin, gate.app.submissionId);
  const mine = await loadEvaluation(admin, gate.app.id, auth.userId);
  const version = mine?.row.gridVersion ?? call.evalGridVersion ?? 1;
  const [criteria, fields, snapshot, org] = await Promise.all([
    loadCriteria(admin, call.id, version), loadFields(admin, call.id),
    admin.from('call_application_submissions').select('form_snapshot').eq('id', gate.app.submissionId).maybeSingle(),
    gate.app.startupOrgId ? admin.from('orgs').select('name').eq('id', gate.app.startupOrgId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const snapFields = ((snapshot.data as { form_snapshot?: { fields?: FormField[] } } | null)?.form_snapshot?.fields ?? fields) as FormField[];
  const startupName = ((org.data as Row | null)?.name as string | undefined) ?? null;
  let answers = (sub?.answers ?? {}) as Record<string, AnswerValue>;
  // What the automatic criteria are worth is read from the answers as they were given — closed answers hold no identity, so blind evaluation changes nothing here.
  const results = autoResultsFor(criteria, snapFields, answers as Record<string, unknown>);
  let docs = (sub?.documents ?? []).map((d, i) => ({ fileId: d.fileId, fieldId: d.fieldId, fileName: d.fileName, size: d.size ?? null, label: snapFields.find((f) => f.id === d.fieldId)?.label ?? '', i }));
  if (gate.masked) {
    const redact = await identityOf(admin, gate.app, startupName);
    answers = maskAnswers(snapFields, answers, redact);
    docs = docs.map((d) => ({ ...d, fileName: maskFileName(d.fileName, redact, d.label, d.i) }));
  }
  const base = `/api/calls/${call.id}/evaluations/${gate.app.id}/documents`;
  const ev = mine ?? { row: null as EvalRow | null, scores: {} as ScoreMap };
  const state: EvalState = ev.row ? ev.row.status : 'not_started';
  const closed = !!call.evaluationClosedAt;
  // Until it is submitted the evaluation follows the application (a corrected answer recalculates the point); once submitted it is what it was.
  const shown: ScoreMap = state === 'submitted' ? ev.scores : liveScores(criteria, ev.scores, results);

  // Colleagues: with the permission and only after finishing one's own; an administrator reads all (the private note too).
  let colleagues: EvaluationPayload['colleagues'] = null;
  if (gate.admin || (auth.perms.view_colleagues_evaluations && state === 'submitted')) {
    const { data } = await admin.from('call_evaluations').select('*').eq('application_id', gate.app.id).eq('status', 'submitted');
    const others = ((data ?? []) as Row[]).map(toEval).filter((e) => e.userId !== auth.userId);
    const names = await describePeople(admin, callOrg(call), others.map((o) => o.userId));
    colleagues = [];
    for (const o of others) {
      const theirs = await loadScores(admin, o.id);
      colleagues.push({ userId: o.userId, evaluator: names.get(o.userId)?.name ?? names.get(o.userId)?.email ?? null, scores: theirs, overallComment: o.overallComment, gradePercent: o.gradePercent, ...(gate.admin ? { privateNote: o.privateNote, drift: autoDrift(criteria, theirs as Record<string, HeldScore>, results) } : {}) });
    }
  }
  return {
    call: { id: call.id, name: call.name, timezone: call.timezone, closed },
    role: gate.admin ? 'admin' : 'evaluator', canEdit: gate.assigned && !closed && state !== 'submitted', canReopen: gate.admin && !closed, blind: gate.masked,
    application: { id: gate.app.id, reference: gate.app.reference, startupName: gate.masked ? null : startupName, submittedAt: gate.app.submittedAt, version: sub?.version ?? 1 },
    fields: snapFields, answers, currency: call.currency,
    documents: docs.map((d) => ({ fileId: d.fileId, fieldId: d.fieldId, fileName: d.fileName, size: d.size, url: `${base}/${d.fileId}` })),
    grid: { version, criteria, commentRequiredForAll: gate.settings.commentRequiredForAll },
    evaluation: { id: ev.row?.id ?? null, status: state, scores: shown, overallComment: ev.row?.overallComment ?? '', privateNote: ev.row?.privateNote ?? '', revision: ev.row?.revision ?? 0, gradePercent: ev.row?.gradePercent ?? null, submittedAt: ev.row?.submittedAt ?? null, reopenedCount: ev.row?.reopenedCount ?? 0 },
    below: belowMinimum(criteria, numericScores(shown)),
    autos: Object.fromEntries(criteria.filter((c) => c.auto).map((c) => [c.id, { status: results[c.id].status, points: results[c.id].status === 'scored' ? (results[c.id] as Extract<AutoResult, { status: 'scored' }>).points : null, because: results[c.id].because, override: c.auto!.override, fieldId: c.auto!.fieldId }])),
    drift: gate.admin && state === 'submitted' ? autoDrift(criteria, ev.scores as Record<string, HeldScore>, results) : [],
    deadline: nextDeadline(gate.settings, call),
    colleagues,
  };
}

// --- Saving ----------------------------------------------------------------------------------------------------------------------------------------------

export type Move<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string; code?: string; [k: string]: unknown };
const bad = (status: number, error: string, code?: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, status, error, ...(code ? { code } : {}), ...extra });

export interface DraftInput { revision?: number; scores?: Record<string, { score?: number | null; comment?: string }>; overallComment?: string; privateNote?: string }

/** Autosave: only what is sent changes. Creates the evaluation on the first save, on the grid version in force at that moment. */
export async function saveDraft(auth: CallAuth, gate: Extract<Gate, { ok: true }>, input: DraftInput): Promise<Move<{ revision: number; gradePercent: number | null }>> {
  const { admin, call } = auth;
  if (!gate.assigned) return bad(403, 'This application is not assigned to you.');
  if (call.evaluationClosedAt) return bad(409, 'The evaluation is closed: nothing can be changed any more.', 'closed');
  let cur = await loadEvaluation(admin, gate.app.id, auth.userId);
  if (cur?.row.status === 'submitted') return bad(409, 'You already submitted this evaluation. Only an administrator can reopen it.', 'submitted');
  if (cur && typeof input.revision === 'number' && input.revision !== cur.row.revision) return bad(409, 'This evaluation was changed in another window. Reload to continue.', 'conflict', { revision: cur.row.revision });
  const version = cur?.row.gridVersion ?? call.evalGridVersion ?? 1;
  const criteria = await loadCriteria(admin, call.id, version);
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const results = criteria.some((c) => c.auto) ? autoResultsFor(criteria, await loadFields(admin, call.id), ((await loadSubmission(admin, gate.app.submissionId))?.answers ?? {}) as Record<string, unknown>) : {};
  for (const [id, s] of Object.entries(input.scores ?? {})) {
    const c = byId.get(id);
    if (!c) return bad(400, 'One of the criteria does not belong to this grid.');
    // A criterion that scores itself is not scored by the evaluator — unless the entity allowed it, and then only with a comment (checked on submitting). With no answer to score from, the evaluator scores.
    if (s.score !== undefined && c.auto && overrideMove(c.auto, results[id] ?? null) === 'locked') return bad(403, `“${c.name}” is scored automatically from the applicant’s answer: it cannot be changed.`, 'auto_locked');
    if (s.score !== undefined && s.score !== null && (!Number.isInteger(s.score) || s.score < c.scaleMin || s.score > c.scaleMax)) return bad(400, `A score for “${c.name}” must be a whole number from ${c.scaleMin} to ${c.scaleMax}.`);
    if (typeof s.comment === 'string' && s.comment.length > MAX_COMMENT) return bad(400, `A comment can have at most ${MAX_COMMENT} characters.`);
  }
  if (typeof input.overallComment === 'string' && input.overallComment.length > MAX_NOTE) return bad(400, `The general comment can have at most ${MAX_NOTE} characters.`);
  if (typeof input.privateNote === 'string' && input.privateNote.length > MAX_NOTE) return bad(400, `The private note can have at most ${MAX_NOTE} characters.`);

  if (!cur) {
    const ins = await admin.from('call_evaluations').insert({ call_id: call.id, application_id: gate.app.id, evaluator_user_id: auth.userId, submission_id: gate.app.submissionId, grid_version: version, status: 'in_progress', revision: 0 }).select('*').single();
    if (ins.error || !ins.data) return bad(500, 'The evaluation could not be started. Please try again.');
    cur = { row: toEval(ins.data as Row), scores: {} };
    await admin.from('call_events').insert({ call_id: call.id, application_id: gate.app.id, event: 'eval_started', actor_user_id: auth.userId, detail: { gridVersion: version } });
  }
  let scores: ScoreMap = { ...cur.scores };
  for (const [id, s] of Object.entries(input.scores ?? {})) {
    const c = byId.get(id)!;
    const prev = scores[id] ?? { score: null, comment: '' };
    const next: ScoreMap[string] = { score: s.score === undefined ? prev.score : s.score, comment: typeof s.comment === 'string' ? s.comment : prev.comment, source: prev.source ?? 'manual', autoValue: prev.autoValue ?? null };
    // An automatic criterion keeps its point: a changed score is an override (both values kept), the same value again is just the automatic one.
    const r = results[id] ?? null;
    if (c.auto && r && r.status === 'scored' && s.score !== undefined) {
      if (s.score === null || s.score === r.points) { next.score = r.points; next.source = 'auto'; } else next.source = 'override';
      next.autoValue = r.points;
    } else if (!c.auto) { next.source = 'manual'; next.autoValue = null; }
    if (!c.auto && next.score === null && next.comment === '') { delete scores[id]; await admin.from('call_eval_scores').delete().eq('evaluation_id', cur.row.id).eq('criterion_id', id); continue; }
    scores[id] = next;
    const up = await admin.from('call_eval_scores').upsert({ evaluation_id: cur.row.id, criterion_id: id, score: next.score, comment: next.comment, source: next.source ?? 'manual', auto_value: next.autoValue ?? null, updated_at: new Date().toISOString() }, { onConflict: 'evaluation_id,criterion_id' });
    if (up.error) return bad(500, 'Your score could not be saved. Please try again.');
  }
  scores = await syncAuto(admin, cur.row.id, criteria, results, scores);
  const grade = weightedGrade(criteria, numericScores(scores)).percent;
  const revision = cur.row.revision + 1;
  const patch: Row = { revision, grade_percent: grade, updated_at: new Date().toISOString() };
  if (typeof input.overallComment === 'string') patch.overall_comment = input.overallComment;
  if (typeof input.privateNote === 'string') patch.private_note = input.privateNote;
  const upd = await admin.from('call_evaluations').update(patch).eq('id', cur.row.id).eq('revision', cur.row.revision).select('id');
  if (upd.error || (upd.data ?? []).length === 0) return bad(409, 'This evaluation was changed in another window. Reload to continue.', 'conflict');
  return { ok: true, revision, gradePercent: grade };
}

/**
 * Writes down what the automatic criteria are worth NOW (the point of the answer, an override kept beside it, or nothing when there is no answer to score from) and returns the scores as they stand. Only rows that
 * differ are written, so a save that changed nothing here writes nothing.
 */
async function syncAuto(admin: SupabaseClient, evaluationId: string, criteria: Criterion[], results: Record<string, AutoResult>, held: ScoreMap): Promise<ScoreMap> {
  const next = liveScores(criteria, held, results) as ScoreMap;
  for (const c of criteria) {
    if (!c.auto || !results[c.id]) continue;
    const was = held[c.id]; const now = next[c.id];
    if (!now) { if (was) { await admin.from('call_eval_scores').delete().eq('evaluation_id', evaluationId).eq('criterion_id', c.id); } continue; }
    if (was && was.score === now.score && was.comment === now.comment && (was.source ?? 'manual') === now.source && (was.autoValue ?? null) === (now.autoValue ?? null)) continue;
    const up = await admin.from('call_eval_scores').upsert({ evaluation_id: evaluationId, criterion_id: c.id, score: now.score, comment: now.comment, source: now.source ?? 'manual', auto_value: now.autoValue ?? null, updated_at: new Date().toISOString() }, { onConflict: 'evaluation_id,criterion_id' });
    if (up.error) throw new Error(`Could not write the automatic scores: ${up.error.message}`);
  }
  return next;
}

// --- Submitting ------------------------------------------------------------------------------------------------------------------------------------------

/** What is still missing for a submission: a score for every criterion, and the comment where one is required (the criterion's own, or the grid's "required for all"). */
export function missingForSubmit(criteria: Criterion[], scores: ScoreMap, commentRequiredForAll: boolean): { criterionId: string; name: string; problem: 'score' | 'comment' }[] {
  const out: { criterionId: string; name: string; problem: 'score' | 'comment' }[] = [];
  for (const c of criteria) {
    const s = scores[c.id];
    if (!s || s.score === null) out.push({ criterionId: c.id, name: c.name, problem: 'score' });
    else if ((c.commentRequired || commentRequiredForAll || s.source === 'override') && s.comment.trim() === '') out.push({ criterionId: c.id, name: c.name, problem: 'comment' });
  }
  return out;
}
export function missingSentence(missing: { problem: 'score' | 'comment' }[]): string {
  const s = missing.filter((m) => m.problem === 'score').length; const c = missing.filter((m) => m.problem === 'comment').length;
  const parts = [s ? `score ${s === 1 ? 'the 1 criterion' : `the ${s} criteria`} still without a score` : '', c ? `write the ${c === 1 ? '1 comment' : `${c} comments`} that ${c === 1 ? 'is' : 'are'} required` : ''].filter(Boolean);
  return `Before submitting: ${parts.join(' and ')}.`;
}

export async function submitEvaluation(auth: CallAuth, gate: Extract<Gate, { ok: true }>, revision: number | undefined): Promise<Move<{ gradePercent: number | null; submittedAt: string }>> {
  const { admin, call } = auth;
  if (!gate.assigned) return bad(403, 'This application is not assigned to you.');
  if (call.evaluationClosedAt) return bad(409, 'The evaluation is closed: nothing can be submitted any more.', 'closed');
  const cur = await loadEvaluation(admin, gate.app.id, auth.userId);
  if (!cur) return bad(422, 'Score the criteria before submitting.', 'incomplete', { missing: [] });
  if (cur.row.status === 'submitted') return bad(409, 'You already submitted this evaluation.', 'submitted');
  if (typeof revision === 'number' && revision !== cur.row.revision) return bad(409, 'This evaluation was changed in another window. Reload to continue.', 'conflict');
  const criteria = await loadCriteria(admin, call.id, cur.row.gridVersion);
  // Last look at the application: an automatic point follows a corrected answer right up to the moment of submitting, and from then on it is what it is.
  const results = criteria.some((c) => c.auto) ? autoResultsFor(criteria, await loadFields(admin, call.id), ((await loadSubmission(admin, gate.app.submissionId))?.answers ?? {}) as Record<string, unknown>) : {};
  const scores = await syncAuto(admin, cur.row.id, criteria, results, cur.scores);
  const missing = missingForSubmit(criteria, scores, gate.settings.commentRequiredForAll);
  if (missing.length) return bad(422, missingSentence(missing), 'incomplete', { missing });
  const grade = weightedGrade(criteria, numericScores(scores)).percent;
  const at = new Date().toISOString();
  const upd = await admin.from('call_evaluations').update({ status: 'submitted', submitted_at: at, grade_percent: grade, revision: cur.row.revision + 1, updated_at: at }).eq('id', cur.row.id).eq('status', 'in_progress').select('id');
  if (upd.error || (upd.data ?? []).length === 0) return bad(409, 'You already submitted this evaluation.', 'submitted');
  await admin.from('call_events').insert({ call_id: call.id, application_id: gate.app.id, event: 'eval_submitted', actor_user_id: auth.userId, detail: { gridVersion: cur.row.gridVersion, gradePercent: grade } });
  return { ok: true, gradePercent: grade, submittedAt: at };
}

// --- Reopening (administrator) ---------------------------------------------------------------------------------------------------------------------------

/** Only an administrator, only a SUBMITTED evaluation, always with a reason; what was there is kept with it. The evaluator is told. */
export async function reopenEvaluation(auth: CallAuth, applicationId: string, evaluatorUserId: string, reason: string): Promise<Move> {
  const { admin, call } = auth;
  if (!auth.perms.configure_call) return bad(403, 'You do not have the “Configure call” permission on this call.');
  if (call.evaluationClosedAt) return bad(409, 'The evaluation is closed. Nothing can be reopened.', 'closed');
  const why = reason.trim();
  if (why.length < 5) return bad(400, 'Write the reason for reopening (at least 5 characters). It is kept with the evaluation.');
  const { data: row } = await admin.from('call_evaluations').select('*').eq('application_id', applicationId).eq('call_id', call.id).eq('evaluator_user_id', evaluatorUserId).maybeSingle();
  if (!row) return bad(404, 'That evaluation does not exist.');
  const e = toEval(row as Row);
  if (e.status !== 'submitted') return bad(409, 'That evaluation is not submitted.');
  const scores = await loadScores(admin, e.id);
  await admin.from('call_eval_reopenings').insert({ evaluation_id: e.id, reopened_by: auth.userId, reason: why.slice(0, 1000), snapshot: { scores, overallComment: e.overallComment, gradePercent: e.gradePercent, submittedAt: e.submittedAt, gridVersion: e.gridVersion } });
  const upd = await admin.from('call_evaluations').update({ status: 'in_progress', submitted_at: null, reopened_count: e.reopenedCount + 1, revision: e.revision + 1, updated_at: new Date().toISOString() }).eq('id', e.id).eq('status', 'submitted').select('id');
  if (upd.error || (upd.data ?? []).length === 0) return bad(409, 'That evaluation was already reopened.');
  await admin.from('call_events').insert({ call_id: call.id, application_id: applicationId, event: 'eval_reopened', actor_user_id: auth.userId, detail: { evaluator: evaluatorUserId, reason: why.slice(0, 200) } });
  try {
    await createNotice(admin, { userId: evaluatorUserId, callId: call.id, applicationId: null, kind: 'eval_assigned', dedupeKey: `eval:reopened:${e.id}:${e.reopenedCount + 1}`, linkPath: null,
      content: { title: `Evaluation reopened — ${call.name}`, body: `An administrator reopened your evaluation of an application of “${call.name}”: ${why.slice(0, 300)}. You can change it and submit it again.`, ctaLabel: 'Open my evaluations' } });
  } catch (err) { console.error('[calls/eval] could not tell the evaluator about a reopening:', (err as Error).message); }
  return { ok: true };
}

// --- My evaluations --------------------------------------------------------------------------------------------------------------------------------------

export interface MineItem { applicationId: string; reference: string | null; startupName: string | null; state: EvalState; gradePercent: number | null; updatedAt: string | null }
export interface MineCall { callId: string; callName: string; timezone: string; blind: boolean; closed: boolean; deadline: { day: string; daysLeft: number } | null; total: number; notStarted: number; inProgress: number; submitted: number; remaining: number; items: MineItem[] }

/** Every call where the person has applications assigned — and still has the permission, in a call that is not deleted or archived. The server decides; a removed permission empties the list. */
export async function listMine(auth: CallsAuth, now: Date = new Date()): Promise<MineCall[]> {
  const { admin, userId } = auth;
  const { data: asg } = await admin.from('call_eval_assignments').select('call_id, application_id').eq('evaluator_user_id', userId).eq('status', 'assigned');
  const byCall = new Map<string, string[]>();
  for (const a of (asg ?? []) as Row[]) (byCall.get(a.call_id as string) ?? byCall.set(a.call_id as string, []).get(a.call_id as string)!).push(a.application_id as string);
  const out: MineCall[] = [];
  for (const [callId, appIds] of byCall) {
    const call = await loadCall(admin, callId);
    const promoter = call ? auth.promoters.find((p) => p.kind === call.promoterKind && p.id === call.promoterId) : undefined;
    if (!call || !promoter || call.deletedAt || call.status === 'archived') continue;
    const [members, categories] = await Promise.all([loadCallTeam(admin, call.id), loadCategories(admin, callOrg(call))]);
    if (!callPermissions(promoter, userId, { categories, members }).evaluate_assigned) continue;
    const settings = await loadSettings(admin, call.id);
    const { data: apps } = await admin.from('call_applications').select('id, reference, startup_org_id, status').eq('call_id', call.id).eq('status', 'submitted').in('id', appIds);
    const rows = (apps ?? []) as Row[];
    const orgIds = [...new Set(rows.map((r) => r.startup_org_id as string | null).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (orgIds.length) { const { data: orgs } = await admin.from('orgs').select('id, name').in('id', orgIds); for (const o of (orgs ?? []) as Row[]) names.set(o.id as string, String(o.name ?? '')); }
    const { data: evs } = await admin.from('call_evaluations').select('application_id, status, grade_percent, updated_at').eq('call_id', call.id).eq('evaluator_user_id', userId);
    const evBy = new Map(((evs ?? []) as Row[]).map((e) => [e.application_id as string, e]));
    const items: MineItem[] = rows.map((r): MineItem => {
      const e = evBy.get(r.id as string);
      return { applicationId: r.id as string, reference: (r.reference as string | null) ?? null, startupName: settings.blind ? null : (r.startup_org_id ? names.get(r.startup_org_id as string) ?? null : null),
        state: e ? (e.status === 'submitted' ? 'submitted' as const : 'in_progress' as const) : 'not_started' as const, gradePercent: e && e.grade_percent !== null && e.grade_percent !== undefined ? Number(e.grade_percent) : null, updatedAt: (e?.updated_at as string | null) ?? null };
    }).sort((a, b) => (a.reference ?? a.applicationId) < (b.reference ?? b.applicationId) ? -1 : 1);
    const count = (s: EvalState) => items.filter((i) => i.state === s).length;
    out.push({ callId: call.id, callName: call.name, timezone: call.timezone, blind: settings.blind, closed: !!call.evaluationClosedAt, deadline: nextDeadline(settings, call, now), total: items.length,
      notStarted: count('not_started'), inProgress: count('in_progress'), submitted: count('submitted'), remaining: items.length - count('submitted'), items });
  }
  return out.sort((a, b) => (a.deadline?.day ?? '9999') < (b.deadline?.day ?? '9999') ? -1 : 1);
}

// --- A document of the application, through the platform -----------------------------------------------------------------------------------------------

/** The frozen copy of one document of the submitted application and the name it is shown under (masked when the evaluation is blind). Never a Storage link: the route streams the bytes. */
export async function documentFor(auth: CallAuth, gate: Extract<Gate, { ok: true }>, fileId: string): Promise<{ frozenPath: string; fileName: string } | null> {
  const { admin } = auth;
  const sub = await loadSubmission(admin, gate.app.submissionId);
  const i = sub?.documents.findIndex((d) => d.fileId === fileId) ?? -1;
  if (!sub || i < 0) return null;
  const d = sub.documents[i];
  if (typeof d.frozenPath !== 'string' || !d.frozenPath) return null;
  let fileName = d.fileName;
  if (gate.masked) {
    const { data: org } = gate.app.startupOrgId ? await admin.from('orgs').select('name').eq('id', gate.app.startupOrgId).maybeSingle() : { data: null };
    const snap = (await admin.from('call_application_submissions').select('form_snapshot').eq('id', gate.app.submissionId).maybeSingle()).data as { form_snapshot?: { fields?: FormField[] } } | null;
    const label = snap?.form_snapshot?.fields?.find((f) => f.id === d.fieldId)?.label ?? '';
    fileName = maskFileName(d.fileName, await identityOf(admin, gate.app, ((org as Row | null)?.name as string | undefined) ?? null), label, i);
  }
  return { frozenPath: d.frozenPath, fileName };
}
