// Prompt 907 (I2) — what the server keeps of the answers an applicant's browser sends (spec §6.2, §14.1). Pure.
//
// The browser is not trusted: only the questions of THIS call survive, each coerced to its own type (numbers to digits only, a choice
// to one of its option ids, a date to a real date); a file answer is rebuilt from the file the SERVER registered for that question (the
// applicant cannot name a path or a size). Empty answers are dropped. Hidden questions are kept in a DRAFT (switching an answer back
// must not lose what was typed) and pruned when the application is submitted: what the applicant cannot see is never submitted. A text the
// applicant cleared keeps its (empty) key — it WAS edited, so the profile never refills it; every other empty answer is dropped.
//
// Prompt 917 (I1): a link and an email are kept as typed (a half-typed link must survive the autosave; the final check refuses a wrong one);
// a File question may hold several files; a repeatable group is a list of entries, each coerced question by question with the very same rules —
// and when the entity pre-defined the rows, the text of their first columns is the entity's, whatever the browser sent.
import { isRealDate, sanitizeNumberInput } from '../form-logic';
import { coerceTable, tableOf } from '../table';
import { MAX_URL_LENGTH, groupOf, groupStarted, maxFilesOf, mimeOfName, newEntryId, presetEntriesFor, subFieldAsField } from '../field-config';
import { MAX_NUMBER_DIGITS, type Answers, type AnswerValue, type FileValue, type FormField, type GroupEntry, type SimpleAnswer } from '../types';

export interface FileRef {
  id: string;
  fieldId: string;
  source: 'upload' | 'vault';
  fileName: string;
  size: number;
  versionNumber?: number | null;
  documentId?: string | null;
  /** Prompt 917: the entry of a repeatable group this file belongs to (null for a File question of the form itself). */
  entryId?: string | null;
}

/** The answer a registered file stands for. */
export const fileValue = (f: FileRef): FileValue => ({ fileName: f.fileName, size: f.size, mime: mimeOfName(f.fileName) ?? 'application/pdf', fileId: f.id, source: f.source });
/** Kept for the callers that expect an AnswerValue. */
export const fileAnswer = (f: FileRef): AnswerValue => fileValue(f);

const MAX_TEXT = 20_000;
const MAX_ANSWERS_BYTES = 400_000;
const ENTRY_ID_OK = /^[A-Za-z0-9_-]{4,64}$/;

function coerce(field: FormField, v: unknown, files: FileRef[]): SimpleAnswer {
  switch (field.kind) {
    case 'short_text':
    case 'long_text':
      return typeof v === 'string' ? v.slice(0, MAX_TEXT) : undefined;
    case 'url':
    case 'email':
      return typeof v === 'string' ? v.slice(0, field.kind === 'url' ? MAX_URL_LENGTH : 254) : undefined;
    case 'number': {
      if (typeof v !== 'string') return undefined;
      const digits = sanitizeNumberInput(v).slice(0, MAX_NUMBER_DIGITS);
      return digits || undefined;
    }
    case 'date':
      return typeof v === 'string' && isRealDate(v) ? v : undefined;
    case 'yes_no':
      return v === 'yes' || v === 'no' ? v : undefined;
    case 'single_choice':
      return typeof v === 'string' && field.options.some((o) => o.id === v) ? v : undefined;
    case 'multiple_choice': {
      if (!Array.isArray(v)) return undefined;
      const ids = [...new Set(v.filter((x): x is string => typeof x === 'string' && field.options.some((o) => o.id === x)))];
      return ids.length > 0 ? ids : undefined;
    }
    case 'file': {
      // One file (an object) or several (a list): each is rebuilt from a file the server registered FOR THIS QUESTION; no more than the question takes.
      const wanted = (Array.isArray(v) ? v : [v]).map((x) => (x && typeof x === 'object' ? (x as { fileId?: unknown }).fileId : null)).filter((x): x is string => typeof x === 'string');
      const refs = [...new Set(wanted)].map((id) => files.find((f) => f.id === id && f.fieldId === field.id)).filter((r): r is FileRef => !!r).slice(0, maxFilesOf(field.validations));
      if (refs.length === 0) return undefined;
      return maxFilesOf(field.validations) > 1 ? refs.map(fileValue) : fileValue(refs[0]);
    }
    case 'group':
      return undefined;                                       // handled by coerceGroup (a group is not a simple answer)
  }
}

function coerceGroup(field: FormField, v: unknown, files: FileRef[]): GroupEntry[] | undefined {
  const cfg = groupOf(field);
  if (!cfg || !Array.isArray(v)) return undefined;
  const preset = cfg.presetRows;
  const raw = (v as unknown[]).filter((e): e is { id?: unknown; values?: unknown } => !!e && typeof e === 'object' && !Array.isArray(e));
  // Pre-defined rows: exactly those rows, in that order, whatever the browser sent; otherwise at most `max` entries, kept even while still empty.
  const wanted = preset.length > 0 ? preset.map((_, i) => raw.find((e) => e.id === `row${i + 1}`) ?? (raw.some((e) => typeof e.id === 'string' && /^row\d+$/.test(e.id)) ? {} : raw[i]) ?? {}) : raw.slice(0, cfg.max);
  const seen = new Set<string>();
  const entries: GroupEntry[] = wanted.map((e, i) => {
    let id = preset.length > 0 ? `row${i + 1}` : typeof e.id === 'string' && ENTRY_ID_OK.test(e.id) ? e.id : newEntryId();
    if (seen.has(id)) id = newEntryId();
    seen.add(id);
    const input = e.values && typeof e.values === 'object' && !Array.isArray(e.values) ? (e.values as Record<string, unknown>) : {};
    const values: Record<string, SimpleAnswer> = {};
    cfg.subFields.forEach((s, col) => {
      const presetText = preset[i]?.[col];
      if (presetText !== undefined && presetText !== '') { values[s.id] = presetText; return; }       // the entity's own text: read-only for the applicant
      if (!Object.prototype.hasOwnProperty.call(input, s.id)) return;
      const value = coerce(subFieldAsField(s), input[s.id], files);
      if (value !== undefined) values[s.id] = value;
    });
    return { id, values };
  });
  // An optional table whose rows nobody filled in is not an answer: only the entity's own fixed text would be stored.
  if (preset.length > 0 && !field.required && !groupStarted(cfg, entries)) return undefined;
  return entries.length > 0 ? entries : undefined;
}

export function sanitizeAnswers(fields: FormField[], raw: unknown, files: FileRef[] = []): Answers {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Answers = {};
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(input, f.id)) continue;
    // A table keeps ONLY what the applicant may author (their own columns and rows, within the entity's limits, and the cells): the entity's headers are never read from the request (coerceTable).
    const tableCfg = tableOf(f);
    const value = f.kind === 'group' ? coerceGroup(f, input[f.id], files) : tableCfg ? coerceTable(tableCfg, input[f.id]) : coerce(f, input[f.id], files);
    if (value !== undefined) out[f.id] = value;
  }
  if (JSON.stringify(out).length > MAX_ANSWERS_BYTES) throw new Error('These answers are too large.');
  return out;
}

/** The answers with a group's pre-defined rows filled in even when nothing was typed yet (so the applicant sees the rows from the start). */
export function withPresetRows(fields: FormField[], answers: Answers): Answers {
  const out = { ...answers };
  for (const f of fields) {
    const cfg = groupOf(f);
    if (!cfg || cfg.presetRows.length === 0) continue;
    out[f.id] = presetEntriesFor(cfg, out[f.id]);
  }
  return out;
}
