// Prompt 919 — the orchestration of one website check and one summary, with every side effect passed in (the clock, the rows, the call to
// Google, the insert, the charge, the model, the usage log), so the ORDER and the refusals that matter are proved by tests instead of by
// reading a route. The routes wire the real ones. Same shape as company-badge-verify-core.ts (Prompt 918).
//
//  · A CHECK is free (Google's analysis costs us nothing) and never touches the wallet. It is limited to one per org per 7 days for the
//    same address (checkAllowance), runs mobile and desktop in parallel (one function lives 60 s), and ALWAYS stores something: a good
//    analysis, or a row that says why it failed.
//  · A SUMMARY is the only thing that is charged. The wallet is charged FIRST; if it refuses, nothing else runs — no model call, no
//    write — and the analysis already on file stays exactly as it was (the card keeps its scores and shows the button again).
import {
  WEBSITE_STRATEGIES, checkAllowance, failureRow, normalizeWebsiteUrl, successRow,
  type CheckBlock, type ReduceResult, type StoredRowLike, type WebsiteCheckError, type WebsiteStrategy,
} from './website-health';
import {
  WEBSITE_SUMMARY_MODEL, buildSummaryRequest, parseSummaryToolUse, validateWebsiteSummary,
  type SummaryInput, type WebsiteSummary,
} from './website-health-summary';

export type AuditInsert = ReturnType<typeof successRow> | ReturnType<typeof failureRow>;

export interface CheckDeps {
  now: () => Date;
  /** The org's most recent rows (enough to see the last good analysis and the last attempt). */
  loadRows: () => Promise<StoredRowLike[]>;
  analyse: (url: string, strategy: WebsiteStrategy) => Promise<ReduceResult>;
  insertRows: (rows: AuditInsert[]) => Promise<{ error: string | null }>;
}

export type CheckOutcome =
  | { kind: 'blocked'; reason: CheckBlock | 'invalid_website'; nextCheckAt?: string }
  | { kind: 'done'; url: string; fetchedAt: string; results: { strategy: WebsiteStrategy; ok: boolean; error?: WebsiteCheckError }[]; anyOk: boolean }
  | { kind: 'storage_failed'; error: string };

export async function runWebsiteCheck(input: { orgId: string; website: string | null | undefined; force?: boolean }, deps: CheckDeps): Promise<CheckOutcome> {
  const typed = (input.website ?? '').trim();
  if (!typed) return { kind: 'blocked', reason: 'no_website' };
  const url = normalizeWebsiteUrl(typed);
  if (!url) return { kind: 'blocked', reason: 'invalid_website' };

  const now = deps.now();
  const allowance = checkAllowance(await deps.loadRows(), url, now, { force: input.force });
  if (!allowance.allowed) return { kind: 'blocked', reason: allowance.reason!, nextCheckAt: allowance.nextCheckAt };

  // Both strategies at once: Google takes 10–40 s a call and the whole function has 60.
  const answers = await Promise.all(WEBSITE_STRATEGIES.map((s) => deps.analyse(url, s)));
  const fetchedAt = now.toISOString();
  const rows: AuditInsert[] = WEBSITE_STRATEGIES.map((strategy, i) => {
    const a = answers[i];
    return a.ok ? successRow(input.orgId, url, strategy, a.analysis, fetchedAt) : failureRow(input.orgId, url, strategy, a.error, fetchedAt);
  });
  const stored = await deps.insertRows(rows);
  if (stored.error) return { kind: 'storage_failed', error: stored.error };
  return {
    kind: 'done', url, fetchedAt,
    results: WEBSITE_STRATEGIES.map((strategy, i) => { const a = answers[i]; return a.ok ? { strategy, ok: true } : { strategy, ok: false, error: a.error }; }),
    anyOk: answers.some((a) => a.ok),
  };
}

// ---------------------------------------------------------------------------------------------------------------------

export interface SummaryDeps {
  /** chargeAiAction(sb, orgId, 'website_summary') — the first thing that runs. */
  charge: () => Promise<{ ok: boolean; reason: string | null }>;
  callModel: (body: Record<string, unknown>) => Promise<{ content: unknown[]; usage: unknown }>;
  logUsage: (usage: unknown) => Promise<void>;
  /** What the wallet actually charged for this one (it can differ from the list price: plan overrides); read after the charge. */
  chargedCredits: () => Promise<number>;
}

export type SummaryOutcome =
  | { kind: 'refused'; error: string }
  /** The wallet was charged and the model answered, but nothing usable came back (no headline). The credits are spent: the route says so. */
  | { kind: 'unusable'; credits: number }
  | { kind: 'done'; summary: WebsiteSummary; model: string; credits: number; telemetry: { estimatedInputTokens: number; findingsSent: number; findingsTotal: number } };

export async function runWebsiteSummary(input: SummaryInput, deps: SummaryDeps, model: string = WEBSITE_SUMMARY_MODEL): Promise<SummaryOutcome> {
  // 1. THE CHARGE, before anything that costs: no model call if the wallet refuses.
  const charge = await deps.charge();
  if (!charge.ok) return { kind: 'refused', error: charge.reason ?? 'Not enough AI credits for this summary.' };

  // 2. The question, inside the budget; 3. the model.
  const request = buildSummaryRequest(input, model);
  const response = await deps.callModel(request.body);
  await deps.logUsage(response.usage);
  const credits = await deps.chargedCredits();

  // 4. Only what Google reported may come out.
  const summary = validateWebsiteSummary(parseSummaryToolUse(response.content), input.findings, input.scores);
  if (!summary) return { kind: 'unusable', credits };
  return { kind: 'done', summary, model, credits, telemetry: { estimatedInputTokens: request.estimatedInputTokens, findingsSent: request.findingsSent, findingsTotal: request.findingsTotal } };
}
