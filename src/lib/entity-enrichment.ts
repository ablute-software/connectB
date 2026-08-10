// Single-entity investor enrichment — the real fix behind "Request more info"
// (previously a stub that only wrote a demand-flag; see DECISIONS.md). Pure,
// I/O-free logic: the AI route (src/app/api/entities/[id]/enrich) calls the
// model with a real web-search tool (same mechanism as the back-office's
// §6b-3 "Research with AI"), then hands the raw string proposals here to be
// validated, coerced to the entity's actual field types, and filtered.
//
// Anti-hallucination + non-clobbering guarantees enforced HERE, not just in
// the prompt: a field the entity already has is dropped before it's even
// proposed (never overwrites founder-entered data), an unrecognised field
// name is dropped (never writes an arbitrary column), and a value that
// doesn't coerce cleanly is dropped rather than guessed. Every field that
// survives is written by the caller as an UNCONFIRMED contributions row
// (source:'ai', status:'submitted') — never applied to the entity directly.
import type { Entity, Stage } from './types';

// The fields the live AI enrichment route actually asks the model to search
// for (buildEntityEnrichmentPrompt below) — kept as its own constant so
// widening the write-allowlist for the confidence-routed external-research
// import (migration 0032, see DECISIONS.md) never silently expands what the
// AI route itself goes looking for. Contact-sensitive fields like GP emails
// only ever get a structured column from a human-run research pass with its
// own "never guess a pattern-based email" instruction — not from Anthropic's
// web search.
export const AI_SEARCH_FIELDS = [
  'website', 'email_domain', 'hq_city', 'hq_country', 'invests_in_geographies',
  'sectors', 'stage_min', 'stage_max', 'check_min_eur', 'check_max_eur', 'thesis', 'email', 'phone',
] as const;

// The full write-allowlist: every field any promotion path (AI proposal,
// founder "+ Add info", or the confidence-routed external-research import)
// is ever allowed to write onto an entity. Unknown field names are always
// rejected (isKnownEntityField) — this is the single list that decides that,
// for every writer.
export const ENTITY_ENRICHMENT_FIELDS = [
  ...AI_SEARCH_FIELDS,
  'address', 'postal_code', 'key_people', 'general_partner_emails',
  'aum', 'current_funds', 'latest_fund', 'last_investment_found',
  // 'name' is deliberately last and NOT in AI_SEARCH_FIELDS — the AI route
  // must never propose a rename. Real gap found via a lote4 rebrand
  // (btov Partners -> b2venture) that could never be applied: the write-
  // allowlist didn't recognise 'name' at all. Fixed, but narrowly: it's the
  // dedup/matching key for every other script and process in this codebase,
  // so resolveEntityFieldWrite below refuses it outright unless the caller
  // is an explicit `correction`, never a `fill` — see the dedicated check
  // there. No amount of bulk/auto-review tooling should ever touch it.
  'name',
] as const;
export type EntityEnrichmentField = typeof ENTITY_ENRICHMENT_FIELDS[number];

export interface RawProposal { field: string; value: string; confidence: number; source_url: string }
export interface PreparedProposal { field: EntityEnrichmentField; value: unknown; confidence: number; source_url: string }

export function isKnownEntityField(field: string): field is EntityEnrichmentField {
  return (ENTITY_ENRICHMENT_FIELDS as readonly string[]).includes(field);
}

const STAGE_VALUES: readonly Stage[] = ['pre_seed', 'seed', 'series_a', 'later'];
// Common phrasings a model might use instead of our exact enum spelling.
const STAGE_ALIASES: Record<string, Stage> = {
  'pre-seed': 'pre_seed', preseed: 'pre_seed', 'pre seed': 'pre_seed',
  seed: 'seed',
  'series a': 'series_a', 'series-a': 'series_a', seriesa: 'series_a',
  later: 'later', 'later stage': 'later', growth: 'later', 'series b+': 'later', 'series b': 'later',
};

// Converts a proposal's raw value into the correctly-typed value for the
// given entity field. Accepts either a raw model string (the AI-proposal
// path) or an already-typed jsonb value (the promotion path, reading a
// value back out of a stored `contributions` row — sectors/geographies may
// already be an array, check sizes already a number). Returns undefined when
// the value can't be coerced with confidence — the caller drops it rather
// than falling back to a guess.
export function coerceEnrichmentValue(field: EntityEnrichmentField, raw: unknown): unknown {
  if (field === 'sectors' || field === 'invests_in_geographies') {
    if (Array.isArray(raw)) {
      const list = raw.map((s) => String(s).trim()).filter(Boolean);
      return list.length ? list : undefined;
    }
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const list = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    return list.length ? list : undefined;
  }
  if (field === 'check_min_eur' || field === 'check_max_eur') {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : undefined;
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.includes('-')) return undefined;
    const n = Number(trimmed.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (field === 'stage_min' || field === 'stage_max') {
    const norm = trimmed.toLowerCase();
    if ((STAGE_VALUES as readonly string[]).includes(norm)) return norm as Stage;
    return STAGE_ALIASES[norm];
  }
  return trimmed;
}

// True when the entity already holds a value for this field. An accepted
// proposal must never silently overwrite founder-entered data, so a field
// the entity already has is dropped from what we even propose.
export function entityHasValue(entity: Entity, field: EntityEnrichmentField): boolean {
  const v = entity[field as keyof Entity];
  if (Array.isArray(v)) return v.length > 0;
  return v != null && v !== '';
}

// The single-field counterpart to prepareEnrichmentProposals, used when a
// contribution is promoted after the fact (marked 'verified' in the founder
// or back-office review UI) rather than at initial proposal time. Same three
// guarantees, applied to one field instead of a batch: unknown field names
// are rejected, a field the entity already holds is never overwritten, and a
// value that fails to coerce is dropped. Returns null when nothing should be
// written — the caller then just leaves the contribution's status as-is
// without touching the entity.
// opts.allowOverwrite bypasses the "already has a value" check for this one
// call — used ONLY by the explicit `correction`-kind contribution path
// (contribution-promotion.ts), never by a normal fill-empty proposal. The
// bypass is scoped to exactly the field being resolved here; it grants no
// broader overwrite permission anywhere else in the write pipeline.
export function resolveEntityFieldWrite(entity: Entity, field: string, rawValue: unknown, opts?: { allowOverwrite?: boolean }): { field: EntityEnrichmentField; value: unknown } | null {
  if (!isKnownEntityField(field)) return null;
  // 'name' is the dedup/matching key everywhere else in this codebase —
  // never write it as a plain fill (entities.name is effectively always
  // set, so this rarely bites in practice, but the guard is explicit rather
  // than relying on that incidental fact). Only an explicit correction can
  // rename an entity, and even then only through the reviewed contribution
  // path this function serves — never proposed/applied automatically.
  if (field === 'name' && !opts?.allowOverwrite) return null;
  if (!opts?.allowOverwrite && entityHasValue(entity, field)) return null;
  const value = coerceEnrichmentValue(field, rawValue);
  if (value === undefined) return null;
  return { field, value };
}

// The full pipeline from raw model output to insert-ready rows: drop unknown
// field names, drop fields the entity already has, coerce the rest, drop
// anything that fails to coerce.
export function prepareEnrichmentProposals(entity: Entity, proposals: RawProposal[]): PreparedProposal[] {
  const out: PreparedProposal[] = [];
  for (const p of proposals) {
    const resolved = resolveEntityFieldWrite(entity, p.field, p.value);
    if (!resolved) continue;
    out.push({ field: resolved.field, value: resolved.value, confidence: p.confidence, source_url: p.source_url });
  }
  return out;
}

// The subset of ENTITY_ENRICHMENT_FIELDS the entity already has a value for
// — told to the model as "don't bother re-proposing this." Excludes 'name':
// it's the subject of the research itself (always known, never a fact the
// AI route could propose — it's not in AI_SEARCH_FIELDS), so including it
// here would just be noise, not a useful "don't re-propose" hint.
export function knownEnrichmentValues(entity: Entity): Partial<Record<EntityEnrichmentField, unknown>> {
  const known: Partial<Record<EntityEnrichmentField, unknown>> = {};
  for (const f of ENTITY_ENRICHMENT_FIELDS) if (f !== 'name' && entityHasValue(entity, f)) known[f] = entity[f as keyof Entity];
  return known;
}

// Prompt 146 §2 — a field/value a human already reviewed and rejected is
// know-how, not just a struck-through row in the UI: without this, "Request
// more info" had no memory and could re-surface the exact same rejected
// value on the next run. Kept as a loosely-typed shape here (rather than
// importing contribution-promotion.ts's row type) to avoid entity-enrichment
// <-> contribution-promotion becoming a circular import — contribution-promotion.ts
// already imports resolveEntityFieldWrite from this file.
export interface RejectedEnrichmentFact { field: string; value: unknown; reviewer_notes?: string | null }

export function buildEntityEnrichmentPrompt(name: string, known: Partial<Record<EntityEnrichmentField, unknown>>, rejected: RejectedEnrichmentFact[] = []): string {
  const rejectedBlock = rejected.length === 0 ? [] : [
    '',
    'Previously suggested and rejected by a human — do not repropose these unless you have new, materially different evidence:',
    ...rejected.map((r) => `- ${r.field}: "${String(r.value)}"${r.reviewer_notes ? ` (reviewer note: ${r.reviewer_notes})` : ''}`),
  ];
  return [
    `Research the investment fund/firm "${name}" using real public web sources only`,
    "(the fund's own website, news coverage, interviews, portfolio pages). Never use LinkedIn as a source, and never scrape or quote private/gated content.",
    '',
    `Already known — do not re-propose these, only fill genuine gaps: ${JSON.stringify(known)}`,
    ...rejectedBlock,
    '',
    `Try to find real values for: ${AI_SEARCH_FIELDS.join(', ')}.`,
    '- sectors and invests_in_geographies: return a comma-separated list.',
    '- stage_min/stage_max: one of pre_seed, seed, series_a, later.',
    '- check_min_eur/check_max_eur: a plain number in EUR (convert if quoted in another currency; skip if you cannot find a real check-size range).',
    "- email/phone: only if genuinely public on the fund's own site — never invent, never guess a generic inbox.",
    'Skip any field you cannot find a real source for — do not guess or invent. Every proposal needs a real source_url you actually found it at.',
    'Finish by calling propose_fields with your findings.',
  ].join('\n');
}
