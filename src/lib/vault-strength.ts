// Prompt 374 §G — the Vault-strength barometer ("a importância das pistas,
// na perspectiva do Sherlock"). Purely mechanical, exactly like
// action-plan.ts's own dataroomChecklist — no AI, everything explainable at
// a click. Four independent components, composed into one 0-1 score:
//
//   quantity   — diminishing returns: the 3rd document counts far more than
//                the 30th (a straight document count would let a founder
//                "win" by uploading noise).
//   variety    — how many of the standard due-diligence categories
//                (dataroomChecklist, action-plan.ts — the SAME 9-item list
//                the adjacent "Data Room completeness" card already uses,
//                deliberately not a fourth, competing taxonomy) have at
//                least one document.
//   importance — external, third-party-verifiable proof (a signed contract,
//                an LOI, a patent, a certification) outweighs a structured
//                internal document (a financial model, a business plan),
//                which outweighs a deck/summary/one-pager.
//   freshness  — a document that would otherwise carry real weight (proof
//                or a structured internal document) loses some of it once
//                it's stale (>12 months) — a fact still true a year ago
//                isn't the same as one true today.
//
// This composition is deliberately just ONE plausible mechanical model, not
// a calibrated formula — the fixture requirement (10 CVs score below 1 CV +
// 1 contract + 1 patent) is the actual behavioral contract; the exact
// weights below satisfy it and are trivially retunable without changing the
// shape of the thing.
import { dataroomChecklist } from './action-plan';

export type ImportanceTier = 'external_proof' | 'structured_internal' | 'summary';

// Keyword-based, same mechanical style as dataroomChecklist's own hasDoc —
// grosseiro por escolha (see company-claims.ts's NAMED_ENTITY comment for
// the same tradeoff elsewhere in this codebase): a document this misjudges
// only shifts one component of an internal-only signal, never blocks or
// hides anything from an investor.
const EXTERNAL_PROOF_KEYWORDS = /\b(contract|agreement|loi|letter of intent|patent|trademark|certificat|licen[sc]e|award|purchase order)\b/i;
const STRUCTURED_INTERNAL_KEYWORDS = /\b(financial model|projections?|business plan|cap table|capitalization|budget|roadmap)\b/i;

export function classifyDocumentImportance(name: string): ImportanceTier {
  if (EXTERNAL_PROOF_KEYWORDS.test(name)) return 'external_proof';
  if (STRUCTURED_INTERNAL_KEYWORDS.test(name)) return 'structured_internal';
  return 'summary';
}

export const IMPORTANCE_WEIGHT: Record<ImportanceTier, number> = {
  external_proof: 1, structured_internal: 0.6, summary: 0.3,
};

// The diminishing-returns curve: each document's marginal contribution is
// 1/its rank (the 3rd document contributes a third as much as it would
// standalone; the 30th, a thirtieth) — summed and normalized against the
// same sum at a 10-document cap, where the component reaches its max.
function harmonic(n: number): number {
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += 1 / i;
  return sum;
}
const QUANTITY_CAP = 10;
const QUANTITY_NORM = harmonic(QUANTITY_CAP);

export function quantityScore(documentCount: number): number {
  if (documentCount <= 0) return 0;
  return Math.min(1, harmonic(documentCount) / QUANTITY_NORM);
}

export function varietyScore(folders: { name: string }[], documents: { name: string }[]): number {
  const checklist = dataroomChecklist(folders, documents);
  if (checklist.length === 0) return 0;
  return checklist.filter((c) => c.present).length / checklist.length;
}

export function importanceScore(documents: { name: string }[]): number {
  if (documents.length === 0) return 0;
  const total = documents.reduce((sum, d) => sum + IMPORTANCE_WEIGHT[classifyDocumentImportance(d.name)], 0);
  return total / documents.length;
}

const FRESH_MONTHS = 12;
const STALE_FLOOR = 0.5;
const STALE_DECAY_MONTHS = 24;

function ageInMonths(createdAt: string, now: Date): number {
  const created = new Date(createdAt);
  return Math.max(0, (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
}

// A document past 12 months loses weight linearly, floored at 0.5 (stale
// proof is still worth something — investors can date-check it themselves —
// just not as much as fresh proof).
function freshnessMultiplier(ageMonths: number): number {
  if (ageMonths <= FRESH_MONTHS) return 1;
  return Math.max(STALE_FLOOR, 1 - (ageMonths - FRESH_MONTHS) / STALE_DECAY_MONTHS);
}

// Weighted by importance: an aging one-pager barely matters, an aging
// signed contract does — the same document weight the importance component
// already computed, reused here rather than a second, independent scale.
export function freshnessScore(documents: { name: string; created_at?: string | null }[], now: Date): number {
  const dated = documents.filter((d): d is { name: string; created_at: string } => !!d.created_at);
  if (dated.length === 0) return 1;
  let weightSum = 0;
  let weighted = 0;
  for (const d of dated) {
    const w = IMPORTANCE_WEIGHT[classifyDocumentImportance(d.name)];
    weightSum += w;
    weighted += w * freshnessMultiplier(ageInMonths(d.created_at, now));
  }
  return weightSum === 0 ? 1 : weighted / weightSum;
}

export type VaultStrengthLabel = 'Thin' | 'Reasonable' | 'Strong' | 'Compelling';

export function vaultStrengthLabel(overall: number): VaultStrengthLabel {
  if (overall < 0.3) return 'Thin';
  if (overall < 0.5) return 'Reasonable';
  if (overall < 0.75) return 'Strong';
  return 'Compelling';
}

export interface VaultStrength {
  quantity: number; variety: number; importance: number; freshness: number;
  overall: number; label: VaultStrengthLabel;
}

// Weights are the one place "how much each component matters" is decided —
// variety+importance carry more than raw quantity on purpose (the whole
// point of this barometer, per the fixture requirement in its header).
const WEIGHTS = { quantity: 0.2, variety: 0.35, importance: 0.35, freshness: 0.1 };

export function vaultStrength(
  folders: { name: string }[], documents: { name: string; created_at?: string | null }[], now: Date,
): VaultStrength {
  const quantity = quantityScore(documents.length);
  const variety = varietyScore(folders, documents);
  const importance = importanceScore(documents);
  const freshness = freshnessScore(documents, now);
  const overall = quantity * WEIGHTS.quantity + variety * WEIGHTS.variety
    + importance * WEIGHTS.importance + freshness * WEIGHTS.freshness;
  return { quantity, variety, importance, freshness, overall, label: vaultStrengthLabel(overall) };
}

// Prompt 374 §G — "a frase que interessa ao founder": the single next
// document that would move the needle most. Missing checklist categories
// beat everything else (variety+importance are the two heaviest weights,
// and a missing category means BOTH are being left on the table at once);
// among those, categories whose own label already names external,
// verifiable proof are surfaced first — exactly the "a patent or a signed
// contract is worth more than three more decks" framing from the prompt.
const HIGH_LEVERAGE_MISSING_ORDER = [
  'Commercial evidence (LOIs, pilots, contracts)',
  'IP (patents / trademarks)',
  'Regulatory & compliance',
  'Cap table',
  'Financial model / projections',
];

export function topVaultSuggestion(
  folders: { name: string }[], documents: { name: string; created_at?: string | null }[], now: Date,
): string {
  const checklist = dataroomChecklist(folders, documents);
  const missing = checklist.filter((c) => !c.present).map((c) => c.label);
  if (missing.length > 0) {
    const best = HIGH_LEVERAGE_MISSING_ORDER.find((label) => missing.includes(label)) ?? missing[0];
    return `Adding "${best}" would raise your Vault's strength more than several more decks or summaries would.`;
  }
  const critical = documents.filter((d) => classifyDocumentImportance(d.name) !== 'summary' && d.created_at);
  const stalest = critical
    .map((d) => ({ d, age: ageInMonths(d.created_at as string, now) }))
    .filter((x) => x.age > FRESH_MONTHS)
    .sort((a, b) => b.age - a.age)[0];
  if (stalest) {
    return `"${stalest.d.name}" is over a year old — a refreshed version would carry more weight than a new document.`;
  }
  return 'Your Vault already covers the essentials — nothing specific stands out right now.';
}
