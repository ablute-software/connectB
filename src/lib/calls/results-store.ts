// Prompt 924 (Etapa 4, I1–I2) — the results against the database: the settings of a call's results, the facts every application's result is decided from (the decision on the evaluation board and the eligibility —
// NEVER an evaluator's comments or scores), the feedback and the validated grade an administrator writes for an application, the state of the round (which phase, whether a publication is scheduled or done: from
// then on what was prepared is FIXED) and the preview of what one applicant would be told. Who may read or write is decided by the routes ("Publish results"); publishing itself is results-publish.ts.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDayInZone } from './tz';
import { loadPhases, promoterName } from './store';
import {
  DEFAULT_SETTINGS, PLACEHOLDERS, RESULT_KEYS, blockersOf, buildMessage, cleanFeedback, cleanGrade, defaultMessage, labelOf, messageOf, outcomeOf, parseSettingsPatch, roundOf, summarise,
  type AppFacts, type BatchInfo, type BuiltMessage, type PrepareView, type ResultKey, type ResultSettings,
} from './results';
import type { Decision } from './eval-board';
import type { Call, CallPhase } from './types';

type Row = Record<string, unknown>;
export type Move<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

/** Until the migration is applied the tab says "not available yet" instead of showing a raw database error (the same switch the evaluation uses). */
export async function resultsReady(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from('call_result_batches').select('id').limit(1);
  return !(error && /does not exist|schema cache|PGRST205|42P01/i.test(`${error.code ?? ''} ${error.message ?? ''}`));
}
export const RESULTS_NOT_READY = { ok: false, code: 'not_available', error: 'Results are not available yet. They will be switched on shortly.' } as const;

export async function loadSettings(admin: SupabaseClient, callId: string): Promise<ResultSettings> {
  const { data } = await admin.from('call_result_settings').select('*').eq('call_id', callId).maybeSingle();
  const r = data as Row | null;
  if (!r) return { ...DEFAULT_SETTINGS, labels: {}, messages: {} };
  return {
    labels: (r.labels as ResultSettings['labels']) ?? {}, messages: (r.messages as ResultSettings['messages']) ?? {},
    includeEligibilityReason: r.include_eligibility_reason === true, feedbackEnabled: r.feedback_enabled === true, contestationsEnabled: r.contestations_enabled === true,
    contestationDays: Number(r.contestation_days ?? 10), retentionMonths: Number(r.retention_months ?? 24),
    nextStepsText: String(r.next_steps_text ?? ''), nextStepsDate: (r.next_steps_date as string | null) ?? null, shareGrade: r.share_grade === true,
  };
}

export async function saveSettings(admin: SupabaseClient, call: Call, raw: unknown, actor: string): Promise<Move> {
  const parsed = parseSettingsPatch(raw);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const state = await loadRoundState(admin, call);
  // What a publication goes out with is fixed once it is scheduled or done — the one exception is what comes AFTER the results (how long the data is kept, whether contestations are open: I3).
  const afterResults = Object.keys(parsed.patch).every((k) => k === 'retentionMonths' || k === 'contestationsEnabled' || k === 'contestationDays');
  if (state.locked && !afterResults) return { ok: false, status: 409, error: state.lockedReason ?? 'This cannot be changed now.' };
  const next: ResultSettings = { ...(await loadSettings(admin, call.id)), ...parsed.patch };
  const res = await admin.from('call_result_settings').upsert({
    call_id: call.id, labels: next.labels, messages: next.messages, include_eligibility_reason: next.includeEligibilityReason, feedback_enabled: next.feedbackEnabled,
    contestations_enabled: next.contestationsEnabled, contestation_days: next.contestationDays, retention_months: next.retentionMonths, next_steps_text: next.nextStepsText,
    next_steps_date: next.nextStepsDate, share_grade: next.shareGrade, updated_by: actor, updated_at: new Date().toISOString(),
  }, { onConflict: 'call_id' });
  if (res.error) return { ok: false, status: 500, error: 'The settings could not be saved. Please try again.' };
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'results_settings_changed', actor_user_id: actor, detail: { fields: Object.keys(parsed.patch) } });
  return { ok: true };
}

// --- The round: which phase, and whether it is already out ---------------------------------------------------------------------------------------------

const toBatch = (r: Row): BatchInfo => ({
  id: r.id as string, status: r.status as BatchInfo['status'], scheduledAt: (r.scheduled_at as string | null) ?? null, publishedAt: (r.published_at as string | null) ?? null,
  publishedBy: (r.published_by as string | null) ?? null, total: Number(r.total ?? 0), counts: (r.counts as BatchInfo['counts']) ?? {},
});

/** The batches of a call that count (scheduled, publishing, published), oldest first. A cancelled one does not exist any more. */
export async function liveBatches(admin: SupabaseClient, callId: string): Promise<(BatchInfo & { phaseId: string | null })[]> {
  const { data } = await admin.from('call_result_batches').select('*').eq('call_id', callId);
  return ((data ?? []) as Row[]).filter((b) => b.status !== 'cancelled').map((b) => ({ ...toBatch(b), phaseId: (b.phase_id as string | null) ?? null }))
    .sort((a, b) => (a.publishedAt ?? a.scheduledAt ?? '').localeCompare(b.publishedAt ?? b.scheduledAt ?? ''));
}

export interface RoundState {
  phases: CallPhase[]; round: ReturnType<typeof roundOf>; phase: CallPhase | null;
  /** The batch of the phase being prepared (scheduled or publishing), if any; a published phase is no longer the round. */
  batch: BatchInfo | null;
  locked: boolean; lockedReason: string | null;
}

/** The phase whose results are being prepared (the first not yet published), and whether what was prepared can still change. */
export async function loadRoundState(admin: SupabaseClient, call: Call): Promise<RoundState> {
  const phases = await loadPhases(admin, call.id);
  const batches = await liveBatches(admin, call.id);
  const published = batches.filter((b) => b.status === 'published').map((b) => b.phaseId ?? '');
  const round = roundOf(phases, published);
  const batch = batches.find((b) => b.phaseId === round.phaseId && (b.status === 'scheduled' || b.status === 'publishing')) ?? null;
  let lockedReason: string | null = null;
  if (round.allPublished) lockedReason = 'The results of every phase were published. What was sent cannot change.';
  else if (batch?.status === 'scheduled') lockedReason = 'The publication is scheduled. Cancel the schedule in Publish if you need to change anything.';
  else if (batch?.status === 'publishing') lockedReason = 'The results are being published right now.';
  return { phases, round, phase: phases.find((p) => p.id === round.phaseId) ?? null, batch, locked: lockedReason !== null, lockedReason };
}

/** Why an application's decision cannot change (null when it can): its result was already published, or the publication of its phase is scheduled or running. */
export async function decisionLock(admin: SupabaseClient, call: Call, applicationId: string): Promise<string | null> {
  const phases = await loadPhases(admin, call.id);
  const { data: app } = await admin.from('call_applications').select('current_phase_id').eq('id', applicationId).maybeSingle();
  const phaseId = (((app as Row | null)?.current_phase_id as string | null) ?? phases[0]?.id ?? null);
  const { data: res } = await admin.from('call_results').select('id, phase_id, is_current').eq('application_id', applicationId);
  if (((res ?? []) as Row[]).some((r) => r.is_current === true && ((r.phase_id as string | null) ?? null) === phaseId)) return 'The result of this application was already published, so its decision is fixed. Only an accepted contestation can change it.';
  const live = (await liveBatches(admin, call.id)).find((b) => b.phaseId === phaseId && (b.status === 'scheduled' || b.status === 'publishing'));
  if (live) return 'The results of this phase are scheduled or being published: decisions are fixed until the schedule is cancelled.';
  return null;
}

// --- The facts ------------------------------------------------------------------------------------------------------------------------------------------

/** The facts of every submitted application that is in this round's phase. */
export async function loadFacts(admin: SupabaseClient, call: Call, phases: CallPhase[], phaseId: string | null): Promise<AppFacts[]> {
  const { data: apps } = await admin.from('call_applications').select('id, reference, startup_org_id, applicant_user_id, current_phase_id').eq('call_id', call.id).eq('status', 'submitted');
  const first = phases[0]?.id ?? null;
  const rows = ((apps ?? []) as Row[]).filter((a) => phaseId === null || ((a.current_phase_id as string | null) ?? first) === phaseId);
  if (rows.length === 0) return [];
  const [decRes, eligRes, fbRes, gradeRes] = await Promise.all([
    admin.from('call_eval_decisions').select('application_id, decision').eq('call_id', call.id).eq('is_current', true),
    admin.from('call_application_eligibility').select('application_id, status, reason').eq('call_id', call.id).eq('is_current', true),
    admin.from('call_result_feedback').select('application_id, body, phase_id').eq('call_id', call.id),
    admin.from('call_result_grades').select('application_id, grade, phase_id').eq('call_id', call.id),
  ]);
  const decisions = new Map(((decRes.data ?? []) as Row[]).map((d) => [d.application_id as string, d.decision as Decision]));
  const elig = new Map(((eligRes.data ?? []) as Row[]).map((e) => [e.application_id as string, e]));
  const inPhase = (r: Row) => ((r.phase_id as string | null) ?? null) === phaseId;
  const feedback = new Map(((fbRes.data ?? []) as Row[]).filter(inPhase).map((f) => [f.application_id as string, String(f.body ?? '')]));
  const grades = new Map(((gradeRes.data ?? []) as Row[]).filter(inPhase).map((g) => [g.application_id as string, Number(g.grade)]));
  const orgIds = [...new Set(rows.map((r) => r.startup_org_id as string | null).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (orgIds.length) { const { data: orgs } = await admin.from('orgs').select('id, name').in('id', orgIds); for (const o of (orgs ?? []) as Row[]) names.set(o.id as string, String(o.name ?? '')); }
  return rows.map((r) => {
    const e = elig.get(r.id as string);
    return {
      applicationId: r.id as string, reference: (r.reference as string | null) ?? null, startupName: r.startup_org_id ? names.get(r.startup_org_id as string) ?? null : null, applicantUserId: r.applicant_user_id as string,
      decision: decisions.get(r.id as string) ?? null, eligibility: (e?.status as AppFacts['eligibility']) ?? null, eligibilityReason: (e?.reason as string | null) ?? null,
      feedback: feedback.get(r.id as string) ?? null, grade: grades.get(r.id as string) ?? null,
    };
  }).sort((a, b) => ((a.reference ?? a.applicationId) < (b.reference ?? b.applicationId) ? -1 : 1));
}

/** The name the applicant is addressed by: their name in the startup's team, else the one on their account. Never an email address. */
export async function applicantNameOf(admin: SupabaseClient, userId: string, orgId: string | null): Promise<string> {
  if (orgId) {
    const { data } = await admin.from('org_members').select('full_name').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
    const n = ((data as Row | null)?.full_name as string | undefined)?.trim();
    if (n) return n;
  }
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
    const n = String(meta.full_name ?? meta.name ?? '').trim();
    if (n) return n;
  } catch { /* the name is a courtesy: the message still reads without it */ }
  return 'applicant';
}

export async function loadPrepare(admin: SupabaseClient, call: Call): Promise<PrepareView> {
  const settings = await loadSettings(admin, call.id);
  const state = await loadRoundState(admin, call);
  const { round, phase } = state;
  const facts = await loadFacts(admin, call, state.phases, round.phaseId);
  const summary = summarise(facts);
  const hasNext = round.hasNextPhase;
  const labels = Object.fromEntries(RESULT_KEYS.map((k) => [k, labelOf(k, settings, hasNext)])) as Record<ResultKey, string>;
  const messages = Object.fromEntries(RESULT_KEYS.map((k) => [k, messageOf(k, settings, call.contentLanguage, hasNext)])) as Record<ResultKey, string>;
  const defaults = {
    labels: Object.fromEntries(RESULT_KEYS.map((k) => [k, labelOf(k, { labels: {} }, hasNext)])) as Record<ResultKey, string>,
    messages: Object.fromEntries(RESULT_KEYS.map((k) => [k, defaultMessage(k, call.contentLanguage, hasNext)])) as Record<ResultKey, string>,
  };
  return {
    ok: true, settings, labels, messages, defaults, placeholders: PLACEHOLDERS, phase: { id: round.phaseId, name: phase?.name ?? null, hasNext },
    summary: { total: summary.total, counts: summary.counts, byEligibility: summary.byEligibility, pending: summary.pending.map((p) => ({ applicationId: p.applicationId, reference: p.reference, startupName: p.startupName })) },
    blockers: blockersOf({ summary, callStatus: call.status, alreadyPublished: round.allPublished, shareGrade: settings.shareGrade }),
    applications: facts.map((a) => {
      const o = outcomeOf(a);
      return { applicationId: a.applicationId, reference: a.reference, startupName: a.startupName, result: o.result, label: o.result ? labels[o.result] : null, source: o.source, feedback: a.feedback ?? '', grade: a.grade };
    }),
    callStatus: call.status, language: call.contentLanguage, timezone: call.timezone, locked: state.locked, lockedReason: state.lockedReason,
  };
}

/** Everything an administrator writes about one application of the round goes through here: it must be in this phase, and nothing may be locked. */
async function inRound(admin: SupabaseClient, call: Call, applicationId: string): Promise<{ ok: false; status: number; error: string } | { ok: true; state: RoundState; facts: AppFacts; phaseId: string | null }> {
  const state = await loadRoundState(admin, call);
  if (state.locked) return { ok: false, status: 409, error: state.lockedReason ?? 'This cannot be changed now.' };
  const facts = (await loadFacts(admin, call, state.phases, state.round.phaseId)).find((a) => a.applicationId === applicationId);
  if (!facts) return { ok: false, status: 404, error: 'That application is not in this phase of the call.' };
  return { ok: true, state, facts, phaseId: state.round.phaseId };
}

/** Writes, or removes (empty), the one row of `table` for this application and phase. */
async function putByPhase(admin: SupabaseClient, table: 'call_result_feedback' | 'call_result_grades', call: Call, applicationId: string, phaseId: string | null, fields: Row | null, actor: string): Promise<boolean> {
  const { data } = await admin.from(table).select('id, phase_id').eq('application_id', applicationId);
  const existing = ((data ?? []) as Row[]).find((f) => ((f.phase_id as string | null) ?? null) === phaseId)?.id as string | undefined;
  if (!fields) { if (existing) await admin.from(table).delete().eq('id', existing); return true; }
  const res = existing
    ? await admin.from(table).update({ ...fields, updated_at: new Date().toISOString() }).eq('id', existing)
    : await admin.from(table).insert({ call_id: call.id, application_id: applicationId, phase_id: phaseId, ...fields });
  void actor;
  return !res.error;
}

/** The feedback an administrator writes for one application of this round (empty clears it). Off unless the call turned feedback on. Never read from, or written with, an evaluation. */
export async function setFeedback(admin: SupabaseClient, call: Call, applicationId: string, raw: unknown, actor: string): Promise<Move> {
  const settings = await loadSettings(admin, call.id);
  if (!settings.feedbackEnabled) return { ok: false, status: 409, error: 'Feedback to applicants is switched off for this call.' };
  const clean = cleanFeedback(raw);
  if (!clean.ok) return { ok: false, status: 400, error: clean.error };
  const where = await inRound(admin, call, applicationId);
  if (!where.ok) return where;
  const ok = await putByPhase(admin, 'call_result_feedback', call, applicationId, where.phaseId, clean.text ? { body: clean.text, updated_by: actor } : null, actor);
  if (!ok) return { ok: false, status: 500, error: 'The feedback could not be saved. Please try again.' };
  await admin.from('call_events').insert({ call_id: call.id, application_id: applicationId, event: 'result_feedback_set', actor_user_id: actor, detail: { cleared: !clean.text } });
  return { ok: true };
}

/**
 * The grade an administrator VALIDATES for one application (0–100 %). It exists only when the call shares grades, only for an application that was evaluated (its result comes from a decision), and is
 * never computed: the average of the evaluations is shown to administrators on the board and is never the thing that goes out.
 */
export async function setGrade(admin: SupabaseClient, call: Call, applicationId: string, raw: unknown, actor: string): Promise<Move> {
  const settings = await loadSettings(admin, call.id);
  if (!settings.shareGrade) return { ok: false, status: 409, error: 'Sharing the grade with the applicants is switched off for this call.' };
  const clean = cleanGrade(raw);
  if (!clean.ok) return { ok: false, status: 400, error: clean.error };
  const where = await inRound(admin, call, applicationId);
  if (!where.ok) return where;
  if (outcomeOf(where.facts).source !== 'decision') return { ok: false, status: 409, error: 'This application has no decision of its own (it was not evaluated), so there is no grade to validate.' };
  const ok = await putByPhase(admin, 'call_result_grades', call, applicationId, where.phaseId, clean.grade === null ? null : { grade: clean.grade, set_by: actor }, actor);
  if (!ok) return { ok: false, status: 500, error: 'The grade could not be saved. Please try again.' };
  await admin.from('call_events').insert({ call_id: call.id, application_id: applicationId, event: 'result_grade_set', actor_user_id: actor, detail: { grade: clean.grade } });
  return { ok: true };
}

/** What one real application would be told, with the settings as they are NOW (nothing is sent). */
export async function previewFor(admin: SupabaseClient, call: Call, applicationId: string): Promise<Move<{ message: BuiltMessage }>> {
  const settings = await loadSettings(admin, call.id);
  const state = await loadRoundState(admin, call);
  const facts = await loadFacts(admin, call, state.phases, state.round.phaseId);
  const app = facts.find((a) => a.applicationId === applicationId);
  if (!app) return { ok: false, status: 404, error: 'That application is not in this phase of the call.' };
  const { data: row } = await admin.from('call_applications').select('startup_org_id').eq('id', applicationId).maybeSingle();
  const message = buildMessage({
    settings, call, entityName: await promoterName(admin, call.promoterKind, call.promoterId), app, applicantName: await applicantNameOf(admin, app.applicantUserId, ((row as Row | null)?.startup_org_id as string | null) ?? null),
    hasNextPhase: state.round.hasNextPhase, formatDay: (iso) => formatDayInZone(`${iso}T12:00:00Z`, call.timezone),
  });
  if (!message) return { ok: false, status: 409, error: 'This application has no decision yet, so there is no message to preview.' };
  return { ok: true, message };
}
