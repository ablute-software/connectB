// Prompt 467 §D — pure view logic for the founder-facing surfacing of
// market_facts. No I/O: the route (facts/route.ts) fetches, this module
// only decides WHERE a fact belongs and HOW to describe it in words —
// testable without a database, same discipline as market-fact-
// normalization.ts and rules.ts.
//
// factZone is the one function this whole section hangs on: it is the
// mechanical enforcement of "verification_status decides what is
// actionable Market Intelligence, never validation_status" (§D's own
// opening line). validation_status is checked FIRST and can only ever
// demote a fact further away from "actionable" — a malformed or
// incomplete fact is never shown as verified market intelligence no
// matter what its evidence origins say; verification_status only decides
// among well-formed ('valid') facts.
export type FactZone = 'actionable' | 'founder_reported' | 'incomplete' | 'invalid' | 'conflicting';

export interface FactPayload {
  marketDefinition: string | null;
  geography: string | null;
  metric: string;
  estimateShape: 'point' | 'interval' | 'lower_bound' | 'upper_bound';
  value: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  periodStart?: number | null;
  periodEnd?: number | null;
  currency?: string | null;
  asOfYear?: number | null;
  methodology?: string | null;
}

export interface FactValidationView { status: 'valid' | 'incomplete' | 'invalid'; missing: string[]; errors: string[]; flags: string[] }

export interface FactEvidenceView {
  documentName: string | null;
  page: number | null;
  quote: string | null;
  sourceUrl: string | null;
  origin: string;
  sourceKind: string;
  retrievalMethod: string;
}

export interface FactView {
  id: string;
  factType: 'growth' | 'market_size';
  payload: FactPayload;
  validationStatus: 'valid' | 'incomplete' | 'invalid';
  validation: FactValidationView;
  verificationStatus: 'founder_reported' | 'externally_sourced' | 'corroborated' | 'conflicting';
  evidence: FactEvidenceView[];
}

export function factZone(fact: Pick<FactView, 'validationStatus' | 'verificationStatus'>): FactZone {
  if (fact.validationStatus === 'invalid') return 'invalid';
  if (fact.validationStatus === 'incomplete') return 'incomplete';
  if (fact.verificationStatus === 'conflicting') return 'conflicting';
  if (fact.verificationStatus === 'corroborated' || fact.verificationStatus === 'externally_sourced') return 'actionable';
  return 'founder_reported';
}

function fmtNum(n: number): string {
  return Math.abs(n) >= 1000 ? n.toLocaleString() : String(n);
}

function valuePart(fact: Pick<FactView, 'factType' | 'payload'>): string {
  const p = fact.payload;
  const unit = fact.factType === 'growth' ? '%' : '';
  const currencyPrefix = fact.factType === 'market_size' && p.currency ? `${p.currency} ` : '';
  if (p.estimateShape === 'interval' && p.lowerBound != null && p.upperBound != null) {
    return `${currencyPrefix}${fmtNum(p.lowerBound)}–${fmtNum(p.upperBound)}${unit}`;
  }
  if (p.estimateShape === 'lower_bound' && p.lowerBound != null) return `${currencyPrefix}≥${fmtNum(p.lowerBound)}${unit}`;
  if (p.estimateShape === 'upper_bound' && p.upperBound != null) return `${currencyPrefix}≤${fmtNum(p.upperBound)}${unit}`;
  if (p.value != null) return `${currencyPrefix}${fmtNum(p.value)}${unit}`;
  return '—'; // structurally shouldn't happen (validateGrowthFact/validateMarketSizeFact would have flagged it invalid), never invents a number
}

// "Growth 8–9.5% CAGR · Home diagnostics · EU · 2025–2030" — never states a
// piece of context the payload doesn't actually carry (no "· unknown
// geography" filler).
export function factSummaryLine(fact: Pick<FactView, 'factType' | 'payload'>): string {
  const p = fact.payload;
  const kindLabel = fact.factType === 'growth' ? 'Growth' : 'Market size';
  const metricPart = p.metric && p.metric !== 'other' ? ` ${p.metric}` : '';
  const parts = [`${kindLabel} ${valuePart(fact)}${metricPart}`];
  if (p.marketDefinition) parts.push(p.marketDefinition);
  if (p.geography) parts.push(p.geography);
  if (fact.factType === 'growth' && p.periodStart != null && p.periodEnd != null) parts.push(`${p.periodStart}–${p.periodEnd}`);
  if (fact.factType === 'market_size' && p.asOfYear != null) parts.push(String(p.asOfYear));
  return parts.join(' · ');
}

const MISSING_LABEL: Record<string, string> = {
  marketDefinition: 'market', geography: 'geography', period: 'period', asOfYear: 'year',
  lowerBound: 'lower bound', upperBound: 'upper bound',
};

// "market, geography and period missing" — never a raw field key leaking
// into founder-facing copy.
export function missingFieldsLabel(missing: string[]): string {
  const labels = missing.map((m) => MISSING_LABEL[m] ?? m);
  if (labels.length === 0) return '';
  if (labels.length === 1) return `${labels[0]} missing`;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]} missing`;
}

const ZONE_LABEL: Record<FactZone, string> = {
  actionable: 'Market Intelligence',
  founder_reported: 'Founder-reported · unverified',
  incomplete: 'Incomplete',
  invalid: 'Audit — not shown elsewhere',
  conflicting: 'Conflicting sources',
};

export function zoneLabel(zone: FactZone): string {
  return ZONE_LABEL[zone];
}

const RETRIEVAL_LABEL: Record<string, string> = {
  vault_extraction: 'read from a document in your Vault',
  link_snapshot: 'read from a linked document',
  web_fetch: 'fetched from the web',
  manual_entry: 'entered manually',
};

export function retrievalMethodLabel(method: string): string {
  return RETRIEVAL_LABEL[method] ?? method;
}
