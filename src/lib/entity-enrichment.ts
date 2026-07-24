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

export const ENTITY_ENRICHMENT_FIELDS = [
  'website', 'email_domain', 'hq_city', 'hq_country', 'invests_in_geographies',
  'sectors', 'stage_min', 'stage_max', 'check_min_eur', 'check_max_eur', 'thesis', 'email', 'phone',
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

// Converts the model's raw string proposal into the correctly-typed value for
// the given entity field. Returns undefined when the value can't be coerced
// with confidence — the caller drops it rather than falling back to a guess.
export function coerceEnrichmentValue(field: EntityEnrichmentField, raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  if (field === 'sectors' || field === 'invests_in_geographies') {
    const list = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    return list.length ? list : undefined;
  }
  if (field === 'check_min_eur' || field === 'check_max_eur') {
    if (trimmed.includes('-')) return undefined;
    const n = Number(trimmed.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
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

// The full pipeline from raw model output to insert-ready rows: drop unknown
// field names, drop fields the entity already has, coerce the rest, drop
// anything that fails to coerce.
export function prepareEnrichmentProposals(entity: Entity, proposals: RawProposal[]): PreparedProposal[] {
  const out: PreparedProposal[] = [];
  for (const p of proposals) {
    if (!isKnownEntityField(p.field)) continue;
    if (entityHasValue(entity, p.field)) continue;
    const value = coerceEnrichmentValue(p.field, p.value);
    if (value === undefined) continue;
    out.push({ field: p.field, value, confidence: p.confidence, source_url: p.source_url });
  }
  return out;
}

// The subset of ENTITY_ENRICHMENT_FIELDS the entity already has a value for
// — told to the model as "don't bother re-proposing this."
export function knownEnrichmentValues(entity: Entity): Partial<Record<EntityEnrichmentField, unknown>> {
  const known: Partial<Record<EntityEnrichmentField, unknown>> = {};
  for (const f of ENTITY_ENRICHMENT_FIELDS) if (entityHasValue(entity, f)) known[f] = entity[f as keyof Entity];
  return known;
}

export function buildEntityEnrichmentPrompt(name: string, known: Partial<Record<EntityEnrichmentField, unknown>>): string {
  return [
    `Research the investment fund/firm "${name}" using real public web sources only`,
    "(the fund's own website, news coverage, interviews, portfolio pages). Never use LinkedIn as a source, and never scrape or quote private/gated content.",
    '',
    `Already known — do not re-propose these, only fill genuine gaps: ${JSON.stringify(known)}`,
    '',
    `Try to find real values for: ${ENTITY_ENRICHMENT_FIELDS.join(', ')}.`,
    '- sectors and invests_in_geographies: return a comma-separated list.',
    '- stage_min/stage_max: one of pre_seed, seed, series_a, later.',
    '- check_min_eur/check_max_eur: a plain number in EUR (convert if quoted in another currency; skip if you cannot find a real check-size range).',
    "- email/phone: only if genuinely public on the fund's own site — never invent, never guess a generic inbox.",
    'Skip any field you cannot find a real source for — do not guess or invent. Every proposal needs a real source_url you actually found it at.',
    'Finish by calling propose_fields with your findings.',
  ].join('\n');
}
