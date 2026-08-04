// Prompt 122 Block B (F1) — pure fact-shaping functions, deliberately split
// out from ecosystem-facts.ts (which is 'server-only' and pulls in a
// SupabaseClient) so these can be unit-tested directly without a server-only
// resolution error under vitest. No side effects, no imports beyond types.
export type Severity = 'low' | 'medium' | 'high';

// The one place this mapping is defined — reused by every caller so
// "medium severity" always means the same number everywhere in
// ecosystem_facts, today and after methodology_version increments.
export function severityToNumeric(severity: Severity): number {
  return { low: 1, medium: 2, high: 3 }[severity];
}

export interface EcosystemFactRow {
  org_id: string;
  metric_key: string;
  value_numeric?: number | null;
  value_category?: string | null;
  source: 'ai_review' | 'profile' | 'funnel' | 'document_census';
  source_id?: string | null;
}

interface Finding { category: string; severity: Severity }

// Prompt 122 §B.2.1 — the two ai_reviews insert sites that produce
// analyzable findings: the main structured-report path (score + weaknesses
// + risks) and cross_document_review (contradictions, no overall score).
// The malformed-report fallback is deliberately NOT instrumented — its
// `result` is raw, unvalidated model output with no guaranteed shape to
// extract a score or findings from.
export function buildAiReviewFacts(params: {
  orgId: string; reviewId: string; score?: number | null;
  weaknesses?: Finding[]; risks?: Finding[];
}): EcosystemFactRow[] {
  const rows: EcosystemFactRow[] = [];
  if (params.score != null) {
    rows.push({ org_id: params.orgId, metric_key: 'review_score', value_numeric: params.score, source: 'ai_review', source_id: params.reviewId });
  }
  for (const w of params.weaknesses ?? []) {
    rows.push({
      org_id: params.orgId, metric_key: 'weakness_prevalence', value_category: w.category,
      value_numeric: severityToNumeric(w.severity), source: 'ai_review', source_id: params.reviewId,
    });
  }
  for (const r of params.risks ?? []) {
    rows.push({
      org_id: params.orgId, metric_key: 'risk_prevalence', value_category: r.category,
      value_numeric: severityToNumeric(r.severity), source: 'ai_review', source_id: params.reviewId,
    });
  }
  return rows;
}
