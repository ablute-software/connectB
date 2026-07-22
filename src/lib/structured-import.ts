// IRM_SPEC §9b — real-file import annex. Unlike the generic §9 importer
// (src/app/api/import/extract, AI-extracted loose jsonb for unknown-shaped
// files), this handles the KNOWN, authoritative entities.csv/people.csv/
// interactions.csv shape directly — no AI extraction needed, parsed and
// matched deterministically so the result is reproducible and auditable.
// Pure functions only (no I/O) so both the API routes and a one-off script
// can share the exact same logic.
import { normalizeName, normalizeDomain } from './catalog-dedupe';

// ---------- CSV parsing (RFC4180-ish: quoted fields, doubled-quote escape) ----------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function toRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const pipe = (v: string): string[] => (v.trim() ? v.split('|').map((x) => x.trim()).filter(Boolean) : []);
const orUndef = (v: string): string | undefined => {
  const t = v.trim();
  return !t || t === 'UNKNOWN' ? undefined : t;
};
const num = (v: string): number | undefined => {
  const t = v.trim();
  return t ? Number(t) : undefined;
};
const bool = (v: string): boolean => ['yes', 'true', '1'].includes(v.trim().toLowerCase());

// The `stage` enum only has pre_seed/seed/series_a/later — no series_b+.
// Real files describe funds by their actual stage range, which sometimes
// goes further than the app's own bucket granularity; anything past
// series_a folds into 'later' rather than failing the insert.
const VALID_STAGES = new Set(['pre_seed', 'seed', 'series_a', 'later']);
function normalizeStage(v: string): string | undefined {
  const t = orUndef(v);
  if (!t) return undefined;
  return VALID_STAGES.has(t) ? t : 'later';
}

export interface EntityCsvRow {
  name: string; type: string; hq_city?: string; hq_country?: string;
  invests_in_geographies: string[]; website?: string; website_verified: boolean;
  email_domain?: string; email_domain_verified: boolean; submission_channel?: string;
  stage_min?: string; stage_max?: string; check_min_eur?: number; check_max_eur?: number;
  sectors: string[]; hardware_stance?: string; is_sector_agnostic?: boolean; thesis?: string;
  fit_score?: string; wave?: number; our_angle?: string; hard_filter?: string;
  hard_filter_status?: string; status?: string; last_verified?: string; source_url?: string;
}

export function parseEntitiesCsv(text: string): EntityCsvRow[] {
  return toRecords(text).map((r) => ({
    name: r.name.trim(),
    type: r.type.trim(),
    hq_city: orUndef(r.hq_city), hq_country: orUndef(r.hq_country),
    invests_in_geographies: pipe(r.invests_in_geographies),
    website: orUndef(r.website), website_verified: bool(r.website_verified),
    email_domain: orUndef(r.email_domain), email_domain_verified: bool(r.email_domain_verified),
    submission_channel: orUndef(r.official_submission_channel),
    stage_min: normalizeStage(r.stage_min), stage_max: normalizeStage(r.stage_max),
    check_min_eur: num(r.check_min_eur), check_max_eur: num(r.check_max_eur),
    sectors: pipe(r.sectors), hardware_stance: orUndef(r.hardware_stance),
    is_sector_agnostic: r.is_sector_agnostic.trim() ? bool(r.is_sector_agnostic) : undefined,
    thesis: orUndef(r.thesis), fit_score: orUndef(r.fit_score), wave: num(r.wave),
    our_angle: orUndef(r.our_angle), hard_filter: orUndef(r.hard_filter),
    hard_filter_status: orUndef(r.hard_filter_status), status: orUndef(r.status),
    last_verified: orUndef(r.last_verified), source_url: orUndef(r.source_url),
  }));
}

export interface PersonCsvRow {
  entity_name: string; full_name: string; role?: string; seniority_rank: number;
  based_in?: string; linkedin_url?: string; linkedin_verified: boolean;
  email_verified?: string; email_guess?: string; email_source?: string;
  background?: string; hook?: string; hook_status?: string; kill_words: string[];
  do_not_contact: boolean; notes?: string;
}

export function parsePeopleCsv(text: string): PersonCsvRow[] {
  return toRecords(text).map((r) => ({
    entity_name: r.entity_name.trim(), full_name: r.full_name.trim(),
    role: orUndef(r.role), seniority_rank: num(r.seniority_rank) ?? 1,
    based_in: orUndef(r.based_in), linkedin_url: orUndef(r.linkedin_url),
    linkedin_verified: bool(r.linkedin_verified),
    email_verified: orUndef(r.email_verified), email_guess: orUndef(r.email_guess),
    email_source: orUndef(r.email_source), background: orUndef(r.background),
    hook: orUndef(r.hook), hook_status: orUndef(r.hook_status), kill_words: pipe(r.kill_words),
    do_not_contact: bool(r.do_not_contact), notes: orUndef(r.notes),
  }));
}

export interface InteractionCsvRow {
  entity_name: string; person_name?: string; occurred_at?: string;
  direction: 'out' | 'in'; channel?: string; content: string;
  classification?: string; pass_reason?: string; next_action?: string; next_action_due?: string;
}

export function parseInteractionsCsv(text: string): InteractionCsvRow[] {
  return toRecords(text).map((r) => ({
    entity_name: r.entity_name.trim(), person_name: orUndef(r.person_name),
    occurred_at: orUndef(r.occurred_at), direction: (r.direction.trim() as 'out' | 'in') || 'out',
    channel: orUndef(r.channel), content: r.content.trim(),
    classification: orUndef(r.classification), pass_reason: orUndef(r.pass_reason),
    next_action: orUndef(r.next_action), next_action_due: orUndef(r.next_action_due),
  }));
}

// ---------- Matching ----------

export type MatchStatus = 'new' | 'matched' | 'conflict';

export interface MatchCandidate { id: string; name: string; score: number }

const MIN_CONTAINMENT_LEN = 6;
// The shorter normalized name must be a substantial fraction of the longer
// one — a bare "portugal" (8 chars) sitting inside "investors portugal"
// (19 chars, a COMPLETELY different real-world entity) is exactly the false
// positive this ratio exists to block. Found live against ablute_'s own
// pipeline: "Investors Portugal" (new, an angel network) was wrongly
// proposed as a match for the existing "Portugal Ventures" (an unrelated
// VC fund) before this ratio was added — see DECISIONS.md.
const MIN_CONTAINMENT_RATIO = 0.6;

// Reused for both entities (name+website) and, loosely, for any "is this
// the same real-world thing" name comparison. Tiered: exact normalized name
// or matching website domain is a confident match; one normalized name
// containing the other (e.g. "speedinvest" / "speedinvest health") is a
// weaker signal surfaced for the founder to confirm, not auto-applied — and
// only counts at all once the ratio guard above rules out generic-word
// coincidences.
export function matchEntities(
  existing: { id: string; name: string; website?: string }[],
  csvRow: { name: string; website?: string },
): { status: MatchStatus; candidates: MatchCandidate[] } {
  const targetName = normalizeName(csvRow.name);
  const targetDomain = normalizeDomain(csvRow.website);

  const scored = existing.map((e) => {
    const n = normalizeName(e.name);
    const d = normalizeDomain(e.website);
    let score = 0;
    if (targetDomain && d && targetDomain === d) score = Math.max(score, 90);
    if (n === targetName) score = Math.max(score, 100);
    else if (n.length >= MIN_CONTAINMENT_LEN && targetName.length >= MIN_CONTAINMENT_LEN
      && (n.includes(targetName) || targetName.includes(n))
      && Math.min(n.length, targetName.length) / Math.max(n.length, targetName.length) >= MIN_CONTAINMENT_RATIO) {
      score = Math.max(score, 60);
    }
    return { id: e.id, name: e.name, score };
  }).filter((c) => c.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: 'new', candidates: [] };
  const top = scored[0].score;
  const tiedAtTop = scored.filter((c) => c.score === top);
  if (tiedAtTop.length > 1) return { status: 'conflict', candidates: scored };
  return { status: top >= 60 ? 'matched' : 'new', candidates: scored };
}

function normalizeLinkedin(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return url.trim().toLowerCase().replace(/\/$/, '') || null;
  }
}

export function matchPerson(
  existing: { id: string; full_name: string; linkedin_url?: string; email_verified?: string }[],
  csvRow: { full_name: string; linkedin_url?: string; email_verified?: string },
): { status: MatchStatus; candidates: MatchCandidate[] } {
  const targetLinkedin = normalizeLinkedin(csvRow.linkedin_url);
  const targetEmail = csvRow.email_verified?.trim().toLowerCase();
  const targetName = normalizeName(csvRow.full_name);

  const scored = existing.map((p) => {
    let score = 0;
    if (targetLinkedin && normalizeLinkedin(p.linkedin_url) === targetLinkedin) score = Math.max(score, 100);
    if (targetEmail && p.email_verified?.trim().toLowerCase() === targetEmail) score = Math.max(score, 95);
    if (normalizeName(p.full_name) === targetName) score = Math.max(score, 80);
    return { id: p.id, name: p.full_name, score };
  }).filter((c) => c.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: 'new', candidates: [] };
  const top = scored[0].score;
  const tiedAtTop = scored.filter((c) => c.score === top);
  if (tiedAtTop.length > 1) return { status: 'conflict', candidates: scored };
  return { status: 'matched', candidates: scored };
}

// ---------- Field-level merge, "never blind-overwrite" ----------

// Some enum columns default to a placeholder on creation (not_contacted /
// not_applicable) — that default isn't a founder-asserted fact, so treat it
// as "empty" for merge purposes on BOTH sides. Everything else uses plain
// empty/undefined/[] as the "no real value yet" test.
const FIELD_DEFAULTS: Record<string, unknown> = {
  status: 'not_contacted',
  hard_filter_status: 'not_applicable',
};

function isEmptyValue(field: string, v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (field in FIELD_DEFAULTS && v === FIELD_DEFAULTS[field]) return true;
  return false;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x) => b.includes(x));
  return a === b;
}

export interface FieldDiff { field: string; existing: unknown; incoming: unknown; conflict: boolean }

// Returns the patch to apply (only fields that should actually change) plus
// the list of real conflicts (both sides non-empty and different) that the
// staging UI should surface — those fields are DELIBERATELY left out of the
// patch (existing wins) until a human picks a side.
export function mergeFields(
  existing: Record<string, unknown>, incoming: Record<string, unknown>,
): { patch: Record<string, unknown>; conflicts: FieldDiff[] } {
  const patch: Record<string, unknown> = {};
  const conflicts: FieldDiff[] = [];
  for (const field of Object.keys(incoming)) {
    const inVal = incoming[field];
    const exVal = existing[field];
    const inEmpty = isEmptyValue(field, inVal);
    const exEmpty = isEmptyValue(field, exVal);
    if (inEmpty) continue; // nothing new to offer
    if (exEmpty) { patch[field] = inVal; continue; } // fill the gap
    if (valuesEqual(exVal, inVal)) continue; // already the same
    conflicts.push({ field, existing: exVal, incoming: inVal, conflict: true });
  }
  return { patch, conflicts };
}

// email_verified is sacred: never derived from email_guess, never
// overwritten by a guess. Kept separate from the generic mergeFields email
// handling by simply never passing email_guess into the "verified" slot.
export function personEmailPatch(existing: { email_verified?: string; email_guess?: string }, incoming: PersonCsvRow) {
  const patch: Record<string, unknown> = {};
  if (!existing.email_verified && incoming.email_verified) patch.email_verified = incoming.email_verified;
  if (!existing.email_guess && !existing.email_verified && incoming.email_guess) patch.email_guess = incoming.email_guess;
  return patch;
}

// ---------- Full plan ----------

export interface ExistingEntity { id: string; name: string; website?: string; [k: string]: unknown }
export interface ExistingPerson { id: string; entity_id: string; full_name: string; linkedin_url?: string; email_verified?: string; [k: string]: unknown }
export interface ExistingInteraction { entity_id: string; person_id?: string | null; occurred_at: string; direction: string; channel: string; content: string }

export interface EntityPlanItem {
  key: string; // csv name, used to resolve people/interactions against this row
  status: MatchStatus;
  candidates: MatchCandidate[];
  chosenId?: string; // undefined = create new
  csvRow: EntityCsvRow;
  patch: Record<string, unknown>;
  conflicts: FieldDiff[];
  include: boolean;
  derived?: boolean; // true for entities invented by an affiliation upgrade, not present in entities.csv
}

export interface PersonPlanItem {
  key: string; // "entity_name::full_name"
  status: MatchStatus;
  candidates: MatchCandidate[];
  chosenId?: string;
  entityKey: string;
  csvRow: PersonCsvRow;
  patch: Record<string, unknown>;
  conflicts: FieldDiff[];
  include: boolean;
}

export interface InteractionPlanItem {
  key: string;
  status: 'new' | 'duplicate' | 'unresolved';
  entityKey: string;
  personKey?: string;
  csvRow: InteractionCsvRow;
  include: boolean;
}

export interface AffiliationPlanItem {
  personKey: string; // matches a PersonPlanItem.key
  entityKey?: string; // matches an EntityPlanItem.key, undefined = independent
  kind: string;
  title?: string;
  isPrimary: boolean;
  seniorityRank?: number;
  notes: string;
  include: boolean;
}

export interface ImportPlan {
  entities: EntityPlanItem[];
  people: PersonPlanItem[];
  interactions: InteractionPlanItem[];
  affiliations: AffiliationPlanItem[];
}

// The two affiliation upgrades IRM_SPEC §9b-4 names explicitly. Hard-coded
// rather than derived generically from free-text background parsing — the
// annex names these exact people/entities as required test cases, and a
// general "infer affiliations from prose" heuristic would be speculative
// (see DECISIONS.md). Future real files would need a person to add
// affiliations manually via the existing AffiliationsCard, unless similarly
// explicit in a future annex.
function buildAffiliationUpgrades(people: PersonCsvRow[]): AffiliationPlanItem[] {
  const upgrades: AffiliationPlanItem[] = [];
  const lurdes = people.find((p) => p.full_name === 'Lurdes Gramaxo');
  if (lurdes) {
    const personKey = `${lurdes.entity_name}::${lurdes.full_name}`;
    upgrades.push({
      personKey, entityKey: 'Investors Portugal', kind: 'board_member', title: 'President',
      isPrimary: true, seniorityRank: 1,
      notes: 'Approach ONLY as President of Investors Portugal, asking for ecosystem intros — Bynd has passed 3x on hardware/medtech policy grounds, never re-pitch as a Bynd cheque.',
      include: true,
    });
    upgrades.push({
      personKey, entityKey: undefined, kind: 'board_member', title: 'APBA board member',
      isPrimary: false, seniorityRank: undefined,
      notes: 'Board member of APBA (Associacao Portuguesa de Business Angels), per her own background — not independently researched.',
      include: true,
    });
  }
  const murta = people.find((p) => p.full_name === 'Antonio Murta' && p.entity_name === 'Pathena');
  if (murta) {
    upgrades.push({
      personKey: `${murta.entity_name}::${murta.full_name}`, entityKey: 'Pathena Family Office',
      kind: 'angel', title: 'Business angel', isPrimary: true, seniorityRank: 1,
      notes: 'Approach as a MedTech/Digital Health business angel via Pathena Family Office — the Pathena FUND is in wind-down (hard_filter_status resolved_blocked) and should not be pitched.',
      include: true,
    });
  }
  return upgrades;
}

const DERIVED_ENTITIES: EntityCsvRow[] = [{
  name: 'Pathena Family Office', type: 'family_office', invests_in_geographies: [], sectors: [],
  website_verified: false, email_domain_verified: false,
  thesis: 'Angel investment vehicle for Antonio Murta (MedTech/Digital Health business angel) — separate from the Pathena fund, which is in wind-down.',
  status: 'not_contacted', hard_filter_status: 'not_applicable',
  source_url: 'https://www.pathena.com/about-us',
}];

export function buildImportPlan(
  csv: { entities: EntityCsvRow[]; people: PersonCsvRow[]; interactions: InteractionCsvRow[] },
  existing: { entities: ExistingEntity[]; people: ExistingPerson[]; interactions: ExistingInteraction[] },
): ImportPlan {
  const affiliationUpgrades = buildAffiliationUpgrades(csv.people);
  const derivedNeeded = new Set(affiliationUpgrades.map((a) => a.entityKey).filter(Boolean) as string[]);
  const allEntityRows = [...csv.entities, ...DERIVED_ENTITIES.filter((d) => derivedNeeded.has(d.name))];

  const entityPlans: EntityPlanItem[] = allEntityRows.map((csvRow) => {
    const { status, candidates } = matchEntities(existing.entities, csvRow);
    const chosen = status === 'matched' ? candidates[0] : undefined;
    const { patch, conflicts } = chosen
      ? mergeFields(existing.entities.find((e) => e.id === chosen.id) as Record<string, unknown>, csvRow as unknown as Record<string, unknown>)
      : { patch: {}, conflicts: [] };
    return {
      key: csvRow.name, status, candidates, chosenId: chosen?.id, csvRow, patch, conflicts, include: true,
      derived: DERIVED_ENTITIES.some((d) => d.name === csvRow.name),
    };
  });
  const entityByKey = new Map(entityPlans.map((e) => [e.key, e]));

  const peoplePlans: PersonPlanItem[] = csv.people.map((csvRow) => {
    const entityPlan = entityByKey.get(csvRow.entity_name);
    const scopeEntityId = entityPlan?.chosenId;
    const candidatePool = scopeEntityId ? existing.people.filter((p) => p.entity_id === scopeEntityId) : [];
    const { status, candidates } = candidatePool.length ? matchPerson(candidatePool, csvRow) : { status: 'new' as const, candidates: [] };
    const chosen = status === 'matched' ? candidates[0] : undefined;
    const existingRow = chosen ? existing.people.find((p) => p.id === chosen.id) : undefined;
    // entity_name is a CSV-only lookup key, not a people column — never pass
    // it (or the free-text `notes`, which maps to personal_notes) into a
    // raw column-name merge. Email fields are handled separately below —
    // "never promote a guess to verified" isn't a generic merge rule.
    const incomingColumns: Record<string, unknown> = {
      full_name: csvRow.full_name, role: csvRow.role, seniority_rank: csvRow.seniority_rank,
      based_in: csvRow.based_in, linkedin_url: csvRow.linkedin_url, linkedin_verified: csvRow.linkedin_verified,
      background: csvRow.background, personal_notes: csvRow.notes, hook: csvRow.hook,
      hook_status: csvRow.hook_status, kill_words: csvRow.kill_words, do_not_contact: csvRow.do_not_contact,
    };
    const { patch, conflicts } = existingRow
      ? mergeFields(existingRow as Record<string, unknown>, incomingColumns)
      : { patch: {}, conflicts: [] };
    if (existingRow) Object.assign(patch, personEmailPatch(existingRow, csvRow));
    else if (csvRow.email_verified) patch.email_verified = csvRow.email_verified;
    else if (csvRow.email_guess) patch.email_guess = csvRow.email_guess;
    return {
      key: `${csvRow.entity_name}::${csvRow.full_name}`, status, candidates, chosenId: chosen?.id,
      entityKey: csvRow.entity_name, csvRow, patch, conflicts, include: true,
    };
  });
  const peopleByKey = new Map(peoplePlans.map((p) => [p.key, p]));

  const interactionPlans: InteractionPlanItem[] = csv.interactions.map((csvRow, idx) => {
    const entityPlan = entityByKey.get(csvRow.entity_name);
    const personKey = csvRow.person_name ? `${csvRow.entity_name}::${csvRow.person_name}` : undefined;
    const personPlan = personKey ? peopleByKey.get(personKey) : undefined;
    const key = `${csvRow.entity_name}::${csvRow.person_name ?? ''}::${csvRow.occurred_at ?? ''}::${idx}`;
    if (!entityPlan) return { key, status: 'unresolved', entityKey: csvRow.entity_name, personKey, csvRow, include: false };

    const entityId = entityPlan.chosenId;
    const isDuplicate = !!entityId && existing.interactions.some((i) =>
      i.entity_id === entityId && (i.occurred_at || '').slice(0, 10) === (csvRow.occurred_at || '').slice(0, 10)
      && i.direction === csvRow.direction && (i.channel || '') === (csvRow.channel || '') && i.content.trim() === csvRow.content.trim());

    return { key, status: isDuplicate ? 'duplicate' : 'new', entityKey: csvRow.entity_name, personKey, csvRow, include: !isDuplicate };
  });

  return { entities: entityPlans, people: peoplePlans, interactions: interactionPlans, affiliations: affiliationUpgrades };
}
