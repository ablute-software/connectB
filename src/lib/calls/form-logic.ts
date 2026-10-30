// Prompt 905 — the rules a call's form obeys when someone ANSWERS it, in one pure module: the editor's
// preview runs it in the browser, and Prompt 906's submit runs the very same functions on the server
// (spec §6.2: "as condições são verificadas também no servidor"). No I/O, no React.
import { MAX_NUMBER_DIGITS, type AnswerValue, type Answers, type FieldCondition, type FormField } from './types';
import {
  FILE_FORMATS, MACROS_REFUSED, MAX_URL_LENGTH, entriesOf, fileFormatsOf, fileValues, formatOfName, groupMin, declaredTypeMessage, isMacroName, notAcceptedMessage, groupOf, groupStarted, isEmail, isFileValue, isGroupEntry, isHttpUrl,
  maxFileMbOf, maxFilesOf, presetEntriesFor, subFieldAsField,
} from './field-config';
import { isTableAnswer, isTableAnswered, tableIssues } from './table';

export const orderFields = (fields: FormField[]): FormField[] =>
  [...fields].sort((a, b) => a.page - b.page || a.position - b.position);

// --- Presence -------------------------------------------------------------------------------------

export function isAnswered(value: AnswerValue): value is Exclude<AnswerValue, null | undefined> {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  // A table is answered when a CELL holds something; a column or row the applicant added and left empty is not an answer (Prompt 917, Adenda 2).
  if (isTableAnswer(value)) return isTableAnswered(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    // A group is answered when at least one of its entries holds something; a list of options or of files, when it is not empty.
    if (isGroupEntry(value[0])) return (value as unknown[]).some((e) => isGroupEntry(e) && Object.values(e.values).some((v) => isAnswered(v)));
    return true;
  }
  return isFileValue(value) && value.fileName !== '';
}

// --- Display conditions (§6.2) -----------------------------------------------------------------------

function matches(cond: FieldCondition, answer: AnswerValue): boolean {
  switch (cond.operator) {
    case 'is_answered': return isAnswered(answer);
    case 'is_empty': return !isAnswered(answer);
    case 'equals':
    case 'not_equals': {
      const target = cond.value ?? '';
      const hit = Array.isArray(answer) ? (answer as unknown[]).includes(target) : typeof answer === 'string' ? answer === target : false;
      return cond.operator === 'equals' ? hit : !hit;
    }
  }
}

/**
 * Is the field shown? A field with no condition always is. A conditional field is shown only when the field it
 * depends on is itself shown AND matches — so hiding a controlling question hides everything that hangs off it.
 * A condition pointing at a field that does not exist (deleted) hides nothing: the editor flags it, and a stale
 * pointer must never make a required question silently vanish for applicants. Cycles resolve to "shown".
 */
export function isFieldVisible(field: FormField, byId: Map<string, FormField>, answers: Answers, seen: Set<string> = new Set()): boolean {
  const cond = field.condition;
  if (!cond) return true;
  const controller = byId.get(cond.fieldId);
  if (!controller || seen.has(field.id)) return true;
  // A condition still being built ("is" / "is not" with no value chosen yet) hides nothing; confirming is blocked until it is complete.
  if ((cond.operator === 'equals' || cond.operator === 'not_equals') && !cond.value) return true;
  seen.add(field.id);
  if (!isFieldVisible(controller, byId, answers, seen)) return false;
  return matches(cond, answers[controller.id]);
}

export function visibleFields(fields: FormField[], answers: Answers): FormField[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  return orderFields(fields).filter((f) => isFieldVisible(f, byId, answers));
}

/** The pages with at least one shown field, in order: page number -> its shown fields. */
export function visiblePages(fields: FormField[], answers: Answers): { page: number; fields: FormField[] }[] {
  const out: { page: number; fields: FormField[] }[] = [];
  for (const f of visibleFields(fields, answers)) {
    const last = out[out.length - 1];
    if (last && last.page === f.page) last.fields.push(f); else out.push({ page: f.page, fields: [f] });
  }
  return out;
}

/** Answers of fields that are hidden are dropped: what the applicant cannot see is never submitted. */
export function pruneHiddenAnswers(fields: FormField[], answers: Answers): Answers {
  const shown = new Set(visibleFields(fields, answers).map((f) => f.id));
  const out: Answers = {};
  for (const [id, v] of Object.entries(answers)) if (shown.has(id)) out[id] = v;
  return out;
}

// --- Numbers (§6.1: only digits, never negative, formatted underneath) ---------------------------------------

/** Keeps digits only (no letters, commas, dots, minus signs), drops leading zeros, caps the length. */
export function sanitizeNumberInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, MAX_NUMBER_DIGITS);
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return trimmed;
}

const CURRENCY_SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

/** "500000" -> "500 000", or "500 000 €" when `currency` is given. Empty input -> "". */
export function formatNumberDisplay(digits: string, currency?: string | null): string {
  if (!digits) return '';
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (!currency) return grouped;
  return `${grouped} ${CURRENCY_SYMBOL[currency] ?? currency}`;
}

// --- Per-field validation -------------------------------------------------------------------------------------

const wordCount = (s: string) => (s.trim() === '' ? 0 : s.trim().split(/\s+/).length);
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealDate(s: string): boolean {
  const m = ISO_DAY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/**
 * The problems inside a group's entries, by "entryId/subFieldId" (what the repeater draws under each input), and the one about the NUMBER of entries
 * under "count". Empty = fine. A required question inside an entry is required in every entry.
 */
export function groupErrors(field: FormField, value: AnswerValue): Record<string, string> {
  const cfg = groupOf(field);
  if (!cfg) return {};
  const errors: Record<string, string> = {};
  // An OPTIONAL group asks for nothing until the person starts filling it in (then its minimum and its required questions apply); a required one always does.
  if (!field.required && !groupStarted(cfg, value)) return errors;
  // The rows the entity fixed are always there: the person never has to "add" them.
  const entries = presetEntriesFor(cfg, value);
  const min = groupMin(field, cfg);
  const noun = cfg.entryLabel.toLowerCase();
  if (entries.length < min) errors.count = min === 1 ? `Add at least one ${noun}.` : `Add at least ${min} entries (${noun}).`;
  if (entries.length > cfg.max) errors.count = `At most ${cfg.max} entries (${noun}).`;
  for (const e of entries) {
    for (const s of cfg.subFields) {
      const err = validateAnswer(subFieldAsField(s), e.values[s.id]);
      if (err) errors[`${e.id}/${s.id}`] = err;
    }
  }
  return errors;
}

/**
 * EVERY problem of a group, one by one: the one about the number of entries, then each entry's each question, in the order of the form. The final check lists them all at
 * once (a group used to count as one item, showing only its first problem — the rest appeared one at a time after each correction).
 */
export function groupIssues(field: FormField, value: AnswerValue): { key: string; message: string }[] {
  const cfg = groupOf(field);
  if (!cfg) return [];
  const errors = groupErrors(field, value);
  const out: { key: string; message: string }[] = [];
  if (errors.count) out.push({ key: `${field.id}#count`, message: errors.count });
  const entries = presetEntriesFor(cfg, value);         // the fixed rows count even when nothing was typed in them
  for (const [i, e] of entries.entries()) {
    for (const s of cfg.subFields) {
      const err = errors[`${e.id}/${s.id}`];
      if (err) out.push({ key: `${field.id}#${e.id}/${s.id}`, message: `${cfg.entryLabel} ${i + 1} — ${s.label}: ${err}` });
    }
  }
  return out;
}

function validateGroup(field: FormField, value: AnswerValue): string | null {
  return groupIssues(field, value)[0]?.message ?? null;
}

/** null = fine. Only meaningful for a SHOWN field; an empty optional answer is always fine. */
export function validateAnswer(field: FormField, value: AnswerValue): string | null {
  if (field.kind === 'group') return validateGroup(field, value);
  if (field.kind === 'table') return tableIssues(field, value)[0]?.message ?? null;
  if (!isAnswered(value)) return field.required ? 'This answer is required.' : null;
  switch (field.kind) {
    case 'short_text':
    case 'long_text': {
      const s = String(value);
      const max = field.validations.maxLength;
      if (max && s.length > max) return `Please keep it under ${max} characters.`;
      const words = field.validations.maxWords;
      if (words && wordCount(s) > words) return `Please keep it under ${words} words.`;
      return null;
    }
    case 'number': {
      const s = typeof value === 'string' ? value : '';
      if (!/^\d+$/.test(s)) return 'Digits only, please.';
      if (s.length > MAX_NUMBER_DIGITS) return `At most ${MAX_NUMBER_DIGITS} digits.`;
      return null;
    }
    case 'date': return typeof value === 'string' && isRealDate(value) ? null : 'Please enter a valid date.';
    case 'yes_no': return value === 'yes' || value === 'no' ? null : 'Please choose Yes or No.';
    case 'single_choice': return typeof value === 'string' && field.options.some((o) => o.id === value) ? null : 'Please choose one of the options.';
    case 'multiple_choice': {
      const ids = Array.isArray(value) ? value : [];
      return ids.length > 0 && ids.every((v) => field.options.some((o) => o.id === v)) ? null : 'Please choose from the options.';
    }
    case 'url': return typeof value === 'string' && isHttpUrl(value) ? null : value && typeof value === 'string' && value.length > MAX_URL_LENGTH ? 'That link is too long.' : 'Enter a link that starts with http:// or https://.';
    case 'email': return typeof value === 'string' && isEmail(value) ? null : 'Enter a valid email address.';
    case 'file': {
      const files = fileValues(value);
      if (files.length === 0) return 'Please attach a file.';
      const formats = fileFormatsOf(field.validations);
      const maxFiles = maxFilesOf(field.validations);
      if (files.length > maxFiles) return maxFiles === 1 ? 'Only one file can be attached here.' : `You can attach at most ${maxFiles} files.`;
      const allowedMime = formats.flatMap((f) => FILE_FORMATS[f].mime);
      const maxMb = maxFileMbOf(field.validations);
      for (const f of files) {
        if (isMacroName(f.fileName)) return MACROS_REFUSED;
        if (!formatOfName(f.fileName, formats)) return notAcceptedMessage(formats, f.fileName);
        if (f.mime && !allowedMime.includes(f.mime)) return declaredTypeMessage(formats, f.fileName, f.mime);
        if (f.size > maxMb * 1024 * 1024) return `The file is too large (maximum ${maxMb} MB).`;
      }
      return null;
    }
  }
}

/**
 * Validate a whole set of answers: ONLY shown fields count, so a required question hidden by its condition never
 * blocks (§6.2). Returns fieldId -> message; empty = valid.
 */
export function validateAnswers(fields: FormField[], answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of visibleFields(fields, answers)) {
    const err = validateAnswer(f, answers[f.id]);
    if (err) errors[f.id] = err;
  }
  return errors;
}

/** Same, but for one page (what "Next" checks). */
export function validatePage(fields: FormField[], answers: Answers, page: number): Record<string, string> {
  const all = validateAnswers(fields, answers);
  const onPage = new Set(visibleFields(fields, answers).filter((f) => f.page === page).map((f) => f.id));
  return Object.fromEntries(Object.entries(all).filter(([id]) => onPage.has(id)));
}
