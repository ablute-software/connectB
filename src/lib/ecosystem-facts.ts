// Prompt 122 Block B (F1) — instrumentation for ecosystem_facts (migration
// 0116, PROPOSED, NOT APPLIED). Every write here is best-effort: gated on
// ecosystemFactsAvailable, wrapped in try/catch, and never allowed to fail
// the caller's real flow (a review still saves, a decision still records,
// a grant still gets created even if this insert fails or the table
// doesn't exist yet). No free text ever reaches ecosystem_facts — only
// numbers and closed categories, per the migration's own no-free-text rule.
//
// Pure fact-shaping (severityToNumeric, buildAiReviewFacts) lives in
// ecosystem-facts-shape.ts instead of here, so it's unit-testable without
// pulling in 'server-only' + a SupabaseClient.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ecosystemFactsAvailable } from './ecosystem-facts-capability';
import { buildAiReviewFacts, type EcosystemFactRow } from './ecosystem-facts-shape';

async function insertFacts(admin: SupabaseClient, rows: EcosystemFactRow[], label: string) {
  if (rows.length === 0) return;
  if (!(await ecosystemFactsAvailable())) return;
  try {
    await admin.from('ecosystem_facts').insert(rows);
  } catch (e) {
    console.error(`ecosystem_facts insert (${label}) failed:`, e);
  }
}

export async function recordAiReviewFacts(admin: SupabaseClient, params: Parameters<typeof buildAiReviewFacts>[0]) {
  await insertFacts(admin, buildAiReviewFacts(params), 'ai_review');
}

// Prompt 122 §B.2.2 — decide_investor_relationship's caller
// (/api/portal/pipeline POST). Read-only observation of a decision that
// already happened via the RPC; this never influences the decision itself.
export async function recordInvestorDecisionFact(admin: SupabaseClient, params: { orgId: string; decision: 'interest' | 'pass'; decisionId?: string }) {
  await insertFacts(admin, [{
    org_id: params.orgId, metric_key: 'investor_decision', value_category: params.decision,
    source: 'funnel', source_id: params.decisionId ?? null,
  }], 'investor_decision');
}

// Prompt 122 §B.2.3 — access_grants creation. Zero changes to grant logic:
// this only observes that a grant was created, after the fact.
export async function recordGrantCreatedFact(admin: SupabaseClient, params: { orgId: string; grantId?: string }) {
  await insertFacts(admin, [{
    org_id: params.orgId, metric_key: 'grant_created', value_numeric: 1,
    source: 'funnel', source_id: params.grantId ?? null,
  }], 'grant_created');
}
