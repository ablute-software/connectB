// Prompt 918 (I3) — the internal eligibility engine and its queue (spec §7, §16). Server only; nothing here calls an external AI. Each submission is evaluated against the rules of ITS call, in the version
// in force; the result is Fit / Not a fit / To validate with a plain-words reason and, for a document, the evidence (the quote and the page).
//
//   • A TECHNICAL failure (a stored file that cannot be read, a database error) is never an applicant's failure: the task goes back to the queue with a back-off, and after the last attempt it is shown as
//     "Technical failure" for a person to retry — no eligibility result is written.
//   • Failing needs a clear, objective reason; any doubt is To validate. A scanned PDF is never read (no OCR in v1): To validate.
//   • Idempotent: one task per submission, kind and rules version; evaluating twice writes one current result.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzeAuthentic, analyzeRight, analyzeValid, SCANNED_REASON, type DocText } from './doc-analysis';
import type { DocRecipe } from './doc-recipe';
import { aggregateRules, evaluateObjective, isDocKind, ruleSentence, type EligibilityRule, type Outcome, type RuleResult } from './eligibility';
import { syncApplication } from './eval-assign-store';
import { loadRecipes, loadRules } from './eligibility-store';
import { extractDocument } from './ai-import/extract';
import { isFieldVisible } from './form-logic';
import { loadCall, loadFields } from './store';
import type { Answers, Call, FormField } from './types';

type Row = Record<string, unknown>;
export type EligibilityStatus = 'fit' | 'not_fit' | 'to_validate';

export interface RuleResultRecord extends RuleResult { kind: EligibilityRule['kind']; fieldId: string; sentence: string; /** The kind of document a document rule is about (from its recipe), for the engine's hit rate by document. */ docType?: string | null }

export interface Evaluation { status: EligibilityStatus; reason: string; results: RuleResultRecord[] }

/** A failure that is NOT the applicant's: the stored file could not be read now. The queue retries it. */
export class TechnicalFailure extends Error { constructor(m: string) { super(m); this.name = 'TechnicalFailure'; } }

const SUBMISSION_BUCKET = 'data-room';

// --- Putting the verdicts of the rules together ----------------------------------------------------------------------------------------------------

/** Any clear failure → Not a fit; else any doubt → To validate; else Fit. `overrides` are what a person decided on a rule (they replace the engine's verdict of that rule). */
export function aggregate(results: Pick<RuleResult, 'ruleId' | 'outcome' | 'reason'>[], overrides: Record<string, { outcome: Outcome; why?: string }> = {}): { status: EligibilityStatus; reason: string } {
  return aggregateRules(results, overrides);
}

// --- One submission ------------------------------------------------------------------------------------------------------------------------------------

interface DocRef { fieldId: string; fileId?: string; fileName: string; frozenPath: string }

/** The text of a stored document, or why there is none. A storage error is a TECHNICAL failure; an unreadable or scanned file is a normal "To validate". */
async function readDocument(admin: SupabaseClient, ref: DocRef): Promise<DocText> {
  const dl = await admin.storage.from(SUBMISSION_BUCKET).download(ref.frozenPath);
  if (dl.error || !dl.data) throw new TechnicalFailure(`Could not read the stored file “${ref.fileName}”: ${dl.error?.message ?? 'no data'}`);
  const bytes = Buffer.from(await (dl.data as Blob).arrayBuffer());
  const ex = await extractDocument(ref.fileName, bytes);
  const hasSignature = bytes.subarray(0, Math.min(bytes.length, 5_000_000)).includes('/ByteRange');
  if (ex.ok) return { fileName: ref.fileName, pages: ex.pageTexts ?? (ex.text ? [ex.text] : null), hasSignature, ...(ex.text === null && !ex.pageTexts ? { unreadable: 'no text layer' } : {}) };
  if (ex.code === 'scanned') return { fileName: ref.fileName, pages: null, scanned: true, hasSignature };
  return { fileName: ref.fileName, pages: null, unreadable: ex.code === 'unreadable' ? 'damaged or protected' : ex.code === 'unsupported' ? 'a format the platform does not read' : ex.code, hasSignature };
}

const worst = (rs: RuleResult[]): RuleResult => rs.find((r) => r.outcome === 'fail') ?? rs.find((r) => r.outcome === 'validate') ?? rs[0];

/** Evaluates every rule of a call on one submission. `declared` values (name, tax ID) come from the answers the rule points at. */
export async function evaluateSubmission(admin: SupabaseClient, input: {
  call: Call; rules: EligibilityRule[]; fields: FormField[]; recipes: { ruleId: string; recipe: DocRecipe }[]; answers: Answers; documents: DocRef[]; submittedAt: string;
}): Promise<Evaluation> {
  const { call, fields, answers } = input;
  const byId = new Map(fields.map((f) => [f.id, f]));
  const results: RuleResultRecord[] = [];
  for (const rule of input.rules) {
    const field = byId.get(rule.fieldId);
    const sentence = ruleSentence(rule, field, { currency: call.currency, call });
    const keep = (r: RuleResult, docType?: string | null): void => { results.push({ ...r, kind: rule.kind, fieldId: rule.fieldId, sentence, ...(docType !== undefined ? { docType } : {}) }); };
    if (!field) { keep({ ruleId: rule.id, outcome: 'validate', reason: 'The question this rule was about no longer exists: a person should check.' }); continue; }
    const shown = isFieldVisible(field, byId, answers);
    if (rule.kind === 'open') { keep({ ruleId: rule.id, outcome: 'validate', reason: `Open requirement “${String((rule.params as { text?: string }).text ?? '')}”: a person decides.` }); continue; }
    if (rule.kind === 'doc_present') {
      const has = input.documents.some((d) => d.fieldId === field.id);
      keep(shown === false ? { ruleId: rule.id, outcome: 'validate', reason: `“${field.label}” was not shown to this applicant: a person should check.` }
        : { ruleId: rule.id, outcome: has ? 'pass' : 'fail', reason: has ? `A document was attached to “${field.label}”.` : `No document was attached to “${field.label}”.` });
      continue;
    }
    if (!isDocKind(rule.kind)) { keep(evaluateObjective(rule, field, answers[field.id], { call, currency: call.currency, shown })); continue; }

    // Document rules (right / valid / authentic): every file in the question is read and the worst verdict stands.
    if (!shown) { keep({ ruleId: rule.id, outcome: 'validate', reason: `“${field.label}” was not shown to this applicant: a person should check.` }); continue; }
    const refs = input.documents.filter((d) => d.fieldId === field.id);
    if (refs.length === 0) { keep({ ruleId: rule.id, outcome: 'fail', reason: `No document was attached to “${field.label}”.` }); continue; }
    const recipe = input.recipes.find((r) => r.ruleId === rule.id)?.recipe;
    if (!recipe) { keep({ ruleId: rule.id, outcome: 'validate', reason: 'This rule has no recipe prepared: a person should check the document.' }); continue; }
    const per: RuleResult[] = [];
    for (const ref of refs) {
      const doc = await readDocument(admin, ref);
      const p = rule.params as { matchName?: string | null; matchTaxId?: string | null };
      const declared = {
        legalName: p.matchName && typeof answers[p.matchName] === 'string' ? (answers[p.matchName] as string) : null,
        taxId: p.matchTaxId && typeof answers[p.matchTaxId] === 'string' ? (answers[p.matchTaxId] as string) : null,
      };
      per.push(rule.kind === 'doc_right' ? analyzeRight(rule.id, recipe, doc) : rule.kind === 'doc_valid' ? analyzeValid(rule.id, recipe, doc, declared, input.submittedAt.slice(0, 10)) : analyzeAuthentic(rule.id, recipe, doc));
    }
    keep(worst(per), recipe.docType);
  }
  const { status, reason } = aggregate(results);
  return { status, reason, results };
}

// --- Saving the result ---------------------------------------------------------------------------------------------------------------------------------

/** The new current result of an application; the earlier ones stay as history. */
export async function saveEvaluation(admin: SupabaseClient, input: {
  call: Call; applicationId: string; submissionId: string; rulesVersion: number; evaluation: Evaluation; source?: 'engine' | 'human' | 'flag'; overrides?: Record<string, unknown>; actor?: string | null;
}): Promise<void> {
  const prev = await admin.from('call_application_eligibility').update({ is_current: false }).eq('application_id', input.applicationId).eq('is_current', true);
  if (prev.error) throw new Error(`Could not retire the previous result: ${prev.error.message}`);
  const ins = await admin.from('call_application_eligibility').insert({
    call_id: input.call.id, application_id: input.applicationId, submission_id: input.submissionId, rules_version: input.rulesVersion, status: input.evaluation.status,
    source: input.source ?? 'engine', rule_results: input.evaluation.results, overrides: input.overrides ?? {}, reason: input.evaluation.reason, is_current: true, created_by: input.actor ?? null,
  });
  if (ins.error) throw new Error(`Could not save the result: ${ins.error.message}`);
  // Prompt 922 (I2): the only way into evaluation is a Fit result — whoever just became Fit is distributed (if the mode allows), whoever stopped being Fit is withdrawn. Never throws.
  await syncApplication(admin, input.call, input.applicationId);
}

// --- The queue ---------------------------------------------------------------------------------------------------------------------------------------------

export interface TaskRow { id: string; call_id: string; application_id: string; submission_id: string; rules_version: number; attempts: number; max_attempts: number }

const BACKOFF_MINUTES = [1, 5, 15, 60, 240];

/** Takes the next tasks (and any stuck in Processing for too long) and returns them marked Processing. */
export async function claimTasks(admin: SupabaseClient, limit: number, staleMinutes = 10): Promise<TaskRow[]> {
  const { data, error } = await admin.rpc('claim_call_tasks', { p_limit: limit, p_stale_minutes: staleMinutes });
  if (error) throw new Error(`Could not take tasks from the queue: ${error.message}`);
  return ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, call_id: r.call_id as string, application_id: r.application_id as string, submission_id: r.submission_id as string, rules_version: Number(r.rules_version), attempts: Number(r.attempts), max_attempts: Number(r.max_attempts) }));
}

async function finishTask(admin: SupabaseClient, id: string, patch: Row): Promise<void> {
  await admin.from('call_processing_tasks').update({ ...patch }).eq('id', id);
}

/** A temporary failure goes back to the queue after a back-off; the last attempt ends as "Technical failure" (and records why). */
export async function failTask(admin: SupabaseClient, task: TaskRow, error: string, now: Date = new Date()): Promise<'requeued' | 'technical_failure'> {
  if (task.attempts >= task.max_attempts) {
    await finishTask(admin, task.id, { status: 'technical_failure', last_error: error.slice(0, 500), finished_at: now.toISOString(), locked_at: null });
    return 'technical_failure';
  }
  const wait = BACKOFF_MINUTES[Math.min(task.attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 240;
  await finishTask(admin, task.id, { status: 'queued', last_error: error.slice(0, 500), run_after: new Date(now.getTime() + wait * 60_000).toISOString(), locked_at: null });
  return 'requeued';
}

/** Runs ONE task: loads what it needs, evaluates, saves, marks it Done. Throws TechnicalFailure / Error for a temporary problem (the caller fails the task). */
export async function runTask(admin: SupabaseClient, task: TaskRow): Promise<'done' | 'skipped'> {
  const call = await loadCall(admin, task.call_id, { includeDeleted: true });
  if (!call || call.deletedAt) { await finishTask(admin, task.id, { status: 'done', finished_at: new Date().toISOString(), last_error: null, locked_at: null }); return 'skipped'; }
  const { data: sub } = await admin.from('call_application_submissions').select('id, answers, documents, submitted_at').eq('id', task.submission_id).maybeSingle();
  if (!sub) throw new Error('The submission of this task was not found.');
  const done = await admin.from('call_application_eligibility').select('id').eq('submission_id', task.submission_id).eq('rules_version', task.rules_version).eq('is_current', true).maybeSingle();
  if (!done.data) {
    const [fields, rules, recipes] = await Promise.all([loadFields(admin, call.id), loadRules(admin, call.id, task.rules_version), loadRecipes(admin, call.id, task.rules_version)]);
    const row = sub as Row;
    const evaluation = await evaluateSubmission(admin, {
      call, rules, fields, recipes: recipes.map((r) => ({ ruleId: r.ruleId, recipe: r.recipe })), answers: (row.answers ?? {}) as Answers,
      documents: ((row.documents ?? []) as Row[]).filter((d) => typeof d.frozenPath === 'string').map((d) => ({ fieldId: d.fieldId as string, fileId: d.fileId as string | undefined, fileName: String(d.fileName ?? 'document'), frozenPath: d.frozenPath as string })),
      submittedAt: String(row.submitted_at ?? new Date().toISOString()),
    });
    await saveEvaluation(admin, { call, applicationId: task.application_id, submissionId: task.submission_id, rulesVersion: task.rules_version, evaluation });
    await admin.from('call_events').insert({ call_id: call.id, application_id: task.application_id, event: 'eligibility_evaluated', actor_user_id: null, detail: { status: evaluation.status, version: task.rules_version } });
  }
  await finishTask(admin, task.id, { status: 'done', finished_at: new Date().toISOString(), last_error: null, locked_at: null });
  return 'done';
}

export interface QueueRun { claimed: number; done: number; requeued: number; technicalFailures: number }

/** Takes and runs up to `limit` tasks, one after the other (concurrency stays controlled: at most `limit` per call of this function, and the claim is safe across runners). */
export async function processQueue(admin: SupabaseClient, opts: { limit?: number; staleMinutes?: number; now?: Date } = {}): Promise<QueueRun> {
  const out: QueueRun = { claimed: 0, done: 0, requeued: 0, technicalFailures: 0 };
  const tasks = await claimTasks(admin, opts.limit ?? 10, opts.staleMinutes ?? 10);
  out.claimed = tasks.length;
  for (const task of tasks) {
    try { await runTask(admin, task); out.done++; }
    catch (e) {
      const state = await failTask(admin, task, (e as Error).message, opts.now);
      if (state === 'requeued') out.requeued++; else out.technicalFailures++;
      console.error(`[calls] eligibility task ${task.id} ${state}:`, (e as Error).message);
    }
  }
  return out;
}

/** After a submission: gives the task of THIS application a first go at once (bounded), so the result is usually there when the entity looks. Anything that fails stays in the queue. */
export async function processApplicationNow(admin: SupabaseClient, applicationId: string, budgetMs = 6000): Promise<void> {
  const { data } = await admin.from('call_processing_tasks').select('id').eq('application_id', applicationId).eq('status', 'queued').limit(1);
  if (!((data ?? []) as Row[]).length) return;
  await Promise.race([processQueue(admin, { limit: 3 }).catch(() => undefined), new Promise<void>((r) => setTimeout(r, budgetMs))]);
}

/** A new rules version: every current submission of the call is evaluated again (a task per submission for the new version; the earlier results stay). Returns how many were queued. */
export async function enqueueReevaluation(admin: SupabaseClient, callId: string, version: number): Promise<number> {
  const { data: apps } = await admin.from('call_applications').select('id, current_submission_id').eq('call_id', callId).eq('status', 'submitted');
  const rows = ((apps ?? []) as Row[]).filter((a) => a.current_submission_id).map((a) => ({ call_id: callId, application_id: a.id, submission_id: a.current_submission_id, kind: 'eligibility', rules_version: version }));
  if (rows.length === 0) return 0;
  const { error } = await admin.from('call_processing_tasks').upsert(rows, { onConflict: 'submission_id,kind,rules_version', ignoreDuplicates: true });
  if (error) throw new Error(`Could not queue the new evaluation: ${error.message}`);
  return rows.length;
}

export { SCANNED_REASON };
