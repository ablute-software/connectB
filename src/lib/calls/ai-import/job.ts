// Prompt 909 (Adenda 2) — the model's work of reading the documents, run AFTER the route has answered (see lib/background.ts).
//
// What it guarantees, whatever happens:
//   · the run it owns leaves "reading": it becomes "proposed" (with the proposal) or "failed" (with a sentence a person can act on) — never both,
//     never neither (a run whose function was killed is closed as failed by expireStaleRuns, the next time anyone looks);
//   · it has its own clock: the call to the model is aborted a little before the function's limit, so a slow model is a clear "failed"
//     and not a platform timeout;
//   · every failure is recorded with its reason, the call, how long it took and how big the files were — on the run, in the call's history, and in the logs;
//   · a failed run keeps nothing: the documents it stored are deleted again (a retry would otherwise pile up copies).
// It never throws and never applies anything.
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeCostEur, logAiCall } from '@/lib/ai-cost-log';
import { logCallEvent } from '@/lib/calls/store';
import { ImportProviderError } from './anthropic';
import { proposeFromDocuments, type ModelCaller, type PreparedDoc } from './propose';
import { notifyImportFinished } from './notify';
import { deleteSourceDocument, finishRunFailed, finishRunProposed } from './store';

/** The route's `maxDuration` (seconds). The route file must repeat it as a literal (Next reads it statically); a test keeps the two equal. */
export const IMPORT_MAX_DURATION_S = 300;
/** The model gets this long; the rest of the limit is left for saving the answer. */
export const MODEL_BUDGET_MS = (IMPORT_MAX_DURATION_S - 30) * 1000;

export const CONTACT_PHRASE = 'contact us at sherlockdeal.com/contact';
export const INTERNAL_FAILURE_MESSAGE = `We could not read the documents because of a problem on our side. Please try again; if it keeps failing, ${CONTACT_PHRASE}.`;
export const timedOutMessage = (budgetMs: number) =>
  `Reading the documents took longer than we allow (${Math.round(budgetMs / 60000 * 10) / 10} minutes), so it was stopped. Please try again; a shorter document, or one document at a time, is faster.`;

export interface JobInput {
  admin: SupabaseClient; callId: string; callName: string; runId: string; userId: string;
  docs: PreparedDoc[]; files: { name: string; kind: string; bytes: number }[]; sourceDocumentIds: string[];
}
export interface JobDeps { callModel: ModelCaller; budgetMs?: number; now?: () => number }

export function classifyFailure(e: unknown, timedOut: boolean, budgetMs: number): { code: string; message: string; detail: string } {
  const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (timedOut) return { code: 'timed_out', message: timedOutMessage(budgetMs), detail };
  if (e instanceof ImportProviderError) return { code: e.code, message: e.message, detail };
  return { code: 'internal', message: INTERNAL_FAILURE_MESSAGE, detail };
}

export async function runImportJob(input: JobInput, deps: JobDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  const budgetMs = deps.budgetMs ?? MODEL_BUDGET_MS;
  const startedAt = now();
  const totalBytes = input.files.reduce((n, f) => n + f.bytes, 0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const result = await proposeFromDocuments(input.docs, { callModel: deps.callModel, signal: controller.signal });
    clearTimeout(timer);
    const durationMs = now() - startedAt;
    // Awaited: ai_call_log is used as proof that a pipeline ran (see ai-review).
    const meta = result.meta;
    await logAiCall({ route: '/api/calls/import-ai', purpose: 'calls_import_from_documents', model: result.model, usage: result.usage, targetType: 'call', targetId: input.callId });
    const run = await finishRunProposed(input.admin, input.runId, {
      proposal: result.proposal, model: result.model, tokensIn: result.usage?.input_tokens ?? null, tokensOut: result.usage?.output_tokens ?? null,
      costEur: computeCostEur(result.model, result.usage), durationMs,
    });
    if (!run) { console.error(`[calls/import-ai] run ${input.runId} was no longer reading when the proposal arrived (closed meanwhile): the proposal was dropped`); return; }
    await logCallEvent(input.admin, input.callId, 'import_proposed', input.userId, {
      runId: run.id, documents: input.sourceDocumentIds.length, kinds: input.files.map((f) => f.kind), tokensIn: run.tokensIn, tokensOut: run.tokensOut, costEur: run.costEur, model: result.model, durationMs,
      inputMode: meta.inputMode, calls: meta.calls, parts: meta.chunks,
    });
    // The person may have left the screen: tell them, inside the platform, that the proposal is ready.
    await notifyImportFinished(input.admin, { userId: input.userId, callId: input.callId, callName: input.callName, runId: input.runId, outcome: 'ready' });
  } catch (e) {
    clearTimeout(timer);
    const durationMs = now() - startedAt;
    const f = classifyFailure(e, controller.signal.aborted, budgetMs);
    // The reason, the call and the size of what was sent: in the logs, on the run, and in the call's history.
    console.error(`[calls/import-ai] FAILED run=${input.runId} call=${input.callId} code=${f.code} ms=${durationMs} bytes=${totalBytes} files=${input.files.map((x) => `${x.kind}:${x.bytes}`).join(',')} :: ${f.detail}`);
    try {
      await finishRunFailed(input.admin, input.runId, { code: f.code, message: f.message, durationMs });
      await logCallEvent(input.admin, input.callId, 'import_failed', input.userId, { runId: input.runId, code: f.code, durationMs, bytes: totalBytes, files: input.files.map((x) => ({ kind: x.kind, bytes: x.bytes })) });
      for (const id of input.sourceDocumentIds) await deleteSourceDocument(input.admin, input.callId, id);
      await notifyImportFinished(input.admin, { userId: input.userId, callId: input.callId, callName: input.callName, runId: input.runId, outcome: 'failed', message: f.message });
    } catch (inner) {
      console.error(`[calls/import-ai] could not record the failure of run ${input.runId}:`, (inner as Error).message);
    }
  }
}
