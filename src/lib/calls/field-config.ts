// Prompt 917 (I1) — the new kinds of question (link, email, file with formats and several files, repeatable group): what each one is configured with,
// how that configuration is read from whatever the editor sent, and the small pure helpers every side shares (entity editor, preview and test, the
// applicant's form, the server, the Submissions tab). No I/O, no React.
import {
  DEFAULT_MAX_FILE_MB, FILE_FORMAT_KEYS, MAX_FILES_CEILING, MAX_FILE_MB_CEILING, MAX_GROUP_ENTRIES, MAX_GROUP_SUBFIELDS, SIMPLE_KINDS, URL_HINTS,
  isChoiceKind, YES_NO_OPTIONS,
  type AnswerValue, type FieldKind, type FieldOption, type FieldValidations, type FileFormatKey, type FileValue, type FormField, type GroupConfig, type GroupEntry,
  type SimpleAnswer, type SimpleKind, type SubField, type UrlHint,
} from './types';

// --- Files ---------------------------------------------------------------------------------------------------------------------------------

export interface FileFormatInfo { label: string; extensions: string[]; accept: string; mime: string[] }
export const FILE_FORMATS: Record<FileFormatKey, FileFormatInfo> = {
  pdf: { label: 'PDF', extensions: ['pdf'], accept: 'application/pdf,.pdf', mime: ['application/pdf'] },
  word: { label: 'Word', extensions: ['docx'], accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  excel: { label: 'Excel', extensions: ['xlsx'], accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
  powerpoint: { label: 'PowerPoint', extensions: ['pptx'], accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', mime: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'] },
  image: { label: 'Image (JPG, PNG)', extensions: ['jpg', 'jpeg', 'png'], accept: 'image/jpeg,image/png,.jpg,.jpeg,.png', mime: ['image/jpeg', 'image/png'] },
};

type FileCfg = Pick<FieldValidations, 'fileFormats' | 'maxFiles' | 'maxFileMb'>;

/** The formats a question accepts: the ones chosen, in the platform's order; PDF when none was chosen. */
export function fileFormatsOf(v: FileCfg | undefined): FileFormatKey[] {
  const chosen = FILE_FORMAT_KEYS.filter((k) => v?.fileFormats?.includes(k));
  return chosen.length > 0 ? chosen : ['pdf'];
}
export const maxFilesOf = (v: FileCfg | undefined): number => Math.min(MAX_FILES_CEILING, Math.max(1, Math.floor(v?.maxFiles ?? 1)));
export const maxFileMbOf = (v: FileCfg | undefined): number => Math.min(v?.maxFileMb ?? DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING);
export const acceptAttr = (formats: FileFormatKey[]): string => formats.map((f) => FILE_FORMATS[f].accept).join(',');
/** "PDF", "PDF or Word", "PDF, Word or Excel". */
export function formatsText(formats: FileFormatKey[]): string {
  const names = formats.map((f) => FILE_FORMATS[f].label);
  return names.length <= 1 ? (names[0] ?? 'PDF') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}
const extOf = (name: string): string => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
/** Which of the accepted formats a file NAME belongs to (a first, cheap check in the browser; the server checks the bytes). */
export const formatOfName = (name: string, formats: FileFormatKey[]): FileFormatKey | null =>
  formats.find((f) => FILE_FORMATS[f].extensions.includes(extOf(name))) ?? null;
/** The content type to say for a file of this name. */
export function mimeOfName(name: string): string | undefined {
  const e = extOf(name);
  for (const k of FILE_FORMAT_KEYS) if (FILE_FORMATS[k].extensions.includes(e)) return FILE_FORMATS[k].mime[e === 'png' ? 1 : 0];
  return undefined;
}

// --- Link and email ---------------------------------------------------------------------------------------------------------------------

export const MAX_URL_LENGTH = 2000;
/** Only http:// and https://: never javascript:, data:, file: or anything else that could run or read something when opened. */
export function isHttpUrl(s: string): boolean {
  const v = s.trim();
  if (v.length === 0 || v.length > MAX_URL_LENGTH || /[\s<>"]/.test(v)) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname.includes('.') || u.hostname === 'localhost');
  } catch { return false; }
}
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
export const isEmail = (s: string): boolean => { const v = s.trim(); return v.length <= 254 && EMAIL.test(v); };

// --- Answers: what an answer holds, told apart ------------------------------------------------------------------------------------------

export const isFileValue = (v: unknown): v is FileValue =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as FileValue).fileName === 'string' && typeof (v as FileValue).size === 'number';
export const isGroupEntry = (v: unknown): v is GroupEntry =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as GroupEntry).id === 'string' && !!(v as GroupEntry).values && typeof (v as GroupEntry).values === 'object';

/** The files an answer holds: none, one, or a list. */
export function fileValues(v: SimpleAnswer | AnswerValue): FileValue[] {
  if (Array.isArray(v)) return (v as unknown[]).filter(isFileValue);
  return isFileValue(v) ? [v] : [];
}
export function entriesOf(v: AnswerValue): GroupEntry[] {
  return Array.isArray(v) ? (v as unknown[]).filter(isGroupEntry) : [];
}
const newId = (): string => globalThis.crypto.randomUUID();
export const newEntryId = (): string => `e_${newId().replace(/-/g, '').slice(0, 12)}`;
export const newEntry = (): GroupEntry => ({ id: newEntryId(), values: {} });

const filled = (v: unknown): boolean => v != null && v !== '' && !(typeof v === 'string' && v.trim() === '') && !(Array.isArray(v) && v.length === 0);

/**
 * The entries of a group as the person sees them. For a table with rows the entity set, the rows are ALWAYS there (their first columns filled in, read-only), whatever has
 * or has not been typed: before this, nothing created them and the applicant saw only the headings. Otherwise, the entries that were added.
 */
export function presetEntriesFor(cfg: GroupConfig, value: AnswerValue): GroupEntry[] {
  const existing = entriesOf(value);
  if (cfg.presetRows.length === 0) return existing;
  return cfg.presetRows.map((row, i) => {
    const values: Record<string, SimpleAnswer> = { ...(existing.find((e) => e.id === `row${i + 1}`)?.values ?? (existing.some((e) => /^row\d+$/.test(e.id)) ? {} : existing[i]?.values) ?? {}) };
    cfg.subFields.forEach((s, col) => { if (row[col]) values[s.id] = row[col]; });
    return { id: `row${i + 1}`, values };
  });
}

/** True once the person has put something of their own in the group (the entity's fixed text does not count). An optional group that was not started asks for nothing. */
export function groupStarted(cfg: GroupConfig, value: AnswerValue): boolean {
  return entriesOf(value).some((e, i) => cfg.subFields.some((s, col) => !cfg.presetRows[i]?.[col] && filled(e.values[s.id])));
}

/** A question inside a group, as a plain question: the same input, the same validation, the same sanitising as a top-level one. */
export function subFieldAsField(sub: SubField, position = 0): FormField {
  return {
    id: sub.id, page: 1, position, kind: sub.kind, label: sub.label, instruction: null, required: sub.required, options: sub.options, validations: sub.validations,
    condition: null, platformMapping: null, expectedType: null, maxAgeMonths: null,
  };
}

export const groupOf = (field: Pick<FormField, 'kind' | 'validations'>): GroupConfig | null => (field.kind === 'group' ? field.validations.group ?? null : null);

/** The entries a group must have at least: its minimum, and one more when the group is required and the minimum is 0. */
export const groupMin = (field: Pick<FormField, 'required'>, cfg: GroupConfig): number => (cfg.presetRows.length > 0 ? cfg.presetRows.length : Math.max(cfg.min, field.required ? 1 : 0));

/** Every question that can hold a file, by id: the File questions of the form and the File questions inside its groups. */
export function fileQuestions(fields: FormField[]): { id: string; label: string; validations: FieldValidations; groupId: string | null }[] {
  const out: { id: string; label: string; validations: FieldValidations; groupId: string | null }[] = [];
  for (const f of fields) {
    if (f.kind === 'file') out.push({ id: f.id, label: f.label, validations: f.validations, groupId: null });
    const g = groupOf(f);
    if (g) for (const s of g.subFields) if (s.kind === 'file') out.push({ id: s.id, label: s.label, validations: s.validations, groupId: f.id });
  }
  return out;
}

/** The ids of the files an answer set points at (File questions, several files, and Files inside group entries). */
export function fileIdsInAnswers(fields: FormField[], answers: Record<string, AnswerValue>): string[] {
  const ids: string[] = [];
  const take = (v: SimpleAnswer | AnswerValue) => { for (const f of fileValues(v)) if (typeof f.fileId === 'string') ids.push(f.fileId); };
  for (const f of fields) {
    if (f.kind === 'file') take(answers[f.id]);
    const g = groupOf(f);
    if (g) for (const e of entriesOf(answers[f.id])) for (const s of g.subFields) if (s.kind === 'file') take(e.values[s.id]);
  }
  return ids;
}

// --- Reading the configuration the editor sent ----------------------------------------------------------------------------------------------

const clampInt = (v: unknown, min: number, max: number): number | undefined => {
  // No value is no number: Number(null) is 0, which would be clamped UP to the minimum (a file saved with no age limit became "1 month", 16/10/2026).
  if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && v.trim() === '')) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : undefined;
};
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ID_OK = /^[A-Za-z0-9_-]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const newOptionIdLocal = (): string => `opt_${newId().replace(/-/g, '').slice(0, 8)}`;

/** The validations that apply to a kind (not the group: see parseGroupConfig), from whatever was sent. */
export function parseSimpleValidations(kind: SimpleKind, raw: unknown): Omit<FieldValidations, 'group'> {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Omit<FieldValidations, 'group'> = {};
  if (kind === 'short_text' || kind === 'long_text') {
    const ml = clampInt(v.maxLength, 1, 20000); if (ml) out.maxLength = ml;
    if (kind === 'long_text') { const mw = clampInt(v.maxWords, 1, 5000); if (mw) out.maxWords = mw; }
  }
  if (kind === 'number' && v.currency === true) out.currency = true;
  if (kind === 'url' && typeof v.urlHint === 'string' && (URL_HINTS as readonly string[]).includes(v.urlHint)) out.urlHint = v.urlHint as UrlHint;
  if (kind === 'file') {
    out.maxFileMb = clampInt(v.maxFileMb, 1, MAX_FILE_MB_CEILING) ?? DEFAULT_MAX_FILE_MB;
    const chosen = Array.isArray(v.fileFormats) ? FILE_FORMAT_KEYS.filter((k) => (v.fileFormats as unknown[]).includes(k)) : [];
    if (chosen.length > 0) out.fileFormats = chosen;           // omitted = PDF only, as before: existing questions stay as they are
    const mf = clampInt(v.maxFiles, 1, MAX_FILES_CEILING); if (mf && mf > 1) out.maxFiles = mf;
  }
  return out;
}

export type ParsedGroup = { ok: true; config: GroupConfig } | { ok: false; error: string };

export function parseGroupConfig(raw: unknown): ParsedGroup {
  const g = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!g) return { ok: false, error: 'A group needs its configuration.' };
  const rawSubs = Array.isArray(g.subFields) ? (g.subFields as Record<string, unknown>[]) : [];
  if (rawSubs.length === 0) return { ok: false, error: 'A group needs at least one question.' };
  if (rawSubs.length > MAX_GROUP_SUBFIELDS) return { ok: false, error: `A group can have at most ${MAX_GROUP_SUBFIELDS} questions.` };
  const seen = new Set<string>();
  const subFields: SubField[] = [];
  for (const s of rawSubs) {
    if (!s || typeof s !== 'object') return { ok: false, error: 'Invalid question in a group.' };
    const kind = s.kind as SimpleKind;
    if (!(SIMPLE_KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'A group cannot contain another group.' };
    const id = typeof s.id === 'string' && UUID.test(s.id) ? s.id : newId();
    if (seen.has(id)) return { ok: false, error: 'Duplicate question in a group.' };
    seen.add(id);
    let options: FieldOption[] = [];
    if (kind === 'yes_no') options = YES_NO_OPTIONS.map((o) => ({ ...o }));
    else if (isChoiceKind(kind)) {
      const ro = Array.isArray(s.options) ? (s.options as Record<string, unknown>[]) : [];
      if (ro.length > 100) return { ok: false, error: 'At most 100 options per question.' };
      const optSeen = new Set<string>();
      options = ro.map((o) => ({ id: typeof o?.id === 'string' && ID_OK.test(o.id) ? o.id : newOptionIdLocal(), label: str(o?.label, 300) }))
        .filter((o) => { if (optSeen.has(o.id)) return false; optSeen.add(o.id); return true; });
    }
    subFields.push({ id, kind, label: str(s.label, 300) || 'Untitled question', required: s.required === true, options, validations: parseSimpleValidations(kind, s.validations) });
  }
  const cols = subFields.length;
  const rows = Array.isArray(g.presetRows) ? (g.presetRows as unknown[]).slice(0, MAX_GROUP_ENTRIES) : [];
  const presetRows = rows.map((r) => (Array.isArray(r) ? (r as unknown[]).slice(0, cols).map((c) => str(c, 200)) : [])).filter((r) => r.some((c) => c !== ''));
  let min = clampInt(g.min, 0, MAX_GROUP_ENTRIES) ?? 0;
  let max = clampInt(g.max, 1, MAX_GROUP_ENTRIES) ?? 10;
  if (presetRows.length > 0) { min = presetRows.length; max = presetRows.length; }     // the entity set the rows: the applicant neither adds nor removes
  if (min > max) return { ok: false, error: 'The minimum number of entries cannot be above the maximum.' };
  const display = g.display === 'table' ? 'table' : 'cards';
  return { ok: true, config: { entryLabel: str(g.entryLabel, 80) || 'Entry', min, max, display, subFields, presetRows } };
}

/** What a new group starts as. */
export function defaultGroupConfig(): GroupConfig {
  return {
    entryLabel: 'Entry', min: 0, max: 10, display: 'cards', presetRows: [],
    subFields: [{ id: newId(), kind: 'short_text', label: 'Name', required: true, options: [], validations: {} }],
  };
}
export const newSubField = (kind: SimpleKind = 'short_text'): SubField => ({
  id: newId(), kind, label: 'Untitled question', required: false,
  options: kind === 'yes_no' ? YES_NO_OPTIONS.map((o) => ({ ...o })) : isChoiceKind(kind) ? [{ id: newOptionIdLocal(), label: 'Option 1' }, { id: newOptionIdLocal(), label: 'Option 2' }] : [],
  validations: kind === 'file' ? { maxFileMb: DEFAULT_MAX_FILE_MB } : {},
});

/** The kinds that have an editable configuration of their own beyond label and required. */
export const hasOwnConfig = (k: FieldKind): boolean => k === 'file' || k === 'url' || k === 'group' || k === 'table';

// --- Putting a file into the answers, and taking it out --------------------------------------------------------------------------------------

/** Where a file belongs: a File question of the form, or a File question inside one entry of a group. */
export interface FileTarget { questionId: string; groupId?: string; entryId?: string }

const putFile = (current: SimpleAnswer | AnswerValue, value: FileValue, maxFiles: number): FileValue | FileValue[] => {
  if (maxFiles <= 1) return value;
  const others = fileValues(current).filter((f) => f.fileId !== value.fileId);
  return [...others, value];
};

/** The answers with this file attached to its question (replacing the old one when the question takes a single file). */
export function setFileInAnswers(fields: FormField[], answers: Record<string, AnswerValue>, target: FileTarget, value: FileValue): Record<string, AnswerValue> {
  if (target.groupId && target.entryId) {
    const group = fields.find((f) => f.id === target.groupId);
    const cfg = group ? groupOf(group) : null;
    const sub = cfg?.subFields.find((s) => s.id === target.questionId);
    if (!cfg || !sub) return answers;
    const max = maxFilesOf(sub.validations);
    const entries = entriesOf(answers[target.groupId]).map((e) => (e.id === target.entryId ? { ...e, values: { ...e.values, [sub.id]: putFile(e.values[sub.id], value, max) } } : e));
    return { ...answers, [target.groupId]: entries };
  }
  const q = fields.find((f) => f.id === target.questionId);
  if (!q || q.kind !== 'file') return answers;
  return { ...answers, [q.id]: putFile(answers[q.id], value, maxFilesOf(q.validations)) };
}

/** The answers with this file taken out wherever it is (a File question, a list of files, an entry of a group); nothing else changes. */
export function removeFileFromAnswers(fields: FormField[], answers: Record<string, AnswerValue>, fileId: string): { answers: Record<string, AnswerValue>; changed: boolean } {
  let changed = false;
  const without = (v: SimpleAnswer | AnswerValue): SimpleAnswer => {
    const all = fileValues(v);
    if (!all.some((f) => f.fileId === fileId)) return v as SimpleAnswer;
    changed = true;
    const rest = all.filter((f) => f.fileId !== fileId);
    return rest.length === 0 ? undefined : Array.isArray(v) ? rest : rest[0];
  };
  const out: Record<string, AnswerValue> = { ...answers };
  for (const f of fields) {
    if (f.kind === 'file') {
      const next = without(answers[f.id]);
      if (next === undefined) delete out[f.id]; else out[f.id] = next;
      continue;
    }
    const cfg = groupOf(f);
    if (!cfg) continue;
    const fileSubs = cfg.subFields.filter((s) => s.kind === 'file');
    if (fileSubs.length === 0) continue;
    out[f.id] = entriesOf(answers[f.id]).map((e) => {
      const values = { ...e.values };
      for (const s of fileSubs) { const next = without(e.values[s.id]); if (next === undefined) delete values[s.id]; else values[s.id] = next; }
      return { ...e, values };
    });
  }
  return { answers: out, changed };
}

/** How many files the question a file belongs to takes (1 for a File question that was never given another number). */
export function maxFilesForTarget(fields: FormField[], target: FileTarget): number {
  if (target.groupId) {
    const cfg = groupOf(fields.find((f) => f.id === target.groupId) ?? ({ kind: 'file', validations: {} } as FormField));
    const sub = cfg?.subFields.find((s) => s.id === target.questionId);
    return sub ? maxFilesOf(sub.validations) : 1;
  }
  const q = fields.find((f) => f.id === target.questionId);
  return q ? maxFilesOf(q.validations) : 1;
}

/** Where, in these answers, a file sits: its question, and the entry when it is inside a group. */
export function locateFile(fields: FormField[], answers: Record<string, AnswerValue>, fileId: string): FileTarget | null {
  for (const f of fields) {
    if (f.kind === 'file' && fileValues(answers[f.id]).some((v) => v.fileId === fileId)) return { questionId: f.id };
    const cfg = groupOf(f);
    if (!cfg) continue;
    for (const e of entriesOf(answers[f.id])) for (const s of cfg.subFields) {
      if (s.kind === 'file' && fileValues(e.values[s.id]).some((v) => v.fileId === fileId)) return { questionId: s.id, groupId: f.id, entryId: e.id };
    }
  }
  return null;
}
