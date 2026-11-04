import 'server-only';
// Prompt 925 — the selection of a call on the database: the rules (versioned), each calculation of the proposal (kept, with who did it and when), applying it to the decisions, and the people's order for ties. The
// calculation itself is `selection.ts` (pure); this file reads what it needs and writes what it produced. Who may do what is decided by the routes from the call's permissions. Nothing here tells an applicant anything.
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBoard, type Board } from './eval-board-store';
import { resultsPublished } from './eval-grid-store';
import { loadFields } from './store';
import { decisionLock } from './results-store';
import { DEFAULT_RULES, propose, type Candidate, type Item, type Proposal, type SelectionRules } from './selection';
import type { AnswerValue, Call, FormField } from './types';

type Row = Record<string, unknown>;
const OUTCOME_DECISION: Record<string, 'advance' | 'waitlist' | 'reject' | null> = { selected: 'advance', waitlist: 'waitlist', reject: 'reject', not_considered: null };

// --- the rules ------------------------------------------------------------------------------------------------------------------------------------------------

export interface StoredRules { version: number; rules: SelectionRules; manualOrder: string[]; exists: boolean }

export async function loadRules(admin: SupabaseClient, callId: string): Promise<StoredRules> {
  const { data } = await admin.from('call_selection_rules').select('version, rules, manual_order').eq('call_id', callId).eq('is_current', true).maybeSingle();
  const r = data as Row | null;
  if (!r) return { version: 0, rules: { ...DEFAULT_RULES }, manualOrder: [], exists: false };
  return { version: Number(r.version), rules: { ...DEFAULT_RULES, ...(r.rules as Partial<SelectionRules>) }, manualOrder: Array.isArray(r.manual_order) ? (r.manual_order as string[]) : [], exists: true };
}

/** A change of the rules makes a NEW version (the old ones stay); the people's order for ties is kept (it is a decision, not a rule). Returns null when someone saved since `baseVersion`. */
export async function saveRules(admin: SupabaseClient, call: Call, rules: SelectionRules, baseVersion: number, actor: string): Promise<StoredRules | null> {
  const cur = await loadRules(admin, call.id);
  if (cur.version !== baseVersion) return null;
  if (cur.exists && JSON.stringify(cur.rules) === JSON.stringify(rules)) return cur;                  // the same rules again change nothing
  if (cur.exists) await admin.from('call_selection_rules').update({ is_current: false }).eq('call_id', call.id).eq('is_current', true);
  const version = cur.version + 1;
  const ins = await admin.from('call_selection_rules').insert({ call_id: call.id, version, rules, manual_order: cur.manualOrder, is_current: true, created_by: actor });
  if (ins.error) return null;
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'selection_rules_changed', actor_user_id: actor, detail: { version, before: cur.exists ? cur.rules : null, after: rules } });
  return { version, rules, manualOrder: cur.manualOrder, exists: true };
}

export async function setManualOrder(admin: SupabaseClient, call: Call, order: string[], actor: string): Promise<boolean> {
  const cur = await loadRules(admin, call.id);
  if (!cur.exists) return false;
  const upd = await admin.from('call_selection_rules').update({ manual_order: order }).eq('call_id', call.id).eq('is_current', true);
  if (upd.error) return false;
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'selection_tie_decided', actor_user_id: actor, detail: { order } });
  return true;
}

// --- the inputs of a calculation --------------------------------------------------------------------------------------------------------------------------------

async function loadAnswers(admin: SupabaseClient, callId: string): Promise<Map<string, Record<string, AnswerValue>>> {
  const { data: apps } = await admin.from('call_applications').select('id, current_submission_id').eq('call_id', callId).eq('status', 'submitted');
  const rows = (apps ?? []) as Row[];
  const subIds = rows.map((a) => a.current_submission_id as string | null).filter((x): x is string => !!x);
  const bySub = new Map<string, Record<string, AnswerValue>>();
  if (subIds.length) {
    const { data: subs } = await admin.from('call_application_submissions').select('id, answers').in('id', subIds);
    for (const s of (subs ?? []) as Row[]) bySub.set(s.id as string, (s.answers as Record<string, AnswerValue>) ?? {});
  }
  return new Map(rows.map((a) => [a.id as string, bySub.get(a.current_submission_id as string) ?? {}]));
}

export interface Inputs { board: Board; candidates: Candidate[]; fields: FormField[]; hash: string }

export async function gatherInputs(admin: SupabaseClient, call: Call, stored: StoredRules): Promise<Inputs> {
  const [board, fields, answers] = await Promise.all([loadBoard(admin, call), loadFields(admin, call.id), loadAnswers(admin, call.id)]);
  const candidates: Candidate[] = board.rows.map((r) => ({
    applicationId: r.applicationId, reference: r.reference, startupName: r.startupName,
    position: r.average,                                                                           // provisional while evaluations are missing: the screen says so
    perCriterion: Object.fromEntries(r.perCriterion.map((p) => [p.criterionId, p.average])), answers: answers.get(r.applicationId) ?? {},
  }));
  const hash = createHash('sha256').update(JSON.stringify([stored.version, stored.manualOrder, candidates.map((c) => [c.applicationId, c.position, c.perCriterion, c.answers]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))])).digest('hex').slice(0, 32);
  return { board, candidates, fields, hash };
}

export const computeProposal = (inp: Inputs, stored: StoredRules): Proposal => propose({ rules: stored.rules, criteria: inp.board.criteria, scoring: inp.board.scoring, candidates: inp.candidates, manualOrder: stored.manualOrder });

/** After the results are published the selection is fixed: no new calculation, no applying. */
export const selectionLocked = (admin: SupabaseClient, callId: string): Promise<boolean> => resultsPublished(admin, callId);

// --- runs -------------------------------------------------------------------------------------------------------------------------------------------------------

export interface RunView {
  id: string; rulesVersion: number; createdAt: string; createdBy: string; appliedAt: string | null; appliedBy: string | null;
  summary: Proposal['summary']; items: (Item & { reference: string | null; startupName: string | null })[];
  /** The rules or the evaluations changed since this calculation. */
  stale: boolean;
  /** How many decisions today differ from what this proposal says (people changed them, or nobody applied it yet). */
  differing: number;
  /** Evaluations still missing when it was calculated (a proposal may change). */
  missingEvaluations: number;
}

export async function latestRun(admin: SupabaseClient, call: Call, stored: StoredRules, inputs: Inputs): Promise<RunView | null> {
  const { data } = await admin.from('call_selection_runs').select('*').eq('call_id', call.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const run = data as Row | null;
  if (!run) return null;
  const { data: itemRows } = await admin.from('call_selection_items').select('*').eq('run_id', run.id as string);
  const by = new Map(inputs.board.rows.map((r) => [r.applicationId, r]));
  const items = ((itemRows ?? []) as Row[]).map((i) => ({
    applicationId: i.application_id as string, rank: i.position === null || i.position === undefined ? null : Number(i.position), outcome: i.outcome as Item['outcome'], explanation: (i.explanation as string) ?? '',
    quotaIds: Array.isArray(i.quota_ids) ? (i.quota_ids as string[]) : [], amount: i.amount === null || i.amount === undefined ? null : Number(i.amount), tie: i.tie === true, budgetSkipped: i.budget_skipped === true,
    reference: by.get(i.application_id as string)?.reference ?? null, startupName: by.get(i.application_id as string)?.startupName ?? null,
  })).sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  const differing = items.filter((i) => { const want = OUTCOME_DECISION[i.outcome]; const have = by.get(i.applicationId)?.decision?.decision ?? null; return want !== null && want !== have; }).length;
  return {
    id: run.id as string, rulesVersion: Number(run.rules_version), createdAt: run.created_at as string, createdBy: run.created_by as string, appliedAt: (run.applied_at as string | null) ?? null, appliedBy: (run.applied_by as string | null) ?? null,
    summary: run.summary as Proposal['summary'], items, stale: run.input_hash !== inputs.hash, differing, missingEvaluations: Number((run.summary as { missingEvaluations?: number })?.missingEvaluations ?? 0),
  };
}

export async function createRun(admin: SupabaseClient, call: Call, stored: StoredRules, inputs: Inputs, actor: string): Promise<{ run: string; proposal: Proposal }> {
  const proposal = computeProposal(inputs, stored);
  const missing = inputs.board.rows.filter((r) => r.state !== 'complete').length;
  const ins = await admin.from('call_selection_runs').insert({ call_id: call.id, rules_version: stored.version, created_by: actor, summary: { ...proposal.summary, missingEvaluations: missing }, input_hash: inputs.hash }).select('id').single();
  if (ins.error || !ins.data) throw new Error('The proposal could not be saved.');
  const runId = (ins.data as Row).id as string;
  if (proposal.items.length) {
    const rows = proposal.items.map((i) => ({ run_id: runId, application_id: i.applicationId, position: i.rank, outcome: i.outcome, explanation: i.explanation, quota_ids: i.quotaIds, amount: i.amount, tie: i.tie, budget_skipped: i.budgetSkipped }));
    const items = await admin.from('call_selection_items').insert(rows);
    if (items.error) throw new Error('The proposal could not be saved.');
  }
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'selection_proposed', actor_user_id: actor, detail: { run: runId, rulesVersion: stored.version, ...proposal.summary, missingEvaluations: missing } });
  return { run: runId, proposal };
}

export type ApplyResult = { ok: true; written: number; keptManual: number; locked: number; unchanged: number } | { ok: false; status: number; error: string };

/**
 * "Apply proposal": fills the decisions of Stage 3 (Advance / Waitlist / Reject) with origin "proposal". A decision a PERSON made is never overwritten (it stays, and shows where it differs); one that is fixed because
 * its result was published is skipped; a tie nobody decided blocks the whole thing.
 */
export async function applyRun(admin: SupabaseClient, call: Call, runId: string, actor: string): Promise<ApplyResult> {
  const { data: run } = await admin.from('call_selection_runs').select('id, summary').eq('id', runId).eq('call_id', call.id).maybeSingle();
  if (!run) return { ok: false, status: 404, error: 'That proposal does not exist.' };
  const ties = ((run as Row).summary as { ties?: string[] } | null)?.ties ?? [];
  if (ties.length > 0) return { ok: false, status: 409, error: `${ties.length} application${ties.length === 1 ? ' is' : 's are'} tied and someone must decide the order first (“Tie — decide”).` };
  const { data: itemRows } = await admin.from('call_selection_items').select('application_id, outcome').eq('run_id', runId);
  const { data: curRows } = await admin.from('call_eval_decisions').select('id, application_id, decision, origin').eq('call_id', call.id).eq('is_current', true);
  const cur = new Map(((curRows ?? []) as Row[]).map((d) => [d.application_id as string, d]));
  let written = 0; let keptManual = 0; let locked = 0; let unchanged = 0;
  for (const it of (itemRows ?? []) as Row[]) {
    const decision = OUTCOME_DECISION[it.outcome as string]; const appId = it.application_id as string;
    if (!decision) continue;
    const prev = cur.get(appId);
    if (prev && prev.origin === 'manual') { keptManual++; continue; }
    if (prev && prev.decision === decision) { unchanged++; continue; }
    if (await decisionLock(admin, call, appId)) { locked++; continue; }
    if (prev) await admin.from('call_eval_decisions').update({ is_current: false }).eq('id', prev.id as string);
    const ins = await admin.from('call_eval_decisions').insert({ call_id: call.id, application_id: appId, decision, note: null, decided_by: actor, is_current: true, origin: 'proposal', proposal_run_id: runId });
    if (ins.error) return { ok: false, status: 500, error: 'The decisions could not be saved. Please try again.' };
    written++;
    await admin.from('call_events').insert({ call_id: call.id, application_id: appId, event: 'eval_decision', actor_user_id: actor, detail: { before: prev ? { decision: prev.decision } : null, after: { decision }, origin: 'proposal', run: runId } });
  }
  await admin.from('call_selection_runs').update({ applied_at: new Date().toISOString(), applied_by: actor }).eq('id', runId);
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'selection_applied', actor_user_id: actor, detail: { run: runId, written, keptManual, locked, unchanged } });
  return { ok: true, written, keptManual, locked, unchanged };
}

/** What the latest APPLIED proposal says about one application, as a decision — so that changing it by hand asks for a reason. */
export async function appliedProposalFor(admin: SupabaseClient, callId: string, applicationId: string): Promise<'advance' | 'waitlist' | 'reject' | null> {
  const { data: runs } = await admin.from('call_selection_runs').select('id, applied_at').eq('call_id', callId);
  const run = ((runs ?? []) as Row[]).filter((r) => r.applied_at).sort((a, b) => String(b.applied_at).localeCompare(String(a.applied_at)))[0];
  if (!run) return null;
  const { data: it } = await admin.from('call_selection_items').select('outcome').eq('run_id', run.id as string).eq('application_id', applicationId).maybeSingle();
  return it ? OUTCOME_DECISION[(it as Row).outcome as string] ?? null : null;
}

/** For the exports: each application's latest proposal and where its decision came from. */
export async function exportColumns(admin: SupabaseClient, callId: string): Promise<Map<string, { proposal: string; explanation: string; rank: number | null; origin: string | null }>> {
  const out = new Map<string, { proposal: string; explanation: string; rank: number | null; origin: string | null }>();
  const { data: run } = await admin.from('call_selection_runs').select('id').eq('call_id', callId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!run) return out;
  const [{ data: items }, { data: decs }] = await Promise.all([
    admin.from('call_selection_items').select('application_id, outcome, explanation, position').eq('run_id', (run as Row).id as string),
    admin.from('call_eval_decisions').select('application_id, origin').eq('call_id', callId).eq('is_current', true),
  ]);
  const origin = new Map(((decs ?? []) as Row[]).map((d) => [d.application_id as string, (d.origin as string) ?? 'manual']));
  for (const i of (items ?? []) as Row[]) out.set(i.application_id as string, { proposal: OUTCOME_DECISION[i.outcome as string] ?? '', explanation: (i.explanation as string) ?? '', rank: i.position === null || i.position === undefined ? null : Number(i.position), origin: origin.get(i.application_id as string) ?? null });
  return out;
}

