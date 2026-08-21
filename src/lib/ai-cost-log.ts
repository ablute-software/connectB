// Prompt 293 §1 — single destination for every AI-call cost record in the
// Next app. Call this once per Anthropic response, at every call site
// that previously discarded `usage` entirely (confirmed by direct
// reading: none of the 17 instrumented routes read `usage` before this).
//
// Never blocks or fails the caller's real response: logAiCall swallows
// its own errors (network/RLS/etc.) and callers should invoke it as
// `void logAiCall(...)` — fire-and-forget, same spirit as
// triggerEnrichmentEnqueue in store-supabase.tsx. Cost observability must
// never be the reason a founder-facing AI feature fails.
import 'server-only';
import { createClient } from '@supabase/supabase-js';

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
