// Prompt 905 — database rows <-> the domain types of src/lib/calls/types.ts, and the validation of the
// "General" tab's input. Pure (no I/O) so both the routes and the tests use it.
import { isValidTimeZone } from './tz';
import {
  CALL_STATUSES, CONTENT_LANGUAGES, CURRENCIES,
  type Call, type CallPhase, type CallVisibility, type FormField, type LimitUnit,
} from './types';

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function rowToCall(r: Row): Call {
  const kind = r.promoter_kind === 'incubator' ? 'incubator' : 'catalog_entity';
  const status = CALL_STATUSES.includes(r.status as never) ? (r.status as Call['status']) : 'draft';
  return {
    id: r.id as string, promoterKind: kind,
    promoterId: (kind === 'incubator' ? r.incubator_id : r.catalog_entity_id) as string,
    name: (r.name as string) ?? '', description: s(r.description), opensAt: s(r.opens_at), closesAt: s(r.closes_at),
    timezone: s(r.timezone) ?? 'Europe/Lisbon', visibility: (r.visibility === 'unlisted' ? 'unlisted' : 'listed') as CallVisibility,
    limitUnit: (r.limit_unit === 'legal_entity' ? 'legal_entity' : 'project') as LimitUnit, allowMultiple: r.allow_multiple === true,
    contentLanguage: s(r.content_language) ?? 'en', currency: s(r.currency) ?? 'EUR', status, linkToken: s(r.link_token),
    configVersion: Number(r.config_version ?? 1), validatedAt: s(r.validated_at), publishedAt: s(r.published_at), closedAt: s(r.closed_at),
    duplicatedFrom: s(r.duplicated_from), createdBy: r.created_by as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

export const rowToPhase = (r: Row): CallPhase => ({
  id: r.id as string, position: Number(r.position ?? 0), name: (r.name as string) ?? '', startsOn: s(r.starts_on), endsOn: s(r.ends_on),
});

export function rowToField(r: Row): FormField {
  return {
    id: r.id as string, page: Number(r.page ?? 1), position: Number(r.position ?? 0), kind: r.kind as FormField['kind'],
    label: (r.label as string) ?? '', instruction: s(r.instruction), required: r.required === true,
    options: Array.isArray(r.options) ? (r.options as FormField['options']) : [],
    validations: (r.validations && typeof r.validations === 'object' ? r.validations : {}) as FormField['validations'],
    condition: (r.condition && typeof r.condition === 'object' ? r.condition : null) as FormField['condition'],
    platformMapping: (s(r.platform_mapping) as FormField['platformMapping']) ?? null,
    expectedType: s(r.expected_type), maxAgeMonths: r.max_age_months == null ? null : Number(r.max_age_months),
  };
}

export const fieldToRow = (callId: string, f: FormField): Row => ({
  id: f.id, call_id: callId, page: f.page, position: f.position, kind: f.kind, label: f.label, instruction: f.instruction,
  required: f.required, options: f.options, validations: f.validations, condition: f.condition,
  platform_mapping: f.platformMapping, expected_type: f.expectedType, max_age_months: f.maxAgeMonths, updated_at: new Date().toISOString(),
});

// --- General tab input -------------------------------------------------------------------------------------------------

export interface GeneralPatch {
  name?: string; description?: string | null; opens_at?: string | null; closes_at?: string | null; timezone?: string;
  visibility?: CallVisibility; limit_unit?: LimitUnit; allow_multiple?: boolean; content_language?: string; currency?: string;
}

export type ParsedGeneral = { ok: true; patch: GeneralPatch } | { ok: false; error: string };

const isoOrNull = (v: unknown): string | null | 'bad' => {
  if (v === null || v === '') return null;
  if (typeof v !== 'string') return 'bad';
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? 'bad' : new Date(ms).toISOString();
};

/** Only the fields the editor may change here; everything else (status, link, ids) is not accepted from the client. */
export function parseGeneralPatch(input: unknown, current: Pick<Call, 'opensAt' | 'closesAt'>): ParsedGeneral {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Nothing to save.' };
  const b = input as Record<string, unknown>;
  const patch: GeneralPatch = {};

  if ('name' in b) {
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 200) : '';
    if (!name) return { ok: false, error: 'The call needs a name.' };
    patch.name = name;
  }
  if ('description' in b) patch.description = typeof b.description === 'string' ? b.description.slice(0, 5000) || null : null;
  for (const [key, col] of [['opensAt', 'opens_at'], ['closesAt', 'closes_at']] as const) {
    if (key in b) {
      const v = isoOrNull(b[key]);
      if (v === 'bad') return { ok: false, error: 'Invalid date.' };
      patch[col] = v;
    }
  }
  if ('timezone' in b) {
    if (typeof b.timezone !== 'string' || !isValidTimeZone(b.timezone)) return { ok: false, error: 'Unknown time zone.' };
    patch.timezone = b.timezone;
  }
  if ('visibility' in b) {
    if (b.visibility !== 'listed' && b.visibility !== 'unlisted') return { ok: false, error: 'Invalid listing option.' };
    patch.visibility = b.visibility;
  }
  if ('limitUnit' in b) {
    if (b.limitUnit !== 'project' && b.limitUnit !== 'legal_entity') return { ok: false, error: 'Invalid application limit.' };
    patch.limit_unit = b.limitUnit;
  }
  if ('allowMultiple' in b) patch.allow_multiple = b.allowMultiple === true;
  if ('contentLanguage' in b) {
    if (!CONTENT_LANGUAGES.some((l) => l.code === b.contentLanguage)) return { ok: false, error: 'Unsupported language.' };
    patch.content_language = b.contentLanguage as string;
  }
  if ('currency' in b) {
    if (!(CURRENCIES as readonly string[]).includes(b.currency as string)) return { ok: false, error: 'Unsupported currency.' };
    patch.currency = b.currency as string;
  }

  const opens = 'opens_at' in patch ? patch.opens_at : current.opensAt;
  const closes = 'closes_at' in patch ? patch.closes_at : current.closesAt;
  if (opens && closes && Date.parse(closes) <= Date.parse(opens)) return { ok: false, error: 'The call must close after it opens.' };
  return { ok: true, patch };
}

// --- Phases --------------------------------------------------------------------------------------------------------------

export const MAX_PHASES = 20;
export type ParsedPhases = { ok: true; phases: { id: string; position: number; name: string; starts_on: string | null; ends_on: string | null }[] } | { ok: false; error: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parsePhasesPayload(input: unknown): ParsedPhases {
  if (!Array.isArray(input)) return { ok: false, error: 'phases must be a list.' };
  if (input.length === 0) return { ok: false, error: 'A call needs at least one phase.' };
  if (input.length > MAX_PHASES) return { ok: false, error: `At most ${MAX_PHASES} phases.` };
  const seen = new Set<string>();
  const out: { id: string; position: number; name: string; starts_on: string | null; ends_on: string | null }[] = [];
  for (const [i, raw] of (input as Record<string, unknown>[]).entries()) {
    const id = typeof raw?.id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw.id) ? raw.id : globalThis.crypto.randomUUID();
    if (seen.has(id)) return { ok: false, error: 'Duplicate phase id.' };
    seen.add(id);
    const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, 120) : '';
    const day = (v: unknown) => (typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
    const starts = day(raw?.startsOn); const ends = day(raw?.endsOn);
    if (starts && ends && ends < starts) return { ok: false, error: `Phase “${name || i + 1}” ends before it starts.` };
    out.push({ id, position: i, name: name || `Phase ${i + 1}`, starts_on: starts, ends_on: ends });
  }
  return { ok: true, phases: out };
}
