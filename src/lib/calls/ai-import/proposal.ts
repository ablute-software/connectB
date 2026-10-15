// Prompt 909 (I4) — what the engine may PROPOSE, and the only way a proposal becomes configuration.
//
// Two rules hold everything together:
//   1. Whatever the model returns is untrusted data. `sanitizeProposal` keeps only the fields of this shape, only
//      the allowed kinds, bounded lengths and counts; anything else it said is thrown away. A model that was talked
//      into "instructions" by a document cannot make this produce anything but a draft proposal.
//   2. A proposal changes NOTHING. It becomes configuration only for the items the person Accepted (and may have
//      edited), and those go back through the same validation the editor's own saves use.
// Pure and client-safe: the review screen uses the same types and the same conversion.
import { newFieldId, newOptionId } from '../form-builder';
import { isValidTimeZone, wallToUtcIso } from '../tz';
import {
  AI_FIELD_KINDS, DEFAULT_MAX_FILE_MB, YES_NO_OPTIONS, isChoiceKind, type FieldKind, type FormField, type LimitUnit,
} from '../types';

export const MAX_PROPOSED_FIELDS = 150;
export const MAX_PROPOSED_PHASES = 20;
const MAX_FOUND_LATER = 40;

export interface ProposalFieldItem {
  /** Only identifies the item on the review screen; the real id is made when it is accepted. */
  tmpId: string;
  page: number;
  kind: FieldKind;
  label: string;
  instruction: string | null;
  required: boolean;
  /** Option labels (choice questions). */
  options: string[];
  /** File fields: what document is expected, and how old it may be. */
  expectedType: string | null;
  maxAgeMonths: number | null;
}
export interface ProposalPhaseItem { name: string; startsOn: string | null; endsOn: string | null }
export interface ProposalGeneral { name?: string; description?: string; opensAt?: string; closesAt?: string; timezone?: string; limitUnit?: LimitUnit }
export interface AttentionItem { kind: 'outdated' | 'not_covered'; what: string; why: string }
export interface Proposal {
  general: ProposalGeneral;
  phases: ProposalPhaseItem[];
  fields: ProposalFieldItem[];
  /** What may be out of date, and what the pieces of the form cannot express — said exactly, never approximated. */
  attention: AttentionItem[];
  /** Eligibility rules and evaluation criteria: kept as TEXT for the later stages, not configured now. */
  foundLater: { eligibility: string[]; evaluation: string[] };
}

export const EMPTY_PROPOSAL: Proposal = { general: {}, phases: [], fields: [], attention: [], foundLater: { eligibility: [], evaluation: [] } };

// --- Sanitising what came back ---------------------------------------------------------------------------------------

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
  return s || null;
};
const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

/** A date the model wrote, as an instant: a bare date means the start (opening) or the end (closing) of that day in the call's zone. */
function instant(v: unknown, tz: string, edge: 'start' | 'end'): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return wallToUtcIso(`${s}T${edge === 'start' ? '09:00' : '23:59'}`, tz) ?? undefined;
  const wall = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(s); // no offset: wall-clock time in the call's zone
  if (wall) return wallToUtcIso(`${wall[1]}T${wall[2]}`, tz) ?? undefined;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/**
 * `dropInconsistentDates`: what the MODEL proposed that closes before it opens loses its closing date (a draft is not the
 * place to argue). What a PERSON accepted and edited is checked by the same validation as any save, which refuses it.
 */
export function sanitizeGeneral(raw: unknown, opts: { dropInconsistentDates?: boolean } = {}): ProposalGeneral {
  const g = obj(raw);
  const out: ProposalGeneral = {};
  const name = clean(g.name, 200); if (name) out.name = name;
  const description = clean(g.description, 5000); if (description) out.description = description;
  const tzRaw = typeof g.timezone === 'string' ? g.timezone.trim() : '';
  if (tzRaw && isValidTimeZone(tzRaw)) out.timezone = tzRaw;
  const tz = out.timezone ?? 'Europe/Lisbon';
  const opens = instant(g.opens_at ?? g.opensAt, tz, 'start'); if (opens) out.opensAt = opens;
  const closes = instant(g.closes_at ?? g.closesAt, tz, 'end'); if (closes) out.closesAt = closes;
  if ((opts.dropInconsistentDates ?? true) && out.opensAt && out.closesAt && Date.parse(out.closesAt) <= Date.parse(out.opensAt)) delete out.closesAt;
  const unit = g.limit_unit ?? g.limitUnit;
  if (unit === 'project' || unit === 'legal_entity') out.limitUnit = unit;
  return out;
}

export function sanitizePhases(raw: unknown): ProposalPhaseItem[] {
  const out: ProposalPhaseItem[] = [];
  for (const p of arr(raw).slice(0, MAX_PROPOSED_PHASES)) {
    const o = obj(p);
    const name = clean(o.name, 120); if (!name) continue;
    let startsOn = day(o.starts_on ?? o.startsOn); let endsOn = day(o.ends_on ?? o.endsOn);
    if (startsOn && endsOn && endsOn < startsOn) { startsOn = null; endsOn = null; }
    out.push({ name, startsOn, endsOn });
  }
  return out;
}

/** Fields as the model proposed them (grouped in pages) or as the review screen sends them back (flat, with `page`). */
export function sanitizeFieldItems(raw: unknown, opts: { paged: boolean }): { fields: ProposalFieldItem[]; attention: AttentionItem[] } {
  const fields: ProposalFieldItem[] = [];
  const attention: AttentionItem[] = [];
  let seq = 0;
  const take = (rawField: unknown, page: number) => {
    if (fields.length >= MAX_PROPOSED_FIELDS) return;
    const o = obj(rawField);
    const label = clean(o.label, 300); if (!label) return;
    let kind = (AI_FIELD_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as FieldKind) : null;
    if (!kind) {
      attention.push({ kind: 'not_covered', what: `“${label}”`, why: 'The form has no piece for this kind of question; it was imported as a short text question.' });
      kind = 'short_text';
    }
    let options = isChoiceKind(kind) ? arr(o.options).map((x) => clean(x, 200)).filter((x): x is string => !!x).slice(0, 50) : [];
    options = options.filter((x, i) => options.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
    if (isChoiceKind(kind) && options.length < 2) {
      attention.push({ kind: 'not_covered', what: `“${label}”`, why: 'It looks like a choice question but no options were found in the document, so it was imported as a short text question.' });
      kind = 'short_text'; options = [];
    }
    const age = Number(o.max_document_age_months ?? o.maxAgeMonths);
    const tmpId = clean(o.tmpId, 40) ?? `tmp_${++seq}`;
    fields.push({
      tmpId: fields.some((f) => f.tmpId === tmpId) ? `${tmpId}_${fields.length}` : tmpId,
      page, kind, label, instruction: clean(o.instruction, 1000), required: o.required === true, options,
      expectedType: kind === 'file' ? clean(o.expected_document_type ?? o.expectedType, 200) : null,
      maxAgeMonths: kind === 'file' && Number.isInteger(age) && age > 0 && age <= 600 ? age : null,
    });
  };
  if (opts.paged) arr(raw).slice(0, 40).forEach((page, pi) => arr(obj(page).fields).forEach((f) => take(f, pi + 1)));
  else arr(raw).forEach((f) => { const pg = Number(obj(f).page); take(f, Number.isInteger(pg) && pg >= 1 && pg <= 40 ? pg : 1); });
  return { fields, attention };
}

const textList = (v: unknown): string[] => arr(v).map((x) => clean(x, 600)).filter((x): x is string => !!x).slice(0, MAX_FOUND_LATER);

/** The model's tool output -> a Proposal. Never throws; whatever does not fit the shape is dropped. */
export function sanitizeProposal(rawInput: unknown, now: Date = new Date()): Proposal {
  const raw = obj(rawInput);
  const fields = sanitizeFieldItems(raw.form_pages, { paged: true });
  const modelAttention: AttentionItem[] = arr(raw.needs_attention).slice(0, 40).flatMap((a): AttentionItem[] => {
    const o = obj(a); const what = clean(o.what, 400); if (!what) return [];
    return [{ kind: o.kind === 'not_covered' ? 'not_covered' : 'outdated', what, why: clean(o.why, 600) ?? '' }];
  });
  const found = obj(raw.found_for_later);
  const proposal: Proposal = {
    general: sanitizeGeneral(raw.general), phases: sanitizePhases(raw.phases), fields: fields.fields, attention: [...fields.attention, ...modelAttention],
    foundLater: { eligibility: textList(found.eligibility_rules), evaluation: textList(found.evaluation_criteria) },
  };
  proposal.attention = mergeAttention(proposal.attention, flagOutdated(proposal, now));
  return proposal;
}

// --- What may be out of date (deterministic, on top of what the model flagged) ------------------------------------------

const AGE_LIMIT = /\b(?:less than|under|up to|at most|no more than|older than|more than|over|maximum of)\s+\d+\s+years?\b/i;

function mergeAttention(a: AttentionItem[], b: AttentionItem[]): AttentionItem[] {
  const seen = new Set(a.map((x) => `${x.kind}|${x.what.toLowerCase()}`));
  return [...a, ...b.filter((x) => !seen.has(`${x.kind}|${x.what.toLowerCase()}`))];
}

/** Dates already past, references to a previous edition, and limits on the age of the company: to check by a person. */
export function flagOutdated(p: Proposal, now: Date = new Date()): AttentionItem[] {
  const out: AttentionItem[] = [];
  const year = now.getUTCFullYear();
  const day10 = (iso: string) => iso.slice(0, 10);
  if (p.general.opensAt && Date.parse(p.general.opensAt) < now.getTime()) out.push({ kind: 'outdated', what: `Opening date ${day10(p.general.opensAt)}`, why: 'This date has already passed. It may belong to a previous edition.' });
  if (p.general.closesAt && Date.parse(p.general.closesAt) < now.getTime()) out.push({ kind: 'outdated', what: `Closing date ${day10(p.general.closesAt)}`, why: 'This date has already passed. It may belong to a previous edition.' });
  for (const ph of p.phases) {
    const past = ph.endsOn ?? ph.startsOn;
    if (past && Date.parse(past) < now.getTime()) out.push({ kind: 'outdated', what: `Phase “${ph.name}” dates`, why: 'These dates have already passed. They may belong to a previous edition.' });
  }
  const texts: { where: string; text: string }[] = [
    { where: 'the name', text: p.general.name ?? '' }, { where: 'the description', text: p.general.description ?? '' },
    ...p.phases.map((ph) => ({ where: `phase “${ph.name}”`, text: ph.name })),
    ...p.fields.flatMap((f) => [{ where: `“${f.label}”`, text: f.label }, { where: `“${f.label}”`, text: f.instruction ?? '' }]),
  ];
  for (const { where, text } of texts) {
    for (const m of text.matchAll(/\b(20\d{2})\b/g)) {
      if (Number(m[1]) < year) out.push({ kind: 'outdated', what: `“${m[1]}” in ${where}`, why: 'A reference to a previous year or edition. Check that it is meant for this one.' });
    }
    const age = AGE_LIMIT.exec(text);
    if (age) out.push({ kind: 'outdated', what: `Age limit in ${where}: “${age[0]}”`, why: 'A limit on the age of the company. Check that it still applies.' });
  }
  return mergeAttention([], out);
}

// --- Accepted items -> configuration -------------------------------------------------------------------------------------

/** The form fields for the items the person accepted, on new ids, starting at a page of the current form. */
export function fieldItemsToFormFields(items: ProposalFieldItem[], afterPage: number, makeId: () => string = newFieldId): FormField[] {
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  const pageIndex = new Map(pages.map((p, i) => [p, i + 1]));
  const perPage = new Map<number, number>();
  return items.map((it) => {
    const page = afterPage + (pageIndex.get(it.page) ?? 1);
    const position = perPage.get(page) ?? 0; perPage.set(page, position + 1);
    return {
      id: makeId(), page, position, kind: it.kind, label: it.label, instruction: it.instruction, required: it.required,
      options: it.kind === 'yes_no' ? YES_NO_OPTIONS.map((o) => ({ ...o })) : isChoiceKind(it.kind) ? it.options.map((label) => ({ id: newOptionId(), label })) : [],
      validations: it.kind === 'file' ? { maxFileMb: DEFAULT_MAX_FILE_MB } : {}, condition: null, platformMapping: null,
      expectedType: it.kind === 'file' ? it.expectedType : null, maxAgeMonths: it.kind === 'file' ? it.maxAgeMonths : null,
    };
  });
}
