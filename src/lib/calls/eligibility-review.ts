// Prompt 918 (I3) — what a person does with an automatic result (spec §7.6): correct what the engine said about one rule (and the platform recomputes the rest: the application does not become a Fit while
// another rule fails), reclassify the whole application, or flag it for validation. EVERY correction is kept as an example for measuring the engine — the rule, what it said and why, what the person decided,
// who, why, when, and whether it is an exception of this call or a recognition error. Nothing here crosses to another call. Server only.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RECLASSIFIED_BY_A_PERSON, type Outcome } from './eligibility';
import { aggregate, saveEvaluation, type EligibilityStatus, type Evaluation, type RuleResultRecord } from './eligibility-engine';
import { loadRecipes } from './eligibility-store';
import type { Call } from './types';

type Row = Record<string, unknown>;

export interface CurrentEligibility {
  id: string; applicationId: string; submissionId: string; rulesVersion: number; status: EligibilityStatus; source: 'engine' | 'human' | 'flag';
  ruleResults: RuleResultRecord[]; overrides: Record<string, { outcome?: Outcome; status?: EligibilityStatus; by: string; why: string; at: string }>; reason: string; createdAt: string;
}

const toCurrent = (r: Row): CurrentEligibility => ({
  id: r.id as string, applicationId: r.application_id as string, submissionId: r.submission_id as string, rulesVersion: Number(r.rules_version), status: r.status as EligibilityStatus,
  source: r.source as CurrentEligibility['source'], ruleResults: (Array.isArray(r.rule_results) ? r.rule_results : []) as RuleResultRecord[],
  overrides: ((r.overrides && typeof r.overrides === 'object' ? r.overrides : {}) as CurrentEligibility['overrides']), reason: (r.reason as string) ?? '', createdAt: (r.created_at as string) ?? '',
});

export async function loadCurrent(admin: SupabaseClient, applicationId: string): Promise<CurrentEligibility | null> {
  const { data } = await admin.from('call_application_eligibility').select('*').eq('application_id', applicationId).eq('is_current', true).maybeSingle();
  return data ? toCurrent(data as Row) : null;
}

/** The verdict of each rule with what a person decided on top, and the application's own status after any reclassification. */
export function effective(cur: CurrentEligibility): { status: EligibilityStatus; reason: string } {
  const ov = Object.fromEntries(Object.entries(cur.overrides).filter(([k, v]) => k !== '_application' && v.outcome).map(([k, v]) => [k, { outcome: v.outcome as Outcome, why: v.why }]));
  const computed = aggregate(cur.ruleResults, ov);
  const app = cur.overrides._application;
  return app?.status ? { status: app.status, reason: `${RECLASSIFIED_BY_A_PERSON}${app.why}` } : computed;
}

export type ReviewResult = { ok: true; status: EligibilityStatus; reason: string } | { ok: false; error: string; code: 'not_ready' | 'unknown_rule' | 'bad_request' };

async function addExample(admin: SupabaseClient, call: Call, cur: CurrentEligibility, ex: {
  ruleId: string | null; humanOutcome: string; author: string; justification: string; callException: boolean;
}): Promise<void> {
  const result = ex.ruleId ? cur.ruleResults.find((r) => r.ruleId === ex.ruleId) : null;
  let docType: string | null = null;
  if (ex.ruleId) docType = (await loadRecipes(admin, call.id, cur.rulesVersion)).find((r) => r.ruleId === ex.ruleId)?.recipe.docType ?? null;
  await admin.from('call_eligibility_corrections').insert({
    call_id: call.id, application_id: cur.applicationId, submission_id: cur.submissionId, rule_id: ex.ruleId, rule_kind: result?.kind ?? null, doc_type: docType, rules_version: cur.rulesVersion,
    engine_status: cur.status, engine_outcome: result?.outcome ?? null, engine_reason: result?.reason ?? cur.reason, engine_evidence: result?.evidence ?? null,
    human_outcome: ex.humanOutcome, author_user_id: ex.author, justification: ex.justification, is_call_exception: ex.callException,
  });
}

const evaluationOf = (cur: CurrentEligibility, status: EligibilityStatus, reason: string): Evaluation => ({ status, reason, results: cur.ruleResults });

/** "Correct eligibility & document validity": the person decides ONE rule; the platform recomputes the application with the others as they were. */
export async function correctRule(admin: SupabaseClient, call: Call, applicationId: string, input: { ruleId: string; outcome: 'pass' | 'fail'; justification: string; actor: string; callException?: boolean }): Promise<ReviewResult> {
  const justification = input.justification.trim();
  if (!justification) return { ok: false, code: 'bad_request', error: 'Say why: a correction always has a reason.' };
  const cur = await loadCurrent(admin, applicationId);
  if (!cur) return { ok: false, code: 'not_ready', error: 'This application has not been evaluated yet.' };
  if (!cur.ruleResults.some((r) => r.ruleId === input.ruleId)) return { ok: false, code: 'unknown_rule', error: 'That rule is not part of this application’s evaluation.' };
  const overrides = { ...cur.overrides, [input.ruleId]: { outcome: input.outcome as Outcome, by: input.actor, why: justification, at: new Date().toISOString() } };
  const next = effective({ ...cur, overrides });
  await saveEvaluation(admin, { call, applicationId, submissionId: cur.submissionId, rulesVersion: cur.rulesVersion, evaluation: evaluationOf(cur, next.status, next.reason), source: 'human', overrides, actor: input.actor });
  await addExample(admin, call, cur, { ruleId: input.ruleId, humanOutcome: input.outcome, author: input.actor, justification, callException: input.callException === true });
  return { ok: true, ...next };
}

/** Reclassify the whole application (Fit ↔ Not a fit, or resolve a To validate), always with a reason. */
export async function reclassify(admin: SupabaseClient, call: Call, applicationId: string, input: { status: 'fit' | 'not_fit'; justification: string; actor: string; callException?: boolean }): Promise<ReviewResult> {
  const justification = input.justification.trim();
  if (!justification) return { ok: false, code: 'bad_request', error: 'Say why: a correction always has a reason.' };
  const cur = await loadCurrent(admin, applicationId);
  if (!cur) return { ok: false, code: 'not_ready', error: 'This application has not been evaluated yet.' };
  const overrides = { ...cur.overrides, _application: { status: input.status, by: input.actor, why: justification, at: new Date().toISOString() } };
  const next = effective({ ...cur, overrides });
  await saveEvaluation(admin, { call, applicationId, submissionId: cur.submissionId, rulesVersion: cur.rulesVersion, evaluation: evaluationOf(cur, next.status, next.reason), source: 'human', overrides, actor: input.actor });
  await addExample(admin, call, cur, { ruleId: null, humanOutcome: input.status, author: input.actor, justification, callException: input.callException === true });
  return { ok: true, ...next };
}

/** "Flag possible ineligibility": whoever may read the applications sends one to To validate with the reason. It does not exclude it and does not take it away from colleagues. */
export async function flagApplication(admin: SupabaseClient, call: Call, applicationId: string, input: { reason: string; actor: string }): Promise<ReviewResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, code: 'bad_request', error: 'Say what makes you think it may not be eligible.' };
  const cur = await loadCurrent(admin, applicationId);
  if (!cur) return { ok: false, code: 'not_ready', error: 'This application has not been evaluated yet.' };
  const text = `Flagged for validation: ${reason}`;
  await saveEvaluation(admin, { call, applicationId, submissionId: cur.submissionId, rulesVersion: cur.rulesVersion, evaluation: evaluationOf(cur, 'to_validate', text), source: 'flag', overrides: cur.overrides, actor: input.actor });
  await addExample(admin, call, cur, { ruleId: null, humanOutcome: 'to_validate', author: input.actor, justification: reason, callException: false });
  return { ok: true, status: 'to_validate', reason: text };
}

// --- How well the engine does (for the back office) ----------------------------------------------------------------------------------------------------

export interface AccuracyRow { key: string; label: string; decisions: number; corrected: number; accuracy: number | null }

/**
 * The hit rate by kind of rule and by kind of document, from the engine's own results and the corrections people made: an engine verdict counts as a hit unless a person decided the opposite on THAT rule
 * (an exception of one call is not an engine error and is left out). A correction on the whole application is counted separately.
 */
export function accuracy(results: { ruleKind: string; docType: string | null; outcome: Outcome }[], corrections: { ruleKind: string | null; docType: string | null; engineOutcome: string | null; humanOutcome: string; callException: boolean }[]): { byRule: AccuracyRow[]; byDocument: AccuracyRow[] } {
  const wrong = (c: { engineOutcome: string | null; humanOutcome: string }) => c.engineOutcome !== null && ((c.engineOutcome === 'pass' && c.humanOutcome === 'fail') || (c.engineOutcome === 'fail' && c.humanOutcome === 'pass') || (c.engineOutcome === 'validate' && (c.humanOutcome === 'pass' || c.humanOutcome === 'fail')));
  const rows = (keyOf: (r: { ruleKind: string; docType: string | null }) => string | null, labelOf: (k: string) => string): AccuracyRow[] => {
    const map = new Map<string, { decisions: number; corrected: number }>();
    for (const r of results) { const k = keyOf(r); if (k) { const x = map.get(k) ?? { decisions: 0, corrected: 0 }; x.decisions++; map.set(k, x); } }
    for (const c of corrections) {
      if (c.callException || !c.ruleKind || !wrong(c)) continue;
      const k = keyOf({ ruleKind: c.ruleKind, docType: c.docType }); if (!k) continue;
      const x = map.get(k) ?? { decisions: 0, corrected: 0 }; x.corrected++; map.set(k, x);
    }
    return [...map.entries()].map(([key, v]) => ({ key, label: labelOf(key), decisions: v.decisions, corrected: v.corrected, accuracy: v.decisions > 0 ? Math.round((1 - Math.min(v.corrected, v.decisions) / v.decisions) * 1000) / 10 : null })).sort((a, b) => b.decisions - a.decisions);
  };
  return { byRule: rows((r) => r.ruleKind, (k) => k), byDocument: rows((r) => r.docType, (k) => k) };
}
