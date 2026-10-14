// Prompt 907 (I2) — what the server keeps of the answers an applicant's browser sends (spec §6.2, §14.1). Pure.
//
// The browser is not trusted: only the questions of THIS call survive, each coerced to its own type (numbers to digits only, a choice
// to one of its option ids, a date to a real date); a file answer is rebuilt from the file the SERVER registered for that question (the
// applicant cannot name a path or a size). Empty answers are dropped. Hidden questions are kept in a DRAFT (switching an answer back
// must not lose what was typed) and pruned when the application is submitted: what the applicant cannot see is never submitted. A text the
// applicant cleared keeps its (empty) key — it WAS edited, so the profile never refills it; every other empty answer is dropped.
import { isRealDate, sanitizeNumberInput } from '../form-logic';
import { MAX_NUMBER_DIGITS, type Answers, type AnswerValue, type FormField } from '../types';

export interface FileRef {
  id: string;
  fieldId: string;
  source: 'upload' | 'vault';
  fileName: string;
  size: number;
  versionNumber?: number | null;
  documentId?: string | null;
}

/** The answer a registered file stands for. */
export const fileAnswer = (f: FileRef): AnswerValue => ({ fileName: f.fileName, size: f.size, mime: 'application/pdf', fileId: f.id, source: f.source });

const MAX_TEXT = 20_000;
const MAX_ANSWERS_BYTES = 400_000;

function coerce(field: FormField, v: unknown, files: FileRef[]): AnswerValue {
  switch (field.kind) {
    case 'short_text':
    case 'long_text':
      return typeof v === 'string' ? v.slice(0, MAX_TEXT) : undefined;
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
      const id = v && typeof v === 'object' && !Array.isArray(v) ? (v as { fileId?: unknown }).fileId : null;
      const ref = typeof id === 'string' ? files.find((f) => f.id === id && f.fieldId === field.id) : undefined;
      return ref ? fileAnswer(ref) : undefined;
    }
  }
}

export function sanitizeAnswers(fields: FormField[], raw: unknown, files: FileRef[] = []): Answers {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Answers = {};
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(input, f.id)) continue;
    const value = coerce(f, input[f.id], files);
    if (value !== undefined) out[f.id] = value;
  }
  if (JSON.stringify(out).length > MAX_ANSWERS_BYTES) throw new Error('These answers are too large.');
  return out;
}
