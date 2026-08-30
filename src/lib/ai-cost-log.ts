// Prompt 293 §1 — single destination for every AI-call cost record in the
// Next app. Call this once per Anthropic response, at every call site
// that previously discarded `usage` entirely (confirmed by direct
// reading: none of the 17 instrumented routes read `usage` before this).
//
// Prompt 469 — ai_call_log stopped being pure telemetry the day it started
// getting used as evidence. It serves THREE functions today, and the third
// changes everything: (1) observability — did it run; (2) FinOps — what did
// it cost; (3) ACCEPTANCE CRITERION — was there really a model call. #3 was
// used repeatedly on 2026-08-29: the ABSENCE of entries proved Prompt 463
// §C's fire-and-forget never ran, and the PRESENCE of a €0.066 entry proved
// Prompt 464 worked. A tool used as proof has to be trustworthy, and a
// `void logAiCall(...)` call site is not: it runs mid-handler and only
// "works" because there's usually more work after it — if the response
// goes out first, the serverless instance freezes and the entry vanishes,
// silently, no error. That is the exact Prompt 464/465 failure class,
// applied to the table this codebase used to PROVE that failure class
// exists. Until this was fixed, "zero entries" was not proof of "didn't
// run" — one of this project's own verification tools wasn't trustworthy.
//
import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Telemetry used for cost accounting, auditing, or acceptance criteria is
// DURABLE WORK and cannot be fire-and-forget. Telemetry that can genuinely
// be lost without consequence still can be — the distinction is now part
// of the type, not left to whoever is calling:
export type TelemetryDurability =
  | 'best_effort' // may be lost with no consequence — no current caller of logAiCall needs this; kept for when one does
  | 'audit';      // cost accounting, auditing, or acceptance criteria — never fire-and-forget

// ai_call_log is 'audit', by its REAL usage above — every call site now
// `await`s logAiCall (never `void`). This still never blocks or fails the
// caller's real response on ITS OWN account: logAiCall swallows its own
// errors (network/RLS/etc., see the try/catch below), so awaiting it can
// only ever ADD the latency of one Supabase insert (tens of milliseconds)
// against a model call that just took seconds — never make an AI feature
// fail because its cost log couldn't be written. Do not "optimize" this
// back to `void`: that is what silently broke the acceptance tooling
// before this prompt.
export const AI_CALL_LOG_DURABILITY: TelemetryDurability = 'audit';

// Same USD/1M pricing as supabase/functions/enrichment-worker/index.ts's
// own PRICING table — duplicated, not imported: that worker runs on Deno
// (Supabase Edge Functions), a separate runtime this Next app has no
// import path into. Keep the two tables in sync by hand if pricing ever
// changes; this is the cost of straddling two runtimes, not a design
// choice. claude-sonnet-4-5/claude-haiku-4-5 are the literal default
// model strings every route in this app actually uses today
// (AI_REVIEW_MODEL/AI_CLASSIFY_MODEL env defaults, confirmed by grep) —
// priced the same as their -5 siblings pending Anthropic publishing a
// distinct rate for the 4-5 line; there is no evidence of a different
// price tier, only that no one has re-confirmed it since -5 shipped.
const USD_TO_EUR = 0.865;
const PRICING: Record<string, { inUsd: number; outUsd: number }> = {
  'claude-haiku-4-5': { inUsd: 1.0, outUsd: 5.0 },
  'claude-sonnet-5': { inUsd: 2.0, outUsd: 10.0 },
  'claude-sonnet-4-5': { inUsd: 2.0, outUsd: 10.0 },
};

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

export function computeCostEur(model: string, usage: AnthropicUsage | undefined): number {
  if (!usage) return 0;
  const p = PRICING[model];
  if (!p) return 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const freshInput = Math.max(0, (usage.input_tokens ?? 0) - cacheRead);
  const usd = (freshInput / 1_000_000) * p.inUsd
    + (cacheRead / 1_000_000) * p.inUsd * 0.1 // cache read = 10% of input price, same as the worker
    + ((usage.output_tokens ?? 0) / 1_000_000) * p.outUsd;
  return usd * USD_TO_EUR;
}

export interface LogAiCallParams {
  route: string;
  purpose: string;
  model: string;
  usage?: AnthropicUsage;
  // Prompt 293 §1 — null when this call benefits the shared catalog
  // rather than one org (enrichment-worker-style calls, backoffice
  // research spanning multiple orgs' rows for the same catalog record).
  orgId?: string | null;
  targetType?: string;
  targetId?: string;
}

export async function logAiCall(params: LogAiCallParams): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return; // demo mode / no Supabase — nothing to log against

  try {
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { error } = await admin.from('ai_call_log').insert({
      route: params.route,
      purpose: params.purpose,
      model: params.model,
      tokens_in: params.usage?.input_tokens ?? null,
      tokens_out: params.usage?.output_tokens ?? null,
      cost_eur: computeCostEur(params.model, params.usage),
      org_id: params.orgId ?? null,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
    });
    // ai_call_log lands in migration 0202 — until it's applied, every
    // insert 42P01s. Swallow that specific, expected case quietly; still
    // surface anything else (a real bug is worth seeing in logs).
    if (error && error.code !== '42P01') console.error('[ai-cost-log] insert failed', error.message);
  } catch (e) {
    console.error('[ai-cost-log] failed to record call', e);
  }
}
