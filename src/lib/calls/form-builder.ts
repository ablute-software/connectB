// Prompt 905 — building a call's form (spec §6): the pure operations the editor applies to the list of fields,
// the sanitising the SERVER applies to what the editor sends, and the deterministic "Suggest pages". No I/O, no
// React, no AI (§2.3/§6.5: the page proposal is rules, not a model).
import { orderFields } from './form-logic';
import {
  DEFAULT_MAX_FILE_MB, FIELD_KINDS, MAPPABLE_KINDS, MAX_FILE_MB_CEILING, PLATFORM_MAPPING_KEYS, YES_NO_OPTIONS,
  isChoiceKind, type ConditionOperator, type FieldCondition, type FieldKind, type FieldOption, type FieldValidations,
  type FormField, type PlatformMappingKey,
} from './types';

// --- Ids ------------------------------------------------------------------------------------------------------------

const rand = (n: number) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};

export const newFieldId = (): string => globalThis.crypto.randomUUID();
/** Option ids are opaque and survive renaming; they are what eligibility, filters and quotas will point at. */
export const newOptionId = (): string => `opt_${rand(8)}`;

export const UNTITLED = 'Untitled question';
export const UNTITLED_DOCUMENT = 'Untitled document';

export function newField(kind: FieldKind, page = 1, position = 0): FormField {
  return {
    id: newFieldId(), page, position, kind, label: kind === 'file' ? UNTITLED_DOCUMENT : UNTITLED, instruction: null, required: false,
    options: kind === 'yes_no' ? YES_NO_OPTIONS.map((o) => ({ ...o }))
      : isChoiceKind(kind) ? [{ id: newOptionId(), label: 'Option 1' }, { id: newOptionId(), label: 'Option 2' }] : [],
    validations: kind === 'file' ? { maxFileMb: DEFAULT_MAX_FILE_MB } : {},
    condition: null, platformMapping: null, expectedType: null, maxAgeMonths: null,
  };
}

/** Append at the end of the last page (or page 1). */
export function appendField(fields: FormField[], kind: FieldKind): { fields: FormField[]; added: FormField } {
  const ordered = orderFields(fields);
  const last = ordered[ordered.length - 1];
  const added = newField(kind, last?.page ?? 1, ordered.length);
  return { fields: reflow([...ordered, added]), added };
}

/** Renaming an option changes its label only, never its id. */
export function renameOption(field: FormField, optionId: string, label: string): FormField {
  return { ...field, options: field.options.map((o) => (o.id === optionId ? { ...o, label } : o)) };
}
export function addOption(field: FormField): FormField {
  return { ...field, options: [...field.options, { id: newOptionId(), label: `Option ${field.options.length + 1}` }] };
}
export function removeOption(field: FormField, optionId: string): FormField {
  return { ...field, options: field.options.filter((o) => o.id !== optionId) };
}

/** Changing the type resets what no longer applies (options, validations, mapping, document details). */
export function changeKind(field: FormField, kind: FieldKind): FormField {
  if (kind === field.kind) return field;
  const base = newField(kind, field.page, field.position);
  return {
    ...field, kind,
    options: base.options, validations: base.validations,
    platformMapping: MAPPABLE_KINDS.includes(kind) ? field.platformMapping : null,
    expectedType: kind === 'file' ? field.expectedType : null, maxAgeMonths: kind === 'file' ? field.maxAgeMonths : null,
    // A condition on THIS field stays; conditions that pointed at its options elsewhere are checked by conditionProblems.
  };
}

// --- Order, pages -----------------------------------------------------------------------------------------------

/** Positions 0..n-1 per page, pages renumbered 1..k with no gaps. */
export function reflow(fields: FormField[]): FormField[] {
  const ordered = orderFields(fields);
  const pageMap = new Map<number, number>();
  const counters = new Map<number, number>();
  return ordered.map((f) => {
    if (!pageMap.has(f.page)) pageMap.set(f.page, pageMap.size + 1);
    const page = pageMap.get(f.page)!;
    const position = counters.get(page) ?? 0;
    counters.set(page, position + 1);
    return { ...f, page, position };
  });
}

const flat = (fields: FormField[]) => orderFields(fields);

/** The field must come AFTER the one it depends on; returns the offending field labels (empty = fine). */
export function conditionOrderProblems(fields: FormField[]): string[] {
  const order = new Map(flat(fields).map((f, i) => [f.id, i]));
  const out: string[] = [];
  for (const f of fields) {
    const c = f.condition;
    if (!c) continue;
    const at = order.get(c.fieldId);
    if (at === undefined || at >= (order.get(f.id) ?? 0)) out.push(f.label);
  }
  return out;
}

/** Move a field to a new flat index (drag and drop). Refuses a move that would put a field before its controller. */
export function moveField(fields: FormField[], id: string, toIndex: number): { fields: FormField[]; refused: string | null } {
  const ordered = flat(fields);
  const from = ordered.findIndex((f) => f.id === id);
  if (from < 0 || toIndex < 0 || toIndex >= ordered.length || from === toIndex) return { fields: reflow(ordered), refused: null };
  const moved = ordered[from];
  const next = ordered.filter((f) => f.id !== id);
  // The moved field joins the page of the neighbour it lands next to.
  const neighbour = next[Math.min(toIndex, next.length - 1)];
  const targetPage = toIndex === 0 ? next[0]?.page ?? moved.page : toIndex >= next.length ? next[next.length - 1].page : neighbour.page;
  next.splice(toIndex, 0, { ...moved, page: targetPage });
  const renumbered = next.map((f, i) => ({ ...f, position: i }));
  const bad = conditionOrderProblems(renumbered);
  if (bad.length > 0) return { fields: reflow(ordered), refused: `“${bad[0]}” depends on a question that must stay before it.` };
  return { fields: reflow(renumbered), refused: null };
}

/** Start a new page at this field. */
export function splitPageAt(fields: FormField[], id: string): FormField[] {
  const ordered = flat(fields);
  const idx = ordered.findIndex((f) => f.id === id);
  if (idx <= 0 || ordered[idx].page !== ordered[idx - 1].page) return reflow(ordered);
  const page = ordered[idx].page;
  return reflow(ordered.map((f, i) => (f.page === page && i >= idx ? { ...f, page: page + 0.5 } : f)));
}

/** Put this page's fields on the previous page. */
export function mergePageWithPrevious(fields: FormField[], page: number): FormField[] {
  const pages = [...new Set(flat(fields).map((f) => f.page))];
  const at = pages.indexOf(page);
  if (at <= 0) return reflow(fields);
  return reflow(fields.map((f) => (f.page === page ? { ...f, page: pages[at - 1] } : f)));
}

export function deleteField(fields: FormField[], id: string): FormField[] {
  // Anything that was shown only under this field loses its condition rather than dangling.
  return reflow(fields.filter((f) => f.id !== id).map((f) => (f.condition?.fieldId === id ? { ...f, condition: null } : f)));
}

// --- Suggest pages (§6.5): by subject, about five per page, deterministic, no AI --------------------------------------

const TOPICS: { topic: string; words: RegExp }[] = [
  // Stems match as prefixes ("competitor" also catches "competitors"); short acronyms need the closing boundary.
  { topic: 'company', words: /\b(company|startup|start-up|legal|vat\b|nif\b|incorporat|founded|constitu|website|address|country|sector|industry|name of)/i },
  { topic: 'team', words: /\b(team|founder|co-?founder|ceo\b|cto\b|cfo\b|people|employee|hire|hiring|linkedin|applicant|role|background|experience)/i },
  { topic: 'product', words: /\b(product|solution|problem|technolog|tech\b|customer|traction|user|mvp\b|prototype|patent|ip\b|innovation|pilot|validation)/i },
  { topic: 'market', words: /\b(market|competitor|competition|segment|strategy|go-?to-?market|tam\b|sam\b|som\b|growth|channel)/i },
  { topic: 'finance', words: /\b(revenue|funding|invest|round|valuation|burn|runway|financ|ticket|raise|capital|equity|budget|cost|profit|eur\b)|€/i },
];

export function topicOf(field: FormField): string {
  if (field.kind === 'file') return 'documents';
  if (field.platformMapping === 'person_name' || field.platformMapping === 'person_role') return 'team';
  if (field.platformMapping) return 'company';
  const text = `${field.label} ${field.instruction ?? ''}`;
  for (const t of TOPICS) if (t.words.test(text)) return t.topic;
  return 'general';
}

export const PAGE_TARGET = 5;

/**
 * Break the (unchanged) order into pages: a new page starts when the subject changes, or when a page reaches about
 * five fields. The ORDER is never touched, so display conditions stay valid. A page is never left with a single
 * field when it can be avoided. Same input, same pages.
 */
export function suggestPages(fields: FormField[]): FormField[] {
  const ordered = flat(fields);
  const pages: FormField[][] = [];
  let currentTopic = '';
  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i];
    const topic = topicOf(f);
    const page = pages[pages.length - 1];
    const remaining = ordered.length - i;
    const full = page && page.length >= PAGE_TARGET && !(page.length === PAGE_TARGET && remaining === 1);
    const topicChanged = page && topic !== currentTopic && page.length >= 2;
    if (!page || full || topicChanged) pages.push([f]); else page.push(f);
    currentTopic = topic;
  }
  return pages.flatMap((p, pi) => p.map((f, i) => ({ ...f, page: pi + 1, position: i })));
}

// --- What the server accepts ---------------------------------------------------------------------------------------------

const ID_OK = /^[A-Za-z0-9_-]{8,64}$/;
const OPERATORS: ConditionOperator[] = ['equals', 'not_equals', 'is_answered', 'is_empty'];
const clampInt = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : undefined;
};
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const MAX_FIELDS = 200;

export type ParsedFields = { ok: true; fields: FormField[] } | { ok: false; error: string };

/**
 * Turn whatever the editor sent into clean fields, or say why not. The editor builds valid data; this exists
 * because the server never trusts a client: kinds, option ids, validations, mappings and conditions are all checked
 * here, and "a condition must point at an earlier question" is enforced where it cannot be bypassed.
 */
export function parseFieldsPayload(input: unknown): ParsedFields {
  if (!Array.isArray(input)) return { ok: false, error: 'fields must be a list.' };
  if (input.length > MAX_FIELDS) return { ok: false, error: `A form can have at most ${MAX_FIELDS} fields.` };
  const seen = new Set<string>();
  const parsed: FormField[] = [];
  for (const raw of input as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid field.' };
    const kind = raw.kind as FieldKind;
    if (!FIELD_KINDS.includes(kind)) return { ok: false, error: `Unknown field type “${String(raw.kind)}”.` };
    const id = typeof raw.id === 'string' && ID_OK.test(raw.id) ? raw.id : newFieldId();
    if (seen.has(id)) return { ok: false, error: 'Duplicate field id.' };
    seen.add(id);

    let options: FieldOption[] = [];
    if (kind === 'yes_no') options = YES_NO_OPTIONS.map((o) => ({ ...o }));
    else if (isChoiceKind(kind)) {
      const rawOptions = Array.isArray(raw.options) ? (raw.options as Record<string, unknown>[]) : [];
      if (rawOptions.length > 100) return { ok: false, error: 'At most 100 options per question.' };
      const optSeen = new Set<string>();
      options = rawOptions.map((o) => {
        const oid = typeof o?.id === 'string' && ID_OK.test(o.id) ? o.id : newOptionId();
        return { id: oid, label: str(o?.label, 300) };
      }).filter((o) => { if (optSeen.has(o.id)) return false; optSeen.add(o.id); return true; });
    }

    const v = (raw.validations && typeof raw.validations === 'object' ? raw.validations : {}) as Record<string, unknown>;
    const validations: FieldValidations = {};
    if (kind === 'short_text' || kind === 'long_text') {
      const ml = clampInt(v.maxLength, 1, 20000); if (ml) validations.maxLength = ml;
      if (kind === 'long_text') { const mw = clampInt(v.maxWords, 1, 5000); if (mw) validations.maxWords = mw; }
    }
    if (kind === 'file') validations.maxFileMb = clampInt(v.maxFileMb, 1, MAX_FILE_MB_CEILING) ?? DEFAULT_MAX_FILE_MB;
    if (kind === 'number' && v.currency === true) validations.currency = true;

    let platformMapping: PlatformMappingKey | null = null;
    if (raw.platformMapping != null && raw.platformMapping !== '') {
      if (!PLATFORM_MAPPING_KEYS.includes(String(raw.platformMapping))) return { ok: false, error: 'Unknown platform data.' };
      if (!MAPPABLE_KINDS.includes(kind)) return { ok: false, error: 'Only text and single-choice questions can be linked to platform data.' };
      platformMapping = raw.platformMapping as PlatformMappingKey;
    }

    let condition: FieldCondition | null = null;
    if (raw.condition && typeof raw.condition === 'object') {
      const c = raw.condition as Record<string, unknown>;
      if (typeof c.fieldId !== 'string' || !OPERATORS.includes(c.operator as ConditionOperator)) return { ok: false, error: 'Invalid display condition.' };
      condition = { fieldId: c.fieldId, operator: c.operator as ConditionOperator, value: typeof c.value === 'string' ? c.value : null };
    }

    parsed.push({
      id, page: clampInt(raw.page, 1, 500) ?? 1, position: clampInt(raw.position, 0, 100000) ?? 0, kind,
      label: str(raw.label, 500) || (kind === 'file' ? UNTITLED_DOCUMENT : UNTITLED),
      instruction: str(raw.instruction, 2000) || null, required: raw.required === true,
      options, validations, condition, platformMapping,
      expectedType: kind === 'file' ? str(raw.expectedType, 200) || null : null,
      maxAgeMonths: kind === 'file' ? clampInt(raw.maxAgeMonths, 1, 240) ?? null : null,
    });
  }

  const fields = reflow(parsed);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const order = new Map(fields.map((f, i) => [f.id, i]));
  for (const f of fields) {
    const c = f.condition;
    if (!c) continue;
    const controller = byId.get(c.fieldId);
    if (!controller || (order.get(controller.id) ?? 0) >= (order.get(f.id) ?? 0)) {
      return { ok: false, error: `“${f.label}” has a display condition that must point at a question placed before it.` };
    }
    // A value is optional while the condition is being built; when present it must be one of the controller's options.
    if ((c.operator === 'equals' || c.operator === 'not_equals') && c.value && !controller.options.some((o) => o.id === c.value)) {
      return { ok: false, error: `“${f.label}”: the condition's value is not one of “${controller.label}”'s options.` };
    }
  }
  return { ok: true, fields };
}
