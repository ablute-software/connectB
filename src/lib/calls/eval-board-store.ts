// Prompt 922 (I4) — the board against the database: loads what the call's evaluations hold (nothing of another call), builds it with the pure module, records the final decision (Advance / Reject / Waitlist, with
// an optional note — nothing is sent to the applicant: that is the next stage) and closes or reopens the evaluation. Who may do what is decided by the routes from the call's permissions: reading the board needs
// "Configure call" or "Final decision"; deciding, closing and exporting need "Final decision".
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeBoard, type BoardEval, type BoardInput, type BoardRow, type BoardProgress, type Decision } from './eval-board';
import type { Criterion } from './eval-grid';
import { loadCriteria, loadSettings } from './eval-grid-store';
import { loadAssignments, loadFitApplications } from './eval-assign-store';
import { decisionLock } from './results-store';
import type { Call } from './types';

type Row = Record<string, unknown>;
export const DECISIONS: Decision[] = ['advance', 'reject', 'waitlist'];
export const MAX_DECISION_NOTE = 1000;

export interface Board { rows: BoardRow[]; progress: BoardProgress; criteria: Criterion[]; version: number; closed: boolean; closedAt: string | null }

export async function loadBoard(admin: SupabaseClient, call: Call): Promise<Board> {
  const version = call.evalGridVersion ?? 1;
  const [fit, assignments, settings, evRes, decRes] = await Promise.all([
    loadFitApplications(admin, call.id), loadAssignments(admin, call.id), loadSettings(admin, call.id),
    admin.from('call_evaluations').select('id, application_id, evaluator_user_id, status, grid_version, grade_percent').eq('call_id', call.id),
    admin.from('call_eval_decisions').select('application_id, decision, note').eq('call_id', call.id).eq('is_current', true),
  ]);
  const evRows = (evRes.data ?? []) as Row[];
  const { data: scoreRows } = evRows.length ? await admin.from('call_eval_scores').select('evaluation_id, criterion_id, score').in('evaluation_id', evRows.map((e) => e.id as string)) : { data: [] };
  const scoresBy = new Map<string, Record<string, number | null>>();
  for (const s of (scoreRows ?? []) as Row[]) { const m = scoresBy.get(s.evaluation_id as string) ?? {}; m[s.criterion_id as string] = s.score === null || s.score === undefined ? null : Number(s.score); scoresBy.set(s.evaluation_id as string, m); }
  const evaluations: BoardEval[] = evRows.map((e) => ({
    applicationId: e.application_id as string, evaluatorUserId: e.evaluator_user_id as string, status: e.status === 'submitted' ? 'submitted' : 'in_progress', gridVersion: Number(e.grid_version ?? 1),
    gradePercent: e.grade_percent === null || e.grade_percent === undefined ? null : Number(e.grade_percent), scores: scoresBy.get(e.id as string) ?? {},
  }));
  // An application that is no longer Fit but already has evaluations stays on the board (what was evaluated is never hidden).
  const known = new Set(fit.map((a) => a.applicationId));
  const extra = [...new Set(evaluations.map((e) => e.applicationId))].filter((id) => !known.has(id));
  const apps = fit.map((a) => ({ applicationId: a.applicationId, reference: a.reference, startupName: a.startupName }));
  if (extra.length) {
    const { data } = await admin.from('call_applications').select('id, reference').eq('call_id', call.id).in('id', extra);
    for (const r of (data ?? []) as Row[]) apps.push({ applicationId: r.id as string, reference: (r.reference as string | null) ?? null, startupName: null });
  }
  const versions = [...new Set([version, ...evaluations.map((e) => e.gridVersion)])];
  const criteriaByVersion: Record<number, Criterion[]> = {};
  for (const v of versions) criteriaByVersion[v] = await loadCriteria(admin, call.id, v);
  const decisions: BoardInput['decisions'] = {};
  for (const d of (decRes.data ?? []) as Row[]) decisions[d.application_id as string] = { decision: d.decision as Decision, note: (d.note as string | null) ?? null };
  const { rows, progress } = computeBoard({ apps, evaluations, assignments: assignments.map((a) => ({ applicationId: a.applicationId, userId: a.userId })), criteriaByVersion, currentVersion: version, divergence: settings.divergence, decisions });
  return { rows, progress, criteria: criteriaByVersion[version] ?? [], version, closed: !!call.evaluationClosedAt, closedAt: call.evaluationClosedAt ?? null };
}

export type Move = { ok: true } | { ok: false; status: number; error: string };

/** The final decision of one application (or none: clearing it). A new decision keeps the earlier ones as history; the same decision again changes nothing. Never tells the applicant. */
export async function setDecision(admin: SupabaseClient, call: Call, applicationId: string, decision: unknown, note: unknown, actor: string): Promise<Move> {
  if (decision !== null && !DECISIONS.includes(decision as Decision)) return { ok: false, status: 400, error: 'Choose Advance, Reject or Waitlist.' };
  const text = typeof note === 'string' ? note.trim().slice(0, MAX_DECISION_NOTE) : '';
  const { data: app } = await admin.from('call_applications').select('id').eq('id', applicationId).eq('call_id', call.id).eq('status', 'submitted').maybeSingle();
  if (!app) return { ok: false, status: 404, error: 'That application does not exist.' };
  // Prompt 924 (I2): once the result of an application is published — or its phase is scheduled to be — its decision is fixed. Only an accepted contestation changes it (I3).
  const lock = await decisionLock(admin, call, applicationId);
  if (lock) return { ok: false, status: 409, error: lock };
  const { data: cur } = await admin.from('call_eval_decisions').select('id, decision, note').eq('application_id', applicationId).eq('is_current', true).maybeSingle();
  const prev = cur as Row | null;
  if (decision === null && !prev) return { ok: true };
  if (prev && prev.decision === decision && ((prev.note as string | null) ?? '') === text) return { ok: true };
  if (prev) await admin.from('call_eval_decisions').update({ is_current: false }).eq('id', prev.id as string);
  if (decision !== null) {
    const ins = await admin.from('call_eval_decisions').insert({ call_id: call.id, application_id: applicationId, decision, note: text || null, decided_by: actor, is_current: true });
    if (ins.error) return { ok: false, status: 500, error: 'The decision could not be saved. Please try again.' };
  }
  await admin.from('call_events').insert({ call_id: call.id, application_id: applicationId, event: 'eval_decision', actor_user_id: actor, detail: { before: prev ? { decision: prev.decision, note: prev.note ?? null } : null, after: decision === null ? null : { decision, note: text || null } } });
  return { ok: true };
}

/** "Close evaluation": evaluators can no longer save or submit anything, and an administrator cannot reopen an evaluation. Reversible by whoever has the same permission. */
export async function setClosed(admin: SupabaseClient, call: Call, closed: boolean, actor: string): Promise<Move> {
  if (closed === !!call.evaluationClosedAt) return { ok: false, status: 409, error: closed ? 'The evaluation is already closed.' : 'The evaluation is not closed.' };
  const upd = await admin.from('calls').update(closed ? { evaluation_closed_at: new Date().toISOString(), evaluation_closed_by: actor } : { evaluation_closed_at: null, evaluation_closed_by: null }).eq('id', call.id);
  if (upd.error) return { ok: false, status: 500, error: 'It could not be done. Please try again.' };
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: closed ? 'eval_closed' : 'eval_reopened_all', actor_user_id: actor, detail: {} });
  return { ok: true };
}
