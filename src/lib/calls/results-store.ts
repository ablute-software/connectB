// Prompt 924 (Etapa 4, I1) — the results against the database: the settings of a call's results, the facts every application's result is decided from (the decision on the evaluation board and the eligibility —
// NEVER an evaluator's comments or scores), the feedback an administrator writes for an application, and the preview of what one applicant would be told. Who may read or write is decided by the routes
// ("Publish results"); nothing here sends anything — publishing is the next increment.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDayInZone } from './tz';
import { loadPhases, promoterName } from './store';
import {
  DEFAULT_SETTINGS, PLACEHOLDERS, RESULT_KEYS, blockersOf, buildMessage, cleanFeedback, defaultMessage, labelOf, messageOf, outcomeOf, parseSettingsPatch, roundOf, summarise,
  type AppFacts, type BuiltMessage, type PrepareView, type ResultKey, type ResultSettings,
} from './results';
import type { Decision } from './eval-board';
import type { Call, CallPhase } from './types';

type Row = Record<string, unknown>;

/** Until the migration is applied the tab says "not available yet" instead of showing a raw database error (the same switch the evaluation uses). */
export async function resultsReady(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from('call_result_settings').select('call_id').limit(1);
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
    nextStepsText: String(r.next_steps_text ?? ''), nextStepsDate: (r.next_steps_date as string | null) ?? null,
  };
}

export type Move<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export async function saveSettings(admin: SupabaseClient, call: Call, raw: unknown, actor: string): Promise<Move> {
  const parsed = parseSettingsPatch(raw);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const next: ResultSettings = { ...(await loadSettings(admin, call.id)), ...parsed.patch };
  const res = await admin.from('call_result_settings').upsert({
    call_id: call.id, labels: next.labels, messages: next.messages, include_eligibility_reason: next.includeEligibilityReason, feedback_enabled: next.feedbackEnabled,
    contestations_enabled: next.contestationsEnabled, contestation_days: next.contestationDays, retention_months: next.retentionMonths, next_steps_text: next.nextStepsText,
    next_steps_date: next.nextStepsDate, updated_by: actor, updated_at: new Date().toISOString(),
  }, { onConflict: 'call_id' });
  if (res.error) return { ok: false, status: 500, error: 'The settings could not be saved. Please try again.' };
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'results_settings_changed', actor_user_id: actor, detail: { fields: Object.keys(parsed.patch) } });
  return { ok: true };
}

/** The phase whose results are being prepared, and whether another one follows. `publishedPhaseIds` are the phases whose results already went out (none before publishing exists). */
export async function loadRound(admin: SupabaseClient, call: Call, publishedPhaseIds: string[] = []): Promise<{ phases: CallPhase[]; round: ReturnType<typeof roundOf>; phase: CallPhase | null }> {
  const phases = await loadPhases(admin, call.id);
  const round = roundOf(phases, publishedPhaseIds);
  return { phases, round, phase: phases.find((p) => p.id === round.phaseId) ?? null };
}

/** The facts of every submitted application that is in this round's phase. */
export async function loadFacts(admin: SupabaseClient, call: Call, phases: CallPhase[], phaseId: string | null): Promise<AppFacts[]> {
  const { data: apps } = await admin.from('call_applications').select('id, reference, startup_org_id, applicant_user_id, current_phase_id').eq('call_id', call.id).eq('status', 'submitted');
  const first = phases[0]?.id ?? null;
  const rows = ((apps ?? []) as Row[]).filter((a) => phaseId === null || ((a.current_phase_id as string | null) ?? first) === phaseId);
  if (rows.length === 0) return [];
  const [decRes, eligRes, fbRes] = await Promise.all([
    admin.from('call_eval_decisions').select('application_id, decision').eq('call_id', call.id).eq('is_current', true),
    admin.from('call_application_eligibility').select('application_id, status, reason').eq('call_id', call.id).eq('is_current', true),
    admin.from('call_result_feedback').select('application_id, body, phase_id').eq('call_id', call.id),
  ]);
  const decisions = new Map(((decRes.data ?? []) as Row[]).map((d) => [d.application_id as string, d.decision as Decision]));
  const elig = new Map(((eligRes.data ?? []) as Row[]).map((e) => [e.application_id as string, e]));
  const feedback = new Map(((fbRes.data ?? []) as Row[]).filter((f) => ((f.phase_id as string | null) ?? null) === phaseId).map((f) => [f.application_id as string, String(f.body ?? '')]));
  const orgIds = [...new Set(rows.map((r) => r.startup_org_id as string | null).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (orgIds.length) { const { data: orgs } = await admin.from('orgs').select('id, name').in('id', orgIds); for (const o of (orgs ?? []) as Row[]) names.set(o.id as string, String(o.name ?? '')); }
  return rows.map((r) => {
    const e = elig.get(r.id as string);
    return {
      applicationId: r.id as string, reference: (r.reference as string | null) ?? null, startupName: r.startup_org_id ? names.get(r.startup_org_id as string) ?? null : null, applicantUserId: r.applicant_user_id as string,
      decision: decisions.get(r.id as string) ?? null, eligibility: (e?.status as AppFacts['eligibility']) ?? null, eligibilityReason: (e?.reason as string | null) ?? null, feedback: feedback.get(r.id as string) ?? null,
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

export async function loadPrepare(admin: SupabaseClient, call: Call, publishedPhaseIds: string[] = []): Promise<PrepareView> {
  const settings = await loadSettings(admin, call.id);
  const { phases, round, phase } = await loadRound(admin, call, publishedPhaseIds);
  const facts = await loadFacts(admin, call, phases, round.phaseId);
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
    blockers: blockersOf({ summary, callStatus: call.status, alreadyPublished: round.allPublished }),
    applications: facts.map((a) => { const o = outcomeOf(a); return { applicationId: a.applicationId, reference: a.reference, startupName: a.startupName, result: o.result, label: o.result ? labels[o.result] : null, source: o.source, feedback: a.feedback ?? '' }; }),
    callStatus: call.status, language: call.contentLanguage, timezone: call.timezone,
  };
}

/** The feedback an administrator writes for one application of this round (empty clears it). Off unless the call turned feedback on. Never read from, or written with, an evaluation. */
export async function setFeedback(admin: SupabaseClient, call: Call, applicationId: string, raw: unknown, actor: string, publishedPhaseIds: string[] = []): Promise<Move> {
  const settings = await loadSettings(admin, call.id);
  if (!settings.feedbackEnabled) return { ok: false, status: 409, error: 'Feedback to applicants is switched off for this call.' };
  const clean = cleanFeedback(raw);
  if (!clean.ok) return { ok: false, status: 400, error: clean.error };
  const { phases, round } = await loadRound(admin, call, publishedPhaseIds);
  if (round.allPublished) return { ok: false, status: 409, error: 'The results of this phase were already published: what was sent cannot change.' };
  const facts = await loadFacts(admin, call, phases, round.phaseId);
  if (!facts.some((a) => a.applicationId === applicationId)) return { ok: false, status: 404, error: 'That application is not in this phase of the call.' };
  const phaseId = round.phaseId;
  const same = await admin.from('call_result_feedback').select('id, phase_id').eq('application_id', applicationId);
  const existing = ((same.data ?? []) as Row[]).find((f) => ((f.phase_id as string | null) ?? null) === phaseId)?.id as string | undefined;
  if (!clean.text) {
    if (existing) await admin.from('call_result_feedback').delete().eq('id', existing);
  } else if (existing) {
    const upd = await admin.from('call_result_feedback').update({ body: clean.text, updated_by: actor, updated_at: new Date().toISOString() }).eq('id', existing);
    if (upd.error) return { ok: false, status: 500, error: 'The feedback could not be saved. Please try again.' };
  } else {
    const ins = await admin.from('call_result_feedback').insert({ call_id: call.id, application_id: applicationId, phase_id: phaseId, body: clean.text, updated_by: actor });
    if (ins.error) return { ok: false, status: 500, error: 'The feedback could not be saved. Please try again.' };
  }
  await admin.from('call_events').insert({ call_id: call.id, application_id: applicationId, event: 'result_feedback_set', actor_user_id: actor, detail: { cleared: !clean.text } });
  return { ok: true };
}

/** What one real application would be told, with the settings as they are NOW (nothing is sent). */
export async function previewFor(admin: SupabaseClient, call: Call, applicationId: string, publishedPhaseIds: string[] = []): Promise<Move<{ message: BuiltMessage }> | { ok: false; status: number; error: string }> {
  const settings = await loadSettings(admin, call.id);
  const { phases, round } = await loadRound(admin, call, publishedPhaseIds);
  const facts = await loadFacts(admin, call, phases, round.phaseId);
  const app = facts.find((a) => a.applicationId === applicationId);
  if (!app) return { ok: false, status: 404, error: 'That application is not in this phase of the call.' };
  const { data: row } = await admin.from('call_applications').select('startup_org_id').eq('id', applicationId).maybeSingle();
  const message = buildMessage({
    settings, call, entityName: await promoterName(admin, call.promoterKind, call.promoterId), app, applicantName: await applicantNameOf(admin, app.applicantUserId, ((row as Row | null)?.startup_org_id as string | null) ?? null),
    hasNextPhase: round.hasNextPhase, formatDay: (iso) => formatDayInZone(`${iso}T12:00:00Z`, call.timezone),
  });
  if (!message) return { ok: false, status: 409, error: 'This application has no decision yet, so there is no message to preview.' };
  return { ok: true, message };
}
