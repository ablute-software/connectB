// Prompt 927 (E) — files in a call are at most 12 MB: the ceiling and the default are 12; the entity can pick a smaller limit but never a larger one nor "no limit"; 11.9 MB passes and 12.1 MB does not, in the
// browser's check and in the server's; the refusal reads "This file is 18.4 MB. The maximum is 12 MB." — one sentence for every path (a question, several files, a group, a contestation).
import { describe, expect, it } from 'vitest';
import { fileTooLargeMessage, maxFileMbOf, overFileLimit, parseSimpleValidations } from './field-config';
import { validateAnswer } from './form-logic';
import { MAX_CONTEST_FILE_MB } from './contestations';
import { DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING, type FormField } from './types';
import { newField } from './form-builder';

const MB = 1024 * 1024;
const fv = (name: string, size: number) => ({ fileName: name, size, mime: 'application/pdf' });
const fileField = (validations: FormField['validations'] = {}): FormField => ({ ...newField('file', 1, 0), validations });

describe('the ceiling is 12 MB', () => {
  it('is both the platform maximum and the default, for a question and for a contestation', () => {
    expect([DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING, MAX_CONTEST_FILE_MB]).toEqual([12, 12, 12]);
    expect(newField('file', 1, 0).validations.maxFileMb).toBe(12);
  });
  it('whatever is stored counts as at most 12: a larger limit, "no limit" or nothing at all', () => {
    expect(maxFileMbOf({ maxFileMb: 25 })).toBe(12);
    expect(maxFileMbOf({ maxFileMb: 50 })).toBe(12);
    expect(maxFileMbOf({})).toBe(12);
    expect(maxFileMbOf(undefined)).toBe(12);
    expect(maxFileMbOf({ maxFileMb: 5 })).toBe(5);                                   // the entity may choose less
  });
  it('the entity cannot SAVE more than 12 MB nor "no limit": it is brought to 12', () => {
    for (const raw of [25, 999, 13, Infinity, null, undefined, 0, -3, '', 'unlimited', NaN]) {
      const out = parseSimpleValidations('file', { maxFileMb: raw as never });
      expect(out.maxFileMb, String(raw)).toBe(12);
    }
    expect(parseSimpleValidations('file', { maxFileMb: 5 }).maxFileMb).toBe(5);
    expect(parseSimpleValidations('file', { maxFileMb: 12 }).maxFileMb).toBe(12);
  });
});

describe('11.9 MB passes and 12.1 MB does not', () => {
  it('the check itself: 12 MB exactly is accepted, one byte more is not', () => {
    expect(overFileLimit(11.9 * MB, 12)).toBe(false);
    expect(overFileLimit(12 * MB, 12)).toBe(false);
    expect(overFileLimit(12 * MB + 1, 12)).toBe(true);
    expect(overFileLimit(12.1 * MB, 12)).toBe(true);
  });
  it('the browser\'s check (the same one the server answers with): the sentence names the size, rounded up, and the maximum', () => {
    expect(fileTooLargeMessage(18.4 * MB, 12)).toBe('This file is 18.4 MB. The maximum is 12 MB.');
    expect(fileTooLargeMessage(12 * MB + 1, 12)).toBe('This file is 12.1 MB. The maximum is 12 MB.');       // never "12.0 MB" for a file that is over
    for (const validations of [{}, { maxFileMb: 25 }, { maxFileMb: 12 }]) {
      const f = fileField(validations);
      expect(validateAnswer(f, [fv('a.pdf', 11.9 * MB)]), JSON.stringify(validations)).toBeNull();
      expect(validateAnswer(f, [fv('a.pdf', 12.05 * MB)]), JSON.stringify(validations)).toBe('This file is 12.1 MB. The maximum is 12 MB.');
    }
    expect(validateAnswer(fileField({ maxFileMb: 5 }), [fv('a.pdf', 6 * MB)])).toBe('This file is 6.0 MB. The maximum is 5 MB.');
  });
});
