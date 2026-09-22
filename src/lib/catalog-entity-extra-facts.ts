// Prompt 662 §3 (Nuno, 22/09) — catalog_entities.extra_facts holds the real
// investor facts the schema has no column for (warm_intro_required,
// decision_time, business_model, ...). This is the ONE place the set of
// allowed keys is named, so an importer for lote 03 — or lote 04, or the
// next geography — can never invent a second name for the same fact the
// way the 75-column ENTIDADES sheet's own ~45 unmapped columns would
// otherwise invite.
//
// Completed 22/09 against the real enriquecimento_investidores_espanha_
// lote_03.xlsx (received after this module's first cut, which only had the
// 21 fields Prompt 662 §3 named as examples). ENTIDADES has 75 columns;
// AUDITORIA_CAMPOS tracks a per-field status for exactly 56 of them (the
// ones treated as real investor facts to verify — the other 19 are the
// research process's own bookkeeping: research_key, FIT_ABLUTE,
// ACTIONABILITY, recommendation, hard_gates, next_action, research_status,
// score_rationale, avoid, cleanup_action, the four coverage_* fields,
// nonpublic_fields, conflict_fields, sources_searched, confidence_0_1,
// verified_at — never written here or anywhere in catalog_entities; several
// of them (FIT_ABLUTE, ACTIONABILITY, recommendation, hard_gates,
// next_action) are one customer's own fit assessment of an investor, not a
// fact about the investor, and writing them to this SHARED catalog would
// leak one customer's private read into every other customer's view of the
// same row — the same boundary Prompt 692 exists to protect elsewhere).
// Of the 56 audited fields, these 30 have a real catalog_entities column
// (canonical_url->website, entity_type->type, headquarters->hq_city/
// hq_country, general_email->email, phone, address, pitch_form->
// submission_channel, submission_status->submission_channel_type, sectors,
// stage->stage_min/max, geography->geographies, aum, fund_size->
// current_funds, vehicle->latest_fund, strategy/activity/criteria->thesis,
// best_person/second_person->key_people, pitch_email->
// general_partner_emails, offices (folded into notes beyond the first)) —
// everything else audited lands here.
export const CATALOG_ENTITY_EXTRA_FACT_KEYS = [
  'warm_intro_required', 'decision_time', 'decision_model', 'company_age_limit',
  'territorial_restrictions', 'traction_threshold', 'commercial_maturity', 'follow_on',
  'lead_colead', 'available_capacity', 'investment_period', 'first_close', 'final_close',
  'vintage', 'comparables', 'manufacturing_requirements', 'business_model',
  'university_affiliation', 'subverticals', 'documents', 'process',
  'aliases', 'former_name', 'fund_structure', 'hardware_software', 'managed_by',
  'parent_entity', 'reimbursement_requirement',
  // Normally-mapped fields, allowed here too: only used when AUDITORIA_
  // CAMPOS marks that exact (entity, field) CONFLICT — two sources
  // disagree on the number itself, so it is never written to the real
  // check_min_eur/check_max_eur or commercial_maturity-adjacent reasoning
  // as if resolved (662 §5 rule 2: "an importer that picks 'the latest'
  // invents a fact"). Lote 03's own case: CRB's initial_ticket.
  'initial_ticket',
  // stage has a real destination (stage_min/stage_max) but only via a
  // word-list parse this module hasn't verified against lote 03's own free
  // text ("Pre-seed a Series A", "Seed/Series A; tecnologia validada...") —
  // parked here rather than guessing a mapping, same posture as initial_
  // ticket above.
  'stage',
  // The rest of the normally-mapped fields, allowed here for the same
  // per-entity reason as initial_ticket: AUDITORIA_CAMPOS can mark any one
  // of them NOT_PUBLIC/CONFLICT/CONDITIONAL for a *specific* entity even
  // though the field maps cleanly everywhere else — lote 03's own cases
  // include address, submission_status, pitch_email, pitch_form, aum,
  // fund_size. A field lands here only when its own audited status for
  // that entity isn't FOUND; otherwise it goes to its real column as
  // usual, never both.
  'address', 'submission_status', 'pitch_email', 'pitch_form', 'aum', 'fund_size',
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
