// Prompt 918 (I2) — eligibility rules (spec §7), everything that is not a screen or a database: the kinds of rule, reading what the editor sent (strictly), the SENTENCE that says each rule with its boundary
// ("Applicants who state exactly €500,000 are eligible."), what is wrong with a rule whose question changed, and — for the objective ones — the evaluation of one answer (the internal engine of I3 uses it).
// No I/O, no React. Each rule is tied to one question or document of THIS call's form by its stable id.
import { formatNumberDisplay, isRealDate } from './form-logic';
import { formatDayInZone } from './tz';
import type { AnswerValue, Call, FieldKind, FormField } from './types';

export const RULE_KINDS = ['options', 'number', 'date', 'yes_no', 'doc_present', 'doc_right', 'doc_valid', 'doc_authentic', 'open'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  options: 'Options', number: 'Number', date: 'Date', yes_no: 'Yes / No',
  doc_present: 'Document present', doc_right: 'Right document', doc_valid: 'Valid document', doc_authentic: 'Authentic document', open: 'Open answer',
};

export const MAX_RULES = 60;
export const MAX_RULE_TEXT = 600;

export type NumberOp = 'eq' | 'gte' | 'gt' | 'lte' | 'lt' | 'between';
export type DateOp = 'within_last' | 'on_or_after' | 'on_or_before';
export type DateReference = 'call_opens' | 'call_closes' | 'fixed';

/** The parameters of each kind, already checked. `kind` decides which one applies. */
export interface OptionsParams { accepted: string[]; mode: 'any' | 'only' }
export interface NumberParams { op: NumberOp; value: number; value2?: number }
export interface DateParams { op: DateOp; amount?: number; unit?: 'months' | 'years'; reference?: DateReference; referenceDate?: string; date?: string }
export interface YesNoParams { expected: 'yes' | 'no' }
export interface DocRightParams { docType: string | null }
export interface DocValidParams { maxAgeMonths: number | null; matchName: string | null; matchTaxId: string | null }
export interface OpenParams { text: string }
export type RuleParams = OptionsParams | NumberParams | DateParams | YesNoParams | DocRightParams | DocValidParams | OpenParams | Record<string, never>;

export interface EligibilityRule {
  id: string;
  fieldId: string;
  kind: RuleKind;
  params: RuleParams;
  /** The entity's own words about the requirement (what the recipe of a document rule is prepared from). */
  note: string | null;
  position: number;
}

/** Which kinds of rule a question can have. A group and a table only take an open requirement. */
export function allowedKinds(kind: FieldKind): RuleKind[] {
  switch (kind) {
    case 'single_choice': case 'multiple_choice': return ['options', 'open'];
    case 'number': return ['number', 'open'];
    case 'date': return ['date', 'open'];
    case 'yes_no': return ['yes_no', 'open'];
    case 'file': return ['doc_present', 'doc_right', 'doc_valid', 'doc_authentic', 'open'];
    default: return ['open'];
  }
}
export const isDocKind = (k: RuleKind): boolean => k === 'doc_right' || k === 'doc_valid' || k === 'doc_authentic' || k === 'doc_present';

const MAX_NUMBER = 999_999_999_999_999;
const intIn = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ParsedRules = { ok: true; rules: EligibilityRule[] } | { ok: false; error: string };

/** Reads the rules the editor sent. Strict: a rule for a question that does not exist, of a kind it cannot have, or with parameters that do not fit, refuses the whole list with a sentence. */
export function parseRulesPayload(raw: unknown, fields: Pick<FormField, 'id' | 'kind' | 'label' | 'options'>[]): ParsedRules {
  if (!Array.isArray(raw)) return { ok: false, error: 'The rules must be a list.' };
  if (raw.length > MAX_RULES) return { ok: false, error: `A call can have at most ${MAX_RULES} rules.` };
  const byId = new Map(fields.map((f) => [f.id, f]));
  const out: EligibilityRule[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') return { ok: false, error: `Rule ${i + 1} is not valid.` };
    const field = typeof r.fieldId === 'string' ? byId.get(r.fieldId) : undefined;
    if (!field) return { ok: false, error: `Rule ${i + 1}: choose a question or document of the form.` };
    const kind = RULE_KINDS.find((k) => k === r.kind);
    const where = `Rule ${i + 1} (“${field.label}”)`;
    if (!kind) return { ok: false, error: `${where}: unknown kind of rule.` };
    if (!allowedKinds(field.kind).includes(kind)) return { ok: false, error: `${where}: a ${RULE_KIND_LABELS[kind].toLowerCase()} rule does not fit this question.` };
    const p = (r.params && typeof r.params === 'object' && !Array.isArray(r.params) ? r.params : {}) as Record<string, unknown>;
    let params: RuleParams;
    switch (kind) {
      case 'options': {
        const accepted = [...new Set((Array.isArray(p.accepted) ? p.accepted : []).filter((x): x is string => typeof x === 'string' && field.options.some((o) => o.id === x)))];
        if (accepted.length === 0) return { ok: false, error: `${where}: choose at least one accepted option.` };
        if (accepted.length === field.options.length) return { ok: false, error: `${where}: every option is accepted, so the rule would never exclude anyone.` };
        params = { accepted, mode: p.mode === 'only' ? 'only' : 'any' };
        break;
      }
      case 'number': {
        const op = (['eq', 'gte', 'gt', 'lte', 'lt', 'between'] as const).find((o) => o === p.op);
        const value = intIn(p.value, 0, MAX_NUMBER);
        if (!op || value === null) return { ok: false, error: `${where}: give the comparison and a number (digits only).` };
        if (op === 'between') {
          const value2 = intIn(p.value2, 0, MAX_NUMBER);
          if (value2 === null || value2 < value) return { ok: false, error: `${where}: “between” needs two numbers, the second not smaller than the first.` };
          params = { op, value, value2 };
        } else params = { op, value };
        break;
      }
      case 'date': {
        const op = (['within_last', 'on_or_after', 'on_or_before'] as const).find((o) => o === p.op);
        if (!op) return { ok: false, error: `${where}: choose how the date is compared.` };
        if (op === 'within_last') {
          const unit = p.unit === 'months' ? 'months' : p.unit === 'years' ? 'years' : null;
          const amount = intIn(p.amount, 1, 600);
          const reference = (['call_opens', 'call_closes', 'fixed'] as const).find((x) => x === p.reference) ?? 'call_opens';
          const referenceDate = reference === 'fixed' ? clean(p.referenceDate, 10) : undefined;
          if (!unit || amount === null) return { ok: false, error: `${where}: say how long (a number of months or years).` };
          if (reference === 'fixed' && !isRealDate(referenceDate ?? '')) return { ok: false, error: `${where}: give the reference date.` };
          params = { op, amount, unit, reference, ...(referenceDate ? { referenceDate } : {}) };
        } else {
          const date = clean(p.date, 10);
          if (!isRealDate(date)) return { ok: false, error: `${where}: give the date.` };
          params = { op, date };
        }
        break;
      }
      case 'yes_no':
        if (p.expected !== 'yes' && p.expected !== 'no') return { ok: false, error: `${where}: say which answer is eligible.` };
        params = { expected: p.expected };
        break;
      case 'doc_right': params = { docType: clean(p.docType, 60) || null }; break;
      case 'doc_valid': {
        const maxAgeMonths = p.maxAgeMonths === null || p.maxAgeMonths === undefined || p.maxAgeMonths === '' ? null : intIn(p.maxAgeMonths, 1, 240);
        if (p.maxAgeMonths !== null && p.maxAgeMonths !== undefined && p.maxAgeMonths !== '' && maxAgeMonths === null) return { ok: false, error: `${where}: the age of the document must be a number of months.` };
        const ref = (v: unknown): string | null => { const s = clean(v, 64); return s && UUID.test(s) && byId.has(s) ? s : null; };
        params = { maxAgeMonths, matchName: ref(p.matchName), matchTaxId: ref(p.matchTaxId) };
        break;
      }
      case 'open': {
        const text = clean(p.text, MAX_RULE_TEXT);
        if (!text) return { ok: false, error: `${where}: write the requirement.` };
        params = { text };
        break;
      }
      default: params = {};
    }
    // Two identical rules would only repeat each other (an open requirement is free text: several are fine).
    const key = `${field.id}:${kind}`;
    if (kind !== 'open' && seen.has(key)) return { ok: false, error: `${where}: there is already a ${RULE_KIND_LABELS[kind].toLowerCase()} rule for this question.` };
    seen.add(key);
    const id = typeof r.id === 'string' && UUID.test(r.id) ? r.id : globalThis.crypto.randomUUID();
    if (out.some((x) => x.id === id)) return { ok: false, error: `${where}: repeated rule.` };
    out.push({ id, fieldId: field.id, kind, params, note: clean(r.note, MAX_RULE_TEXT) || null, position: i });
  }
  return { ok: true, rules: out };
}

// --- The sentence ---------------------------------------------------------------------------------------------------------------------------

export interface SentenceContext {
  currency: string;
  call: Pick<Call, 'opensAt' | 'closesAt' | 'timezone'>;
  /** The name of a document type, for "Right document" (the recipe's label); the rule's own docType key otherwise. */
  docTypeLabel?: (key: string | null) => string | null;
}

const money = (n: number, currency: string): string => formatNumberDisplay(String(n), currency);

/** "5 years" / "1 month". */
const span = (amount: number, unit: 'months' | 'years'): string => `${amount} ${unit === 'years' ? (amount === 1 ? 'year' : 'years') : amount === 1 ? 'month' : 'months'}`;

/** The rule in one sentence, with the boundary stated ("exactly …" is eligible or not). The same sentence the entity reads and, later, the one an application's result quotes. */
export function ruleSentence(rule: EligibilityRule, field: Pick<FormField, 'label' | 'options' | 'kind'> | undefined, ctx: SentenceContext): string {
  const q = `“${field?.label ?? 'a question that no longer exists'}”`;
  const p = rule.params as unknown as Record<string, unknown>;
  switch (rule.kind) {
    case 'options': {
      const labels = ((p.accepted as string[]) ?? []).map((id) => field?.options.find((o) => o.id === id)?.label ?? '(removed option)').map((l) => `“${l}”`);
      const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}` : labels[0] ?? '';
      return p.mode === 'only'
        ? `Applicants whose every choice in ${q} is ${labels.length > 1 ? 'among' : ''} ${list} are eligible.`.replace('  ', ' ')
        : `Applicants who choose ${labels.length > 1 ? 'at least one of' : ''} ${list} in ${q} are eligible.`.replace('  ', ' ');
    }
    case 'number': {
      const v = Number(p.value); const m = (n: number) => money(n, ctx.currency);
      switch (p.op) {
        case 'eq': return `Applicants who state exactly ${m(v)} in ${q} are eligible.`;
        case 'gte': return `Applicants who state ${m(v)} or more in ${q} are eligible — exactly ${m(v)} is eligible.`;
        case 'gt': return `Applicants who state more than ${m(v)} in ${q} are eligible — exactly ${m(v)} is not eligible.`;
        case 'lte': return `Applicants who state ${m(v)} or less in ${q} are eligible — exactly ${m(v)} is eligible.`;
        case 'lt': return `Applicants who state less than ${m(v)} in ${q} are eligible — exactly ${m(v)} is not eligible.`;
        default: return `Applicants who state between ${m(v)} and ${m(Number(p.value2))} in ${q}, both included, are eligible.`;
      }
    }
    case 'date': {
      if (p.op === 'within_last') {
        const reference = referenceOf(p as unknown as DateParams, ctx);
        const when = reference ? `${formatDayInZone(reference.iso, ctx.call.timezone)} (${reference.label})` : 'the reference date (not set yet)';
        return `Applicants whose ${q} is no more than ${span(Number(p.amount), p.unit as 'months' | 'years')} before ${when} are eligible — exactly ${span(Number(p.amount), p.unit as 'months' | 'years')} before is eligible.`;
      }
      const d = formatDayInZone(`${String(p.date)}T12:00:00Z`, 'UTC');
      return p.op === 'on_or_after'
        ? `Applicants whose ${q} is on or after ${d} are eligible — ${d} itself is eligible.`
        : `Applicants whose ${q} is on or before ${d} are eligible — ${d} itself is eligible.`;
    }
    case 'yes_no': return `Applicants who answer “${p.expected === 'yes' ? 'Yes' : 'No'}” to ${q} are eligible.`;
    case 'doc_present': return `Applicants must attach a document to ${q}; one who attaches none is not a fit.`;
    case 'doc_right': {
      const label = ctx.docTypeLabel?.((p.docType as string | null) ?? null) ?? (p.docType as string | null);
      return `The file attached to ${q} must be ${label ? `a ${label}` : 'the kind of document the question asks for'}. A clearly different document is not a fit; when the platform cannot tell, a person checks it.`;
    }
    case 'doc_valid': {
      const parts: string[] = [];
      if (p.maxAgeMonths) parts.push(`issued within the last ${span(Number(p.maxAgeMonths), 'months')}`);
      if (p.matchName) parts.push('showing the same company name as declared');
      if (p.matchTaxId) parts.push('showing the same tax ID as declared');
      return `The document in ${q} must be ${parts.length > 0 ? parts.join(', ') : 'valid'}. Clearly outside that is not a fit; when it cannot be read or confirmed, a person checks it.`;
    }
    case 'doc_authentic': return `The authenticity of the document in ${q} is always checked by a person: the platform shows the verification code and the link to the official portal. It never excludes anyone by itself.`;
    case 'open': return `Open requirement: “${String(p.text)}”. A person decides every application it applies to (To validate); it never excludes anyone automatically.`;
  }
}

/** The day a "within the last …" date rule counts back from, as an instant, with how the sentence names it. */
function referenceOf(p: DateParams, ctx: SentenceContext): { iso: string; label: string } | null {
  const ref = p.reference ?? 'call_opens';
  if (ref === 'call_opens') return ctx.call.opensAt ? { iso: ctx.call.opensAt, label: 'the day the call opens' } : null;
  if (ref === 'call_closes') return ctx.call.closesAt ? { iso: ctx.call.closesAt, label: 'the day the call closes' } : null;
  return p.referenceDate ? { iso: `${p.referenceDate}T12:00:00Z`, label: 'the reference date' } : null;
}

// --- What is wrong with a rule -------------------------------------------------------------------------------------------------------------

/** A rule that cannot work any more (its question went away, changed kind, lost an accepted option, or needs a date the call does not have yet). Empty when it is fine. */
export function ruleProblems(rule: EligibilityRule, fields: Pick<FormField, 'id' | 'kind' | 'label' | 'options'>[], call: Pick<Call, 'opensAt' | 'closesAt' | 'timezone'>): string[] {
  const field = fields.find((f) => f.id === rule.fieldId);
  if (!field) return ['The question or document this rule was about no longer exists in the form.'];
  if (!allowedKinds(field.kind).includes(rule.kind)) return [`“${field.label}” is now a different kind of question: this rule no longer fits it.`];
  const p = rule.params as unknown as Record<string, unknown>;
  const out: string[] = [];
  if (rule.kind === 'options') {
    const missing = ((p.accepted as string[]) ?? []).filter((id) => !field.options.some((o) => o.id === id));
    if (missing.length > 0) out.push(`An accepted option of “${field.label}” was removed.`);
    if (((p.accepted as string[]) ?? []).length === 0) out.push(`Choose at least one accepted option of “${field.label}”.`);
  }
  if (rule.kind === 'date' && p.op === 'within_last' && !referenceOf(p as unknown as DateParams, { currency: 'EUR', call })) out.push(`The call needs ${p.reference === 'call_closes' ? 'a closing' : 'an opening'} date for the rule on “${field.label}”.`);
  if (rule.kind === 'doc_valid') for (const key of ['matchName', 'matchTaxId'] as const) if (p[key] && !fields.some((f) => f.id === p[key])) out.push(`The question that “${field.label}” is compared with no longer exists.`);
  return out;
}

// --- Evaluating one answer (objective rules) ---------------------------------------------------------------------------------------------------

export type Outcome = 'pass' | 'fail' | 'validate';

/** What an application's visible reason starts with when a PERSON decided (the whole application, or one rule of it). */
export const RECLASSIFIED_BY_A_PERSON = 'Reclassified by a person: ';

/**
 * Any clear failure → Not a fit; else any doubt → To validate; else Fit. `overrides` are what a person decided on a rule: they replace the engine's verdict of that rule AND its reason — the reason that is shown for a rule
 * a person corrected is theirs ("Reclassified by a person: …"), never the engine's, which is no longer what decided it (Prompt 922, Adenda 1, 29/10/2026). Pure: the engine, the review and the screens read the same thing.
 */
export function aggregateRules(
  results: { ruleId: string; outcome: Outcome; reason: string }[], overrides: Record<string, { outcome: Outcome; why?: string }> = {},
): { status: 'fit' | 'not_fit' | 'to_validate'; reason: string } {
  const humanReason = (id: string): string | null => (overrides[id]?.why?.trim() ? `${RECLASSIFIED_BY_A_PERSON}${overrides[id].why!.trim()}` : null);
  const final = results.map((r) => ({ ...r, outcome: overrides[r.ruleId]?.outcome ?? r.outcome, reason: humanReason(r.ruleId) ?? r.reason }));
  const failed = final.filter((r) => r.outcome === 'fail');
  if (failed.length > 0) return { status: 'not_fit', reason: failed.map((r) => r.reason).join(' ') };
  const doubts = final.filter((r) => r.outcome === 'validate');
  if (doubts.length > 0) return { status: 'to_validate', reason: doubts.map((r) => r.reason).join(' ') };
  const corrected = results.filter((r) => humanReason(r.ruleId)).map((r) => humanReason(r.ruleId) as string);
  return { status: 'fit', reason: final.length === 0 ? 'There are no eligibility rules: every submitted application is a Fit.' : corrected.length > 0 ? corrected.join(' ') : 'Meets every eligibility rule.' };
}
export interface RuleResult { ruleId: string; outcome: Outcome; reason: string; evidence?: { quote?: string; page?: number | null; fileName?: string } | null }

const answered = (v: AnswerValue): boolean => v !== null && v !== undefined && (typeof v !== 'string' || v.trim() !== '') && (!Array.isArray(v) || v.length > 0);

/** Months between two YYYY-MM-DD days counted back from `ref`: the earliest day a "within the last N" date may have. */
export function earliestAllowed(refDay: string, amount: number, unit: 'months' | 'years'): string {
  const [y, m, d] = refDay.split('-').map(Number);
  const totalMonths = y * 12 + (m - 1) - amount * (unit === 'years' ? 12 : 1);
  const ny = Math.floor(totalMonths / 12); const nm = totalMonths % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();      // 29 Feb − 1 year → 28 Feb
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
/** The call-local day (YYYY-MM-DD) of an instant. */
export function localDay(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return parts;
}

/**
 * The verdict of ONE objective rule (options, number, date, yes/no, document present) on ONE answer. `shown` is whether the question was displayed to this applicant (a conditional question that was
 * hidden cannot fail a rule — but nobody should pass silently either: it goes to a person). Fails only for clear, objective reasons.
 */
export function evaluateObjective(rule: EligibilityRule, field: Pick<FormField, 'label' | 'options'>, value: AnswerValue, ctx: { call: Pick<Call, 'opensAt' | 'closesAt' | 'timezone'>; currency: string; shown?: boolean }): RuleResult {
  const q = `“${field.label}”`;
  const res = (outcome: Outcome, reason: string): RuleResult => ({ ruleId: rule.id, outcome, reason });
  const p = rule.params as unknown as Record<string, unknown>;
  if (ctx.shown === false) return res('validate', `${q} was not shown to this applicant (a condition hid it): a person should check.`);
  if (rule.kind === 'doc_present') return answered(value) ? res('pass', `A document was attached to ${q}.`) : res('fail', `No document was attached to ${q}.`);
  if (!answered(value)) return res('fail', `No answer was given to ${q}.`);
  switch (rule.kind) {
    case 'options': {
      const chosen = Array.isArray(value) ? (value as string[]) : [String(value)];
      const accepted = (p.accepted as string[]) ?? [];
      const names = chosen.map((id) => field.options.find((o) => o.id === id)?.label ?? id);
      const ok = p.mode === 'only' ? chosen.every((id) => accepted.includes(id)) : chosen.some((id) => accepted.includes(id));
      return ok ? res('pass', `${q}: ${names.join(', ')} is accepted.`) : res('fail', `${q}: ${names.join(', ')} is not among the accepted options.`);
    }
    case 'number': {
      const n = Number(typeof value === 'string' ? value.replace(/\D/g, '') : NaN);
      if (!Number.isFinite(n)) return res('validate', `${q}: the number could not be read.`);
      const v = Number(p.value); const v2 = Number(p.value2);
      const ok = p.op === 'eq' ? n === v : p.op === 'gte' ? n >= v : p.op === 'gt' ? n > v : p.op === 'lte' ? n <= v : p.op === 'lt' ? n < v : n >= v && n <= v2;
      const shown = money(n, ctx.currency);
      return ok ? res('pass', `${q}: ${shown} is within the limit.`) : res('fail', `${q}: ${shown} is outside the limit.`);
    }
    case 'date': {
      const d = typeof value === 'string' ? value : '';
      if (!isRealDate(d)) return res('validate', `${q}: the date could not be read.`);
      if (p.op === 'on_or_after') return d >= String(p.date) ? res('pass', `${q}: ${d} is on or after the limit.`) : res('fail', `${q}: ${d} is before ${String(p.date)}.`);
      if (p.op === 'on_or_before') return d <= String(p.date) ? res('pass', `${q}: ${d} is on or before the limit.`) : res('fail', `${q}: ${d} is after ${String(p.date)}.`);
      const ref = referenceOf(p as unknown as DateParams, { currency: ctx.currency, call: ctx.call });
      if (!ref) return res('validate', `The reference date for ${q} is not set: a person should check.`);
      const earliest = earliestAllowed(localDay(ref.iso, ctx.call.timezone), Number(p.amount), p.unit as 'months' | 'years');
      return d >= earliest ? res('pass', `${q}: ${d} is not older than ${earliest}.`) : res('fail', `${q}: ${d} is older than ${earliest}.`);
    }
    case 'yes_no': return value === p.expected ? res('pass', `${q}: the answer is “${p.expected === 'yes' ? 'Yes' : 'No'}”.`) : res('fail', `${q}: the answer is “${value === 'yes' ? 'Yes' : 'No'}”, not “${p.expected === 'yes' ? 'Yes' : 'No'}”.`);
    default: return res('validate', `${q}: this rule is checked by a person.`);
  }
}

// --- An open requirement → a closed question ---------------------------------------------------------------------------------------------------

/** What the platform proposes instead of an open requirement (§7.1: avoid rules on open answers): a Yes/No question the applicant answers, and a Yes/No rule on it. */
export function suggestClosedQuestion(openText: string): { label: string; expected: 'yes' } {
  const t = openText.replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  const label = t.endsWith('?') ? t : `Can you confirm the following? ${t}.`;
  return { label: label.slice(0, 500), expected: 'yes' };
}
