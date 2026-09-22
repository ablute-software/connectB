// Prompt 662 §3 (Nuno, 22/09) — catalog_entities.extra_facts holds the real
// investor facts the schema has no column for (warm_intro_required,
// decision_time, business_model, ...). This is the ONE place the set of
// allowed keys is named, so an importer for lote 03 — or lote 04, or the
// next geography — can never invent a second name for the same fact the
// way the 75-column ENTIDADES sheet's own ~45 unmapped columns would
// otherwise invite.
//
// Known gap, stated plainly: Prompt 662 §3 names 21 of the "~33 real
// investor facts without a column" as examples, not as the complete list —
// the remaining ~12 are somewhere in the 75 ENTIDADES columns this module
// has not seen. Adding them here requires reading the actual
// enriquecimento_investidores_espanha_lote_03.xlsx (not received with the
// prompt as of 22/09) rather than guessing plausible-sounding names, which
// is exactly the failure mode this registry exists to prevent.
export const CATALOG_ENTITY_EXTRA_FACT_KEYS = [
  'warm_intro_required', 'decision_time', 'decision_model', 'company_age_limit',
  'territorial_restrictions', 'traction_threshold', 'commercial_maturity', 'follow_on',
  'lead_colead', 'available_capacity', 'investment_period', 'first_close', 'final_close',
  'vintage', 'comparables', 'manufacturing_requirements', 'business_model',
  'university_affiliation', 'subverticals', 'documents', 'process',
] as const;

export type CatalogEntityExtraFactKey = typeof CATALOG_ENTITY_EXTRA_FACT_KEYS[number];

export function isCatalogEntityExtraFactKey(key: string): key is CatalogEntityExtraFactKey {
  return (CATALOG_ENTITY_EXTRA_FACT_KEYS as readonly string[]).includes(key);
}

// known: value is real and confirmed. not_public / conflict: value is
// whatever a source proposed, but the fact itself is unresolved — never
// collapse either into a bare null (that erases "already looked") or into
// "the latest source wins" (that invents a fact CONFLICT explicitly refuses
// to pick). conditional: proposed but not yet authorised to apply — the
// existing_entity_id / pipeline_status usage from the file, generalised.
export const CATALOG_ENTITY_EXTRA_FACT_STATUSES = ['known', 'not_public', 'conflict', 'conditional'] as const;
export type CatalogEntityExtraFactStatus = typeof CATALOG_ENTITY_EXTRA_FACT_STATUSES[number];

export interface CatalogEntityExtraFact {
  value: string | number | boolean | null;
  status: CatalogEntityExtraFactStatus;
  source: string | null;
  checked_at: string | null;
  note: string | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Structural validation only (shape + status enum) — not a value-type check
// per key, since the registry doesn't (yet) declare an expected type per
// fact. Returns null for anything that doesn't already match the shape,
// same "reject, don't coerce a guess" posture as sanitizeMarketThesisText's
// neighbours in this codebase use for founder input, applied here to
// importer input instead.
export function sanitizeCatalogEntityExtraFact(raw: unknown): CatalogEntityExtraFact | null {
  if (!isPlainObject(raw)) return null;
  const status = raw.status;
  if (typeof status !== 'string' || !(CATALOG_ENTITY_EXTRA_FACT_STATUSES as readonly string[]).includes(status)) return null;
  const value = raw.value;
  if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    value,
    status: status as CatalogEntityExtraFactStatus,
    source: str(raw.source),
    checked_at: str(raw.checked_at),
    note: str(raw.note),
  };
}

// Builds the merge payload for the same jsonb `||` upsert pattern
// verified_fields already uses in SQL (catalog_entity_apply_field and
// friends) — only registry keys survive; everything else is dropped
// silently here so an importer's typo doesn't create a permanent unknown
// key with no reader. Call sites that need to know what was dropped should
// diff their own input against isCatalogEntityExtraFactKey themselves.
export function buildCatalogEntityExtraFactsPatch(
  facts: Partial<Record<string, unknown>>,
): Partial<Record<CatalogEntityExtraFactKey, CatalogEntityExtraFact>> {
  const patch: Partial<Record<CatalogEntityExtraFactKey, CatalogEntityExtraFact>> = {};
  for (const [key, raw] of Object.entries(facts)) {
    if (!isCatalogEntityExtraFactKey(key)) continue;
    const sanitized = sanitizeCatalogEntityExtraFact(raw);
    if (sanitized) patch[key] = sanitized;
  }
  return patch;
}
