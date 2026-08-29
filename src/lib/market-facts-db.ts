// Prompt 467 §B — the single, atomic write point for market_facts. Server-
// only, and the ONLY file allowed to write market_facts at all (enforced by
// the guard added to no-fire-and-forget.test.ts in §B.5) — every caller
// that wants a typed market proposition persisted goes through
// writeMarketFact, never a bare `.from('market_facts').insert(...)`.
//
// Division of labor, deliberately: this file does validation and
// derivation (business logic) in TypeScript; migration 0279's
// write_market_fact() RPC does ONLY the atomic multi-table write. v1 of
// this prompt described "the same sequence" for fact/evidence/observation
// — sequence is not a transaction, and a failure partway through would
// leave a market_fact with no evidence behind it, i.e. a fact for which
// "Why do we know this?" has no answer. The RPC call below is the only
// mutating call this function makes.
import 'server-only';
import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validateGrowthFact, validateMarketSizeFact, normalizeText,
  type GrowthFact, type MarketSizeFact,
} from './market-fact-normalization';

export type EvidenceOrigin = 'founder_document' | 'sherlock_web' | 'external_report';
export type EvidenceSourceKind = 'pitch_deck' | 'internal_doc' | 'market_report' | 'press' | 'company_site' | 'filing' | 'other';
export type RetrievalMethod = 'vault_extraction' | 'link_snapshot' | 'web_fetch' | 'manual_entry';
export type VerificationStatus = 'founder_reported' | 'externally_sourced' | 'corroborated' | 'conflicting';
export type FactType = 'growth' | 'market_size';

export interface EvidenceInput {
  documentId: string | null;
  page: number | null;
  quote: string | null;
  sourceUrl: string | null;
  publishedAt: string | null; // 'YYYY-MM-DD' or null
  origin: EvidenceOrigin;
  sourceKind: EvidenceSourceKind;
  retrievalMethod: RetrievalMethod;
}

export interface ObservationInput {
  evidence: EvidenceInput;
  extractionRunId: string;
  rawCandidate: unknown;
  // Set ONLY when the pipeline knows, by construction, that this candidate
  // descends from that exact market_research_items row (§C) — never a
  // heuristic guess. Null is the normal case and produces zero supersession
  // rows, on purpose (invariable 14 — no merge without positive proof).
  legacyItemId: string | null;
}

export interface WriteMarketFactResult { id: string; verificationStatus: VerificationStatus }

// document-based locator: document_id|page|quote (normalized). Web locator:
// source_url|quote. Hashed (not stored raw) so a long quote is never what
// gets indexed — matches migration 0279's evidence_fingerprint column.
// `quote = null` normalizes to the empty string on BOTH sides of a
// comparison, so two readings of the same document+page with no quote
// still collapse to the same fingerprint — the exact case v1 of this
// prompt left passing as two separate rows.
export function computeEvidenceFingerprint(e: Pick<EvidenceInput, 'documentId' | 'page' | 'quote' | 'sourceUrl'>): string {
  const quote = e.quote ? normalizeText(e.quote) : '';
  const locator = e.documentId ? `${e.documentId}|${e.page ?? ''}|${quote}` : `${e.sourceUrl ?? ''}|${quote}`;
  return createHash('sha256').update(locator).digest('hex');
}

// Deterministic over context + the resulting estimate — NOT the same key
// groupKeyFor (market-fact-normalization.ts) uses for grouping, which
// deliberately excludes value/bounds (grouping happens BEFORE the estimate
// is built). Two sources disagreeing on value under the same market/period
// (8% vs 12%) must fingerprint differently — that disagreement is real
// signal, never silently merged (invariable 14).
export function computeFactFingerprint(fact: GrowthFact | MarketSizeFact): string {
  const md = fact.marketDefinition ? normalizeText(fact.marketDefinition) : '';
  const geo = fact.geography ? normalizeText(fact.geography) : '';
  const parts: unknown[] = fact.kind === 'growth'
    ? ['growth', md, geo, fact.metric, fact.periodStart, fact.periodEnd, fact.estimateShape, fact.value, fact.lowerBound, fact.upperBound]
    : ['size', md, geo, fact.metric, fact.asOfYear, fact.estimateShape, fact.value, fact.lowerBound, fact.upperBound, fact.currency];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

// The origins table from Prompt 467 §A, computed deterministically
// (invariable 9 — the model extracts, the logic decides). Takes the origin
// of every piece of evidence behind a fact — this call's own observations
// UNIONED with whatever is already on file for it, so a fact that later
// receives external corroboration upgrades correctly instead of being
// stuck at whatever its first write happened to see.
//
// 'conflicting' is deliberately never returned here. Within ONE market_fact
// every observation shares the same value/bounds (that's what
// fact_fingerprint identity means — two disagreeing sources are always TWO
// facts, per computeFactFingerprint above), so "evidence that contradicts
// itself" cannot arise from one fact's own evidence set. A real
// cross-fact conflict (two SIBLING facts, same context, different values)
// is a §D UI-level concept ("shown as conflict, the two statements side by
// side") that would need comparing across facts, not deriving a single
// fact's own column — genuinely out of scope here (no test requires it, no
// code path in this prompt's own pipeline ever produces external evidence
// at all — see §C). The column still allows 'conflicting' for whatever
// later mechanism resolves that; this function simply never emits it.
export function deriveVerificationStatus(
  origins: { origin: EvidenceOrigin; documentId: string | null; sourceUrl: string | null }[],
): VerificationStatus {
  const external = origins.filter((o) => o.origin === 'sherlock_web' || o.origin === 'external_report');
  if (external.length === 0) return 'founder_reported';
  // "documentos/URLs distintos" — independence counted by distinct
  // document or URL identity, not by evidence row count (two readings of
  // the same external report are one source, not two).
  const independent = new Set(external.map((o) => o.documentId ?? o.sourceUrl ?? JSON.stringify(o)));
  return independent.size >= 2 ? 'corroborated' : 'externally_sourced';
}

// What actually goes in market_facts.payload: the fact's own semantic
// content only. sourceRefs/observationIds are deliberately excluded — that
// lineage already lives in market_evidence/market_fact_observations, and
// storing it twice is exactly the kind of duplicated truth this prompt's
// evidence layer exists to avoid.
function factPayload(fact: GrowthFact | MarketSizeFact): Record<string, unknown> {
  const base = {
    marketDefinition: fact.marketDefinition, geography: fact.geography, metric: fact.metric,
    estimateShape: fact.estimateShape, value: fact.value, lowerBound: fact.lowerBound, upperBound: fact.upperBound,
  };
  return fact.kind === 'growth'
    ? { ...base, periodStart: fact.periodStart, periodEnd: fact.periodEnd }
    : { ...base, currency: fact.currency, asOfYear: fact.asOfYear, methodology: fact.methodology };
}

interface ExistingOrigin { origin: EvidenceOrigin; documentId: string | null; sourceUrl: string | null }

async function existingOriginsFor(admin: SupabaseClient, orgId: string, factType: FactType, fingerprint: string): Promise<ExistingOrigin[]> {
  const { data: existingFact } = await admin.from('market_facts')
    .select('id').eq('org_id', orgId).eq('fact_type', factType).eq('fact_fingerprint', fingerprint).maybeSingle();
  const factId = (existingFact as { id: string } | null)?.id;
  if (!factId) return [];
  const { data: rows } = await admin.from('market_fact_observations')
    .select('market_evidence(origin, document_id, source_url)').eq('market_fact_id', factId);
  type Row = { market_evidence: { origin: EvidenceOrigin; document_id: string | null; source_url: string | null } | null };
  return ((rows ?? []) as unknown as Row[])
    .map((r) => r.market_evidence)
    .filter((e): e is NonNullable<Row['market_evidence']> => !!e)
    .map((e) => ({ origin: e.origin, documentId: e.document_id, sourceUrl: e.source_url }));
}

// §B — the chokepoint. Revalidates the fact (never trusts what arrives),
// derives verification_status, then makes exactly ONE mutating call
// (write_market_fact) — no other insert/update in this function, which is
// what makes "no market_fact left orphaned by a partial write" true from
// the application's side; the RPC itself is atomic by ordinary Postgres
// function semantics (an unhandled exception rolls back everything the
// function did, no explicit BEGIN/COMMIT needed).
export async function writeMarketFact(
  admin: SupabaseClient,
  orgId: string,
  fact: GrowthFact | MarketSizeFact,
  observations: ObservationInput[],
): Promise<WriteMarketFactResult> {
  if (observations.length === 0) {
    throw new Error('writeMarketFact: at least one observation is required — a fact with no evidence would have no answer to "Why do we know this?"');
  }

  const factType: FactType = fact.kind === 'growth' ? 'growth' : 'market_size';
  const validated = fact.kind === 'growth' ? validateGrowthFact(fact) : validateMarketSizeFact(fact);
  const fingerprint = computeFactFingerprint(validated);

  const existing = await existingOriginsFor(admin, orgId, factType, fingerprint);
  const incoming = observations.map((o) => ({ origin: o.evidence.origin, documentId: o.evidence.documentId, sourceUrl: o.evidence.sourceUrl }));
  const verificationStatus = deriveVerificationStatus([...existing, ...incoming]);

  const pObservations = observations.map((o) => ({
    evidence_fingerprint: computeEvidenceFingerprint(o.evidence),
    document_id: o.evidence.documentId,
    page: o.evidence.page,
    quote: o.evidence.quote,
    source_url: o.evidence.sourceUrl,
    published_at: o.evidence.publishedAt,
    origin: o.evidence.origin,
    source_kind: o.evidence.sourceKind,
    retrieval_method: o.evidence.retrievalMethod,
    extraction_run_id: o.extractionRunId,
    raw_candidate: o.rawCandidate ?? null,
    legacy_item_id: o.legacyItemId,
  }));

  const { data, error } = await admin.rpc('write_market_fact', {
    p_org_id: orgId,
    p_fact_type: factType,
    p_fact_fingerprint: fingerprint,
    p_payload: factPayload(validated),
    p_validation_status: validated.validation.status,
    p_validation: validated.validation,
    p_verification_status: verificationStatus,
    p_observations: pObservations,
  });
  if (error) throw new Error(`writeMarketFact: ${error.message}`);

  return { id: data as string, verificationStatus };
}
