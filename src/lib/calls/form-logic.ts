// Prompt 905 — the rules a call's form obeys when someone ANSWERS it, in one pure module: the editor's
// preview runs it in the browser, and Prompt 906's submit runs the very same functions on the server
// (spec §6.2: "as condições são verificadas também no servidor"). No I/O, no React.
import {
  DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING, MAX_NUMBER_DIGITS,
  type AnswerValue, type Answers, type FieldCondition, type FormField,
} from './types';

export const orderFields = (fields: FormField[]): FormField[] =>
  [...fields].sort((a, b) => a.page - b.page || a.position - b.position);

// --- Presence -------------------------------------------------------------------------------------

export function isAnswered(value: AnswerValue): value is Exclude<AnswerValue, null | undefined> {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'object' && typeof value.fileName === 'string' && value.fileName !== '';
}

// --- Display conditions (§6.2) -----------------------------------------------------------------------

function matches(cond: FieldCondition, answer: AnswerValue): boolean {
  switch (cond.operator) {
    case 'is_answered': return isAnswered(answer);
    case 'is_empty': return !isAnswered(answer);
    case 'equals':
    case 'not_equals': {
      const target = cond.value ?? '';
      const hit = Array.isArray(answer) ? answer.includes(target) : typeof answer === 'string' ? answer === target : false;
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

/** null = fine. Only meaningful for a SHOWN field; an empty optional answer is always fine. */
export function validateAnswer(field: FormField, value: AnswerValue): string | null {
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
    case 'file': {
      if (typeof value !== 'object' || Array.isArray(value)) return 'Please attach a PDF.';
      const name = value.fileName.toLowerCase();
      if (!name.endsWith('.pdf') || (value.mime && value.mime !== 'application/pdf')) return 'Only PDF files are accepted.';
      const maxMb = Math.min(field.validations.maxFileMb ?? DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING);
      if (value.size > maxMb * 1024 * 1024) return `The file is too large (maximum ${maxMb} MB).`;
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
