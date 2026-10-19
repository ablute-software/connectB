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
import { parseGroupConfig, parseSimpleValidations } from '../field-config';
import { isValidTimeZone, wallToUtcIso } from '../tz';
import { normalizeDescription } from '../../rich-text';
import {
  AI_FIELD_KINDS, DEFAULT_MAX_FILE_MB, YES_NO_OPTIONS, isChoiceKind, type FieldKind, type FieldValidations, type FormField, type GroupConfig, type LimitUnit, type SimpleKind,
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
  /**
   * Prompt 917 (I2): how the question is configured beyond its kind — the formats and number of files of a File, the hint of a Link, the currency of a
   * Number. The same shape the editor saves (the sanitiser keeps only what applies to the kind).
   */
  validations?: Omit<FieldValidations, 'group'>;
  /** A repeatable group (kind "group"): the entry, its questions, cards or table, its fixed rows. */
  group?: GroupConfig | null;
  /** Shown only when an EARLIER yes/no question of this proposal is answered so ("4.4 = Yes" -> the amount). `tmpId` is that question's. */
  condition?: { tmpId: string; value: 'yes' | 'no' } | null;
  /** The number the document gives the question ("2.10.1"): what a correction, a warning or a repeated question is matched by. */
  number?: string | null;
  /** Who made this item: the platform's own reader, or the AI provider (shown discreetly on the review screen). */
  source?: 'internal' | 'ai';
}
export interface ProposalPhaseItem { name: string; startsOn: string | null; endsOn: string | null }
export interface ProposalGeneral { name?: string; description?: string; opensAt?: string; closesAt?: string; timezone?: string; limitUnit?: LimitUnit }
export interface AttentionItem { kind: 'outdated' | 'not_covered' | 'done'; what: string; why: string }
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
  // The description may carry the basic formatting of the document (lists, bold): sanitised exactly as what a person types.
  const description = normalizeDescription(g.description); if (description) out.description = description;
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

/** The configuration of a group as the model wrote it (snake_case, options as plain strings) or as the review screen sends it back (camelCase). */
function groupRaw(raw: unknown): unknown {
  const g = obj(raw);
  const subs = arr(g.subFields ?? g.sub_fields).map((s) => {
    const o = obj(s);
    const v = obj(o.validations);
    return {
      id: o.id, kind: o.kind, label: o.label, required: o.required === true,
      options: arr(o.options).map((x) => (typeof x === 'string' ? { label: x } : x)),
      validations: { ...v, fileFormats: v.fileFormats ?? o.file_formats ?? o.fileFormats, maxFiles: v.maxFiles ?? o.max_files ?? o.maxFiles, maxFileMb: v.maxFileMb ?? o.max_file_mb ?? o.maxFileMb, urlHint: v.urlHint ?? o.url_hint ?? o.urlHint, currency: v.currency ?? o.currency, maxLength: v.maxLength ?? o.max_length ?? o.maxLength },
    };
  });
  return { entryLabel: g.entryLabel ?? g.entry_label, min: g.min, max: g.max, display: g.display, presetRows: g.presetRows ?? g.preset_rows, subFields: subs };
}

/**
 * Fields as the model proposed them (grouped in pages), as the platform's own reader made them (flat, with `page`), or as the review screen sends them back.
 * Every kind is checked the same way, whoever made the item: a group must parse, a link/email/File keeps only what applies to it, a condition must point at an
 * EARLIER yes/no question of the proposal (by its tmpId, or by the number the document gave it), and a choice with fewer than two options becomes short text.
 */
export function sanitizeFieldItems(raw: unknown, opts: { paged: boolean; source?: 'internal' | 'ai' }): { fields: ProposalFieldItem[]; attention: AttentionItem[] } {
  const fields: ProposalFieldItem[] = [];
  const attention: AttentionItem[] = [];
  const pending = new Map<string, { tmpId?: string; number?: string; value: 'yes' | 'no' }>();
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
    let options = isChoiceKind(kind) ? arr(o.options).map((x) => clean(typeof x === 'object' && x ? (x as { label?: unknown }).label : x, 200)).filter((x): x is string => !!x).slice(0, 50) : [];
    options = options.filter((x, i) => options.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
    if (isChoiceKind(kind) && options.length < 2) {
      attention.push({ kind: 'not_covered', what: `“${label}”`, why: 'It looks like a choice question but no options were found in the document, so it was imported as a short text question.' });
      kind = 'short_text'; options = [];
    }
    let group: GroupConfig | null = null;
    if (kind === 'group') {
      const g = parseGroupConfig(groupRaw(o.group));
      if (g.ok) group = g.config;
      else { attention.push({ kind: 'not_covered', what: `“${label}”`, why: `It looks like a repeatable group but could not be read as one (${g.error}), so it was imported as a short text question.` }); kind = 'short_text'; }
    }
    // What a kind is configured with: only what applies to it survives (the same reading the editor's own saves go through).
    const v = obj(o.validations);
    let validations: ProposalFieldItem['validations'];
    if (kind !== 'group') {
      const parsed = parseSimpleValidations(kind as SimpleKind, {
        ...v, fileFormats: v.fileFormats ?? o.file_formats ?? o.fileFormats, maxFiles: v.maxFiles ?? o.max_files ?? o.maxFiles, maxFileMb: v.maxFileMb ?? o.max_file_mb ?? o.maxFileMb,
        urlHint: v.urlHint ?? o.url_hint ?? o.urlHint, currency: v.currency ?? o.currency, maxLength: v.maxLength ?? o.max_length ?? o.maxLength, maxWords: v.maxWords ?? o.max_words ?? o.maxWords,
      });
      if (Object.keys(parsed).length > 0) validations = parsed;
    }
    const age = Number(o.max_document_age_months ?? o.maxAgeMonths);
    let tmpId = clean(o.tmpId, 40) ?? `tmp_${++seq}`;
    if (fields.some((f) => f.tmpId === tmpId)) tmpId = `${tmpId}_${fields.length}`;
    const c = obj(o.condition);
    const cv = c.value === 'yes' || c.value === 'no' ? (c.value as 'yes' | 'no') : null;
    const ctmp = clean(c.tmpId, 40) ?? undefined; const cnum = clean(c.depends_on_number ?? c.number ?? c.dependsOnNumber, 40) ?? undefined;
    if (cv && (ctmp || cnum)) pending.set(tmpId, { tmpId: ctmp, number: cnum, value: cv });
    const src = o.source === 'ai' || o.source === 'internal' ? (o.source as 'ai' | 'internal') : opts.source;
    fields.push({
      tmpId, page, kind, label, instruction: clean(o.instruction, 1000), required: o.required === true, options,
      expectedType: kind === 'file' ? clean(o.expected_document_type ?? o.expectedType, 200) : null,
      maxAgeMonths: kind === 'file' && Number.isInteger(age) && age > 0 && age <= 600 ? age : null,
      ...(validations ? { validations } : {}), ...(group ? { group } : {}),
      number: clean(o.number, 40), ...(src ? { source: src } : {}),
    });
  };
  if (opts.paged) arr(raw).slice(0, 40).forEach((page, pi) => arr(obj(page).fields).forEach((f) => take(f, pi + 1)));
  else arr(raw).forEach((f) => { const pg = Number(obj(f).page); take(f, Number.isInteger(pg) && pg >= 1 && pg <= 40 ? pg : 1); });

  // A condition survives only when it points at an EARLIER yes/no question of the proposal.
  fields.forEach((f, i) => {
    const c = pending.get(f.tmpId); if (!c) return;
    const at = fields.findIndex((x) => (c.tmpId && x.tmpId === c.tmpId) || (!c.tmpId && c.number && x.number === c.number));
    if (at >= 0 && at < i && fields[at].kind === 'yes_no') f.condition = { tmpId: fields[at].tmpId, value: c.value };
  });
  return { fields, attention };
}

const textList = (v: unknown): string[] => arr(v).map((x) => clean(x, 600)).filter((x): x is string => !!x).slice(0, MAX_FOUND_LATER);

/** The model's tool output -> a Proposal. Never throws; whatever does not fit the shape is dropped. */
export function sanitizeProposal(rawInput: unknown, now: Date = new Date()): Proposal {
  const raw = obj(rawInput);
  const fields = sanitizeFieldItems(raw.form_pages, { paged: true, source: 'ai' });
  const modelAttention: AttentionItem[] = arr(raw.needs_attention).slice(0, 40).flatMap((a): AttentionItem[] => {
    const o = obj(a); const what = clean(o.what, 400); if (!what) return [];
    return [{ kind: o.kind === 'not_covered' ? 'not_covered' : o.kind === 'done' ? 'done' : 'outdated', what, why: clean(o.why, 600) ?? '' }];
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

/**
 * The form fields for the items the person accepted, on new ids, starting at a page of the current form. A group becomes a group (its configuration is copied, never
 * shared); a File keeps its formats and number of files; a condition is re-pointed at the NEW id of the question it depends on — and dropped when that question was
 * not accepted or does not come before this one, so the form never holds a condition the editor would refuse.
 */
export function fieldItemsToFormFields(items: ProposalFieldItem[], afterPage: number, makeId: () => string = newFieldId): FormField[] {
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  const pageIndex = new Map(pages.map((p, i) => [p, i + 1]));
  const perPage = new Map<number, number>();
  const ids = new Map(items.map((it) => [it.tmpId, makeId()]));
  const order = new Map(items.map((it, i) => [it.tmpId, i]));
  return items.map((it, i) => {
    const page = afterPage + (pageIndex.get(it.page) ?? 1);
    const position = perPage.get(page) ?? 0; perPage.set(page, position + 1);
    const validations: FieldValidations = it.kind === 'group'
      ? { group: JSON.parse(JSON.stringify(it.group ?? { entryLabel: 'Entry', min: 0, max: 10, display: 'cards', presetRows: [], subFields: [] })) as GroupConfig }
      : it.kind === 'file' ? { maxFileMb: DEFAULT_MAX_FILE_MB, ...(it.validations ?? {}) } : { ...(it.validations ?? {}) };
    const c = it.condition;
    const controllerAt = c ? order.get(c.tmpId) : undefined;
    return {
      id: ids.get(it.tmpId)!, page, position, kind: it.kind, label: it.label, instruction: it.instruction, required: it.required,
      options: it.kind === 'yes_no' ? YES_NO_OPTIONS.map((o) => ({ ...o })) : isChoiceKind(it.kind) ? it.options.map((label) => ({ id: newOptionId(), label })) : [],
      validations, condition: c && controllerAt !== undefined && controllerAt < i ? { fieldId: ids.get(c.tmpId)!, operator: 'equals', value: c.value } : null, platformMapping: null,
      expectedType: it.kind === 'file' ? it.expectedType : null, maxAgeMonths: it.kind === 'file' ? it.maxAgeMonths : null,
    };
  });
}
