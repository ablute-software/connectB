// Prompt 905 — the pure rules of Calls Stage 1: the switch, time zones, answering a form (digits-only numbers,
// PDF-only files, display conditions with hidden required fields), building a form (stable option ids, reorder,
// suggested pages, what the server accepts) and the call's life (readiness, publish, extend, close).
import { describe, expect, it } from 'vitest';
import { callsAllowedFor, callsMode, callsTestEmails } from './mode';
import { formatDayInZone, formatInZone, isValidTimeZone, utcToWall, wallToUtcIso } from './tz';
import {
  formatNumberDisplay, isFieldVisible, isRealDate, pruneHiddenAnswers, sanitizeNumberInput, validateAnswer, validateAnswers,
  validatePage, visibleFields, visiblePages,
} from './form-logic';
import {
  appendField, changeKind, conditionOrderProblems, deleteField, mergePageWithPrevious, moveField, newField, newOptionId,
  parseFieldsPayload, reflow, removeOption, renameOption, splitPageAt, suggestPages, topicOf,
} from './form-builder';
import {
  availableActions, closeEarly, confirmCall, editConfiguration, effectiveStatus, extendDeadline, linkPlaceholderText, publishCall, readiness, summarise,
} from './lifecycle';
import type { Call, CallPhase, FormField } from './types';

const f = (over: Partial<FormField> & Pick<FormField, 'id' | 'kind'>): FormField => ({
  page: 1, position: 0, label: `Q ${over.id}`, instruction: null, required: false, options: [], validations: {},
  condition: null, platformMapping: null, expectedType: null, maxAgeMonths: null, ...over,
});

describe('CALLS_MODE', () => {
  it('is off unless set, and off allows nobody', () => {
    for (const v of [undefined, '', 'maybe', 'true']) {
      expect(callsMode({ CALLS_MODE: v })).toBe('off');
      expect(callsAllowedFor('a@b.com', { CALLS_MODE: v })).toBe(false);
    }
  });
  it('allowlist lets in only the listed emails, case-insensitively; on lets in everyone', () => {
    const env = { CALLS_MODE: 'allowlist', CALLS_TEST_EMAILS: ' Nuno@Example.com , x@y.com ' };
    expect(callsTestEmails(env)).toEqual(['nuno@example.com', 'x@y.com']);
    expect(callsAllowedFor('NUNO@example.com', env)).toBe(true);
    expect(callsAllowedFor('other@example.com', env)).toBe(false);
    expect(callsAllowedFor(null, env)).toBe(false);
    expect(callsAllowedFor('a@b.com', { CALLS_MODE: 'on' })).toBe(true);
    expect(callsAllowedFor('a@b.com', { CALLS_MODE: 'allowlist' })).toBe(false);
  });
});

describe('time zones', () => {
  it('reads a wall-clock time in the chosen zone and gives back the UTC instant (summer and winter in Lisbon)', () => {
    expect(wallToUtcIso('2026-07-01T09:00', 'Europe/Lisbon')).toBe('2026-07-01T08:00:00.000Z');
    expect(wallToUtcIso('2026-01-15T09:00', 'Europe/Lisbon')).toBe('2026-01-15T09:00:00.000Z');
    expect(wallToUtcIso('2026-07-01T09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z');
    expect(wallToUtcIso('2026-07-01T09:00', 'UTC')).toBe('2026-07-01T09:00:00.000Z');
  });
  it('round-trips, and refuses nonsense and times that do not exist (the spring-forward gap)', () => {
    for (const tz of ['Europe/Lisbon', 'Asia/Singapore', 'America/Sao_Paulo']) {
      const iso = wallToUtcIso('2026-11-20T17:30', tz)!;
      expect(utcToWall(iso, tz)).toBe('2026-11-20T17:30');
    }
    expect(wallToUtcIso('2026-03-29T01:30', 'Europe/Lisbon')).toBeNull(); // 01:00 jumps to 02:00
    expect(wallToUtcIso('not a date', 'UTC')).toBeNull();
    expect(wallToUtcIso('2026-07-01T09:00', 'Mars/Phobos')).toBeNull();
    expect(isValidTimeZone('Europe/Lisbon')).toBe(true);
    expect(isValidTimeZone('Nope/Nope')).toBe(false);
  });
  it('formats with the zone spelled out', () => {
    expect(formatInZone('2026-07-01T08:00:00.000Z', 'Europe/Lisbon')).toContain('(Europe/Lisbon)');
    expect(formatInZone('2026-07-01T08:00:00.000Z', 'Europe/Lisbon')).toContain('09:00');
    expect(formatDayInZone('2026-07-01T23:30:00.000Z', 'Asia/Singapore')).toBe('02 Jul 2026');
    expect(formatInZone(null, 'UTC')).toBe('—');
  });
});

describe('numbers: digits only, no negatives, formatted underneath', () => {
  it('keeps digits only', () => {
    expect(sanitizeNumberInput('abc12,5.0-3')).toBe('12503');
    expect(sanitizeNumberInput('-500')).toBe('500');
    expect(sanitizeNumberInput('1e6')).toBe('16');
    expect(sanitizeNumberInput('')).toBe('');
    expect(sanitizeNumberInput('0007')).toBe('7');
    expect(sanitizeNumberInput('000')).toBe('0');
    expect(sanitizeNumberInput('1'.repeat(30))).toHaveLength(15);
  });
  it('formats with spaces and, when asked, the currency', () => {
    expect(formatNumberDisplay('500000')).toBe('500 000');
    expect(formatNumberDisplay('500000', 'EUR')).toBe('500 000 €');
    expect(formatNumberDisplay('1234567', 'USD')).toBe('1 234 567 $');
    expect(formatNumberDisplay('12', 'CHF')).toBe('12 CHF');
    expect(formatNumberDisplay('')).toBe('');
  });
  it('rejects anything that is not digits', () => {
    const n = f({ id: 'n', kind: 'number' });
    expect(validateAnswer(n, '1500')).toBeNull();
    for (const bad of ['-5', '1.5', '1,5', 'abc', '12a']) expect(validateAnswer(n, bad), bad).toBe('Digits only, please.');
  });
});

describe('answers per type', () => {
  it('required vs optional', () => {
    expect(validateAnswer(f({ id: 'a', kind: 'short_text', required: true }), '  ')).toBe('This answer is required.');
    expect(validateAnswer(f({ id: 'a', kind: 'short_text' }), '')).toBeNull();
    expect(validateAnswer(f({ id: 'a', kind: 'multiple_choice', required: true }), [])).toBe('This answer is required.');
  });
  it('text limits in characters and words', () => {
    expect(validateAnswer(f({ id: 'a', kind: 'short_text', validations: { maxLength: 5 } }), 'abcdef')).toContain('5 characters');
    expect(validateAnswer(f({ id: 'a', kind: 'long_text', validations: { maxWords: 3 } }), 'one two three four')).toContain('3 words');
    expect(validateAnswer(f({ id: 'a', kind: 'long_text', validations: { maxWords: 3 } }), 'one two three')).toBeNull();
  });
  it('dates must be real', () => {
    const d = f({ id: 'd', kind: 'date' });
    expect(validateAnswer(d, '2026-02-28')).toBeNull();
    expect(validateAnswer(d, '2026-02-30')).toBe('Please enter a valid date.');
    expect(isRealDate('2024-02-29')).toBe(true);
    expect(isRealDate('2025-02-29')).toBe(false);
  });
  it('yes/no has no default and only takes yes or no', () => {
    const yn = f({ id: 'y', kind: 'yes_no', required: true });
    expect(validateAnswer(yn, undefined)).toBe('This answer is required.');
    expect(validateAnswer(yn, 'yes')).toBeNull();
    expect(validateAnswer(yn, 'maybe')).toBe('Please choose Yes or No.');
  });
  it('choices take option ids only', () => {
    const opts = [{ id: 'o1', label: 'A' }, { id: 'o2', label: 'B' }];
    expect(validateAnswer(f({ id: 's', kind: 'single_choice', options: opts }), 'o1')).toBeNull();
    expect(validateAnswer(f({ id: 's', kind: 'single_choice', options: opts }), 'A')).toContain('options');
    expect(validateAnswer(f({ id: 'm', kind: 'multiple_choice', options: opts }), ['o1', 'o2'])).toBeNull();
    expect(validateAnswer(f({ id: 'm', kind: 'multiple_choice', options: opts }), ['o1', 'zzz'])).toContain('options');
  });
  it('files: PDF only, within the size limit', () => {
    const file = f({ id: 'f', kind: 'file', validations: { maxFileMb: 2 } });
    expect(validateAnswer(file, { fileName: 'deck.pdf', size: 1024 })).toBeNull();
    expect(validateAnswer(file, { fileName: 'DECK.PDF', size: 1024 })).toBeNull();
    expect(validateAnswer(file, { fileName: 'deck.docx', size: 1024 })).toBe('Only PDF files are accepted.');
    expect(validateAnswer(file, { fileName: 'deck.pdf', size: 1024, mime: 'image/png' })).toBe('Only PDF files are accepted.');
    expect(validateAnswer(file, { fileName: 'deck.pdf', size: 3 * 1024 * 1024 })).toContain('2 MB');
  });
});

describe('display conditions (§6.2)', () => {
  const inc = f({ id: 'inc', kind: 'yes_no', required: true, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] });
  const date = f({ id: 'date', kind: 'date', position: 1, required: true, condition: { fieldId: 'inc', operator: 'equals', value: 'yes' } });
  const vat = f({ id: 'vat', kind: 'short_text', position: 2, required: true, condition: { fieldId: 'date', operator: 'is_answered' } });
  const fields = [inc, date, vat];

  it('shows a field only when its condition holds', () => {
    expect(visibleFields(fields, {}).map((x) => x.id)).toEqual(['inc']);
    expect(visibleFields(fields, { inc: 'yes' }).map((x) => x.id)).toEqual(['inc', 'date']);
    expect(visibleFields(fields, { inc: 'yes', date: '2020-01-01' }).map((x) => x.id)).toEqual(['inc', 'date', 'vat']);
    expect(visibleFields(fields, { inc: 'no', date: '2020-01-01' }).map((x) => x.id)).toEqual(['inc']); // hiding the controller hides what hangs off it
  });
  it('a required field hidden by its condition does not block (and an answer to a hidden field is dropped)', () => {
    expect(validateAnswers(fields, { inc: 'no' })).toEqual({});
    expect(validateAnswers(fields, { inc: 'yes' })).toEqual({ date: 'This answer is required.' });
    expect(pruneHiddenAnswers(fields, { inc: 'no', date: '2020-01-01', vat: 'PT123' })).toEqual({ inc: 'no' });
  });
  it('supports not_equals, is_empty and multiple choice', () => {
    const multi = f({ id: 'm', kind: 'multiple_choice', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
    const ne = f({ id: 'x', kind: 'short_text', position: 1, condition: { fieldId: 'm', operator: 'not_equals', value: 'a' } });
    const emp = f({ id: 'y', kind: 'short_text', position: 2, condition: { fieldId: 'm', operator: 'is_empty' } });
    const set = [multi, ne, emp];
    expect(visibleFields(set, {}).map((x) => x.id)).toEqual(['m', 'x', 'y']);
    expect(visibleFields(set, { m: ['a'] }).map((x) => x.id)).toEqual(['m']);
    expect(visibleFields(set, { m: ['b'] }).map((x) => x.id)).toEqual(['m', 'x']);
  });
  it('a condition still being built (no value chosen yet) hides nothing', () => {
    const ctl = f({ id: 'ctl', kind: 'yes_no', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] });
    const half = f({ id: 'half', kind: 'short_text', position: 1, required: true, condition: { fieldId: 'ctl', operator: 'equals', value: null } });
    expect(visibleFields([ctl, half], {}).map((x) => x.id)).toEqual(['ctl', 'half']);
  });
  it('a condition pointing at a deleted field hides nothing, and a cycle cannot hang', () => {
    const orphan = f({ id: 'o', kind: 'short_text', required: true, condition: { fieldId: 'gone', operator: 'equals', value: 'x' } });
    expect(isFieldVisible(orphan, new Map([[orphan.id, orphan]]), {})).toBe(true);
    const a = f({ id: 'a', kind: 'short_text', condition: { fieldId: 'b', operator: 'is_answered' } });
    const b = f({ id: 'b', kind: 'short_text', condition: { fieldId: 'a', operator: 'is_answered' } });
    expect(() => visibleFields([a, b], {})).not.toThrow();
  });
  it('pages without a shown field disappear, and "Next" checks only its own page', () => {
    const p1 = f({ id: 'p1', kind: 'yes_no', required: true, page: 1, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] });
    const p2 = f({ id: 'p2', kind: 'short_text', required: true, page: 2, condition: { fieldId: 'p1', operator: 'equals', value: 'yes' } });
    const p3 = f({ id: 'p3', kind: 'short_text', required: true, page: 3 });
    expect(visiblePages([p1, p2, p3], { p1: 'no' }).map((p) => p.page)).toEqual([1, 3]);
    expect(validatePage([p1, p2, p3], {}, 1)).toEqual({ p1: 'This answer is required.' });
    expect(validatePage([p1, p2, p3], { p1: 'yes' }, 1)).toEqual({});
    expect(Object.keys(validatePage([p1, p2, p3], { p1: 'yes' }, 2))).toEqual(['p2']);
  });
});

describe('building the form', () => {
  it('new fields have sensible defaults; Yes/No has no stored default answer; files are PDF with a size cap', () => {
    expect(newField('single_choice').options).toHaveLength(2);
    expect(newField('yes_no').options.map((o) => o.id)).toEqual(['yes', 'no']);
    expect(newField('file').validations.maxFileMb).toBe(10);
    expect(newField('short_text').options).toEqual([]);
  });

  it('renaming an option never changes its id', () => {
    const q = newField('single_choice');
    const id = q.options[0].id;
    const renamed = renameOption(q, id, 'Seed stage');
    expect(renamed.options[0]).toEqual({ id, label: 'Seed stage' });
    expect(renamed.options[1].id).toBe(q.options[1].id);
    expect(removeOption(renamed, id).options.map((o) => o.id)).toEqual([q.options[1].id]);
    expect(newOptionId()).not.toBe(newOptionId());
  });

  it('changing the type drops what no longer applies', () => {
    const q = { ...newField('single_choice'), platformMapping: 'stage' as const };
    const asNumber = changeKind(q, 'number');
    expect(asNumber.options).toEqual([]);
    expect(asNumber.platformMapping).toBeNull();
    expect(changeKind({ ...newField('short_text'), platformMapping: 'website' as const }, 'long_text').platformMapping).toBe('website');
  });

  it('appends at the end and keeps positions tidy', () => {
    let fields: FormField[] = [];
    for (const k of ['short_text', 'number', 'file'] as const) fields = appendField(fields, k).fields;
    expect(fields.map((x) => [x.page, x.position])).toEqual([[1, 0], [1, 1], [1, 2]]);
  });

  it('reorders by drag, onto the page of its neighbour', () => {
    const a = f({ id: 'aaaaaaaa', kind: 'short_text', page: 1, position: 0 });
    const b = f({ id: 'bbbbbbbb', kind: 'short_text', page: 1, position: 1 });
    const c = f({ id: 'cccccccc', kind: 'short_text', page: 2, position: 0 });
    const moved = moveField([a, b, c], 'aaaaaaaa', 2).fields;
    expect(moved.map((x) => x.id)).toEqual(['bbbbbbbb', 'cccccccc', 'aaaaaaaa']);
    expect(moved.find((x) => x.id === 'aaaaaaaa')!.page).toBe(2);
  });

  it('refuses a move that would put a question before the one it depends on', () => {
    const ctl = f({ id: 'controll', kind: 'yes_no', page: 1, position: 0, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] });
    const dep = f({ id: 'dependen', kind: 'short_text', page: 1, position: 1, condition: { fieldId: 'controll', operator: 'equals', value: 'yes' } });
    const res = moveField([ctl, dep], 'dependen', 0);
    expect(res.refused).toContain('must stay before');
    expect(res.fields.map((x) => x.id)).toEqual(['controll', 'dependen']);
    expect(conditionOrderProblems([dep, ctl].map((x, i) => ({ ...x, position: i })))).toEqual([dep.label]);
  });

  it('deleting a controlling question frees the ones that hung off it', () => {
    const ctl = f({ id: 'controll', kind: 'yes_no', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] });
    const dep = f({ id: 'dependen', kind: 'short_text', position: 1, condition: { fieldId: 'controll', operator: 'is_answered' } });
    const left = deleteField([ctl, dep], 'controll');
    expect(left).toHaveLength(1);
    expect(left[0].condition).toBeNull();
  });

  it('splits and merges pages by hand', () => {
    const fs = ['a', 'b', 'c', 'd'].map((id, i) => f({ id: `${id}${id}${id}${id}${id}${id}${id}${id}`, kind: 'short_text', page: 1, position: i }));
    const split = splitPageAt(fs, fs[2].id);
    expect(split.map((x) => x.page)).toEqual([1, 1, 2, 2]);
    const merged = mergePageWithPrevious(split, 2);
    expect(merged.map((x) => x.page)).toEqual([1, 1, 1, 1]);
    expect(splitPageAt(fs, fs[0].id).map((x) => x.page)).toEqual([1, 1, 1, 1]); // nothing to split before the first
  });

  it('reflow numbers pages 1..k without gaps', () => {
    const fs = [f({ id: 'a', kind: 'short_text', page: 3, position: 9 }), f({ id: 'b', kind: 'short_text', page: 7, position: 1 })];
    expect(reflow(fs).map((x) => [x.page, x.position])).toEqual([[1, 0], [2, 0]]);
  });
});

describe('Suggest pages: by subject, about five per page, deterministic', () => {
  const mk = (labels: Array<[string, Partial<FormField>?]>): FormField[] => labels.map(([label, extra], i) =>
    f({ id: `field-${String(i).padStart(3, '0')}`, kind: 'short_text', label, page: 1, position: i, ...(extra ?? {}) }));

  it('classifies by subject', () => {
    expect(topicOf(f({ id: 'a', kind: 'file' }))).toBe('documents');
    expect(topicOf(f({ id: 'a', kind: 'short_text', platformMapping: 'person_name' }))).toBe('team');
    expect(topicOf(f({ id: 'a', kind: 'short_text', platformMapping: 'website' }))).toBe('company');
    expect(topicOf(f({ id: 'a', kind: 'short_text', label: 'How much revenue last year?' }))).toBe('finance');
    expect(topicOf(f({ id: 'a', kind: 'short_text', label: 'Who are your main competitors?' }))).toBe('market');
    expect(topicOf(f({ id: 'a', kind: 'short_text', label: 'Anything else?' }))).toBe('general');
  });

  it('never exceeds about five per page, never reorders, and is stable', () => {
    const fields = mk(Array.from({ length: 12 }, (_, i) => [`Something ${i}`] as [string]));
    const once = suggestPages(fields);
    expect(once.map((x) => x.id)).toEqual(fields.map((x) => x.id));
    const sizes = [...Map.groupBy(once, (x) => x.page).values()].map((p) => p.length);
    expect(sizes.every((n) => n <= 5)).toBe(true);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(12);
    expect(suggestPages(once)).toEqual(once);
    expect(suggestPages(fields)).toEqual(once);
  });

  it('breaks where the subject changes and keeps documents together at their own page', () => {
    const fields = mk([
      ['Startup name', { platformMapping: 'company_name' }], ['Website', { platformMapping: 'website' }],
      ['Founder name', { platformMapping: 'person_name' }], ['Role', { platformMapping: 'person_role' }],
      ['Pitch deck', { kind: 'file' }], ['Financial statements', { kind: 'file' }],
    ]);
    const pages = suggestPages(fields).map((x) => x.page);
    expect(pages).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('does not leave a single field alone on a page when it can be avoided', () => {
    const fields = mk(Array.from({ length: 6 }, (_, i) => [`Generic ${i}`] as [string]));
    expect(suggestPages(fields).map((x) => x.page)).toEqual([1, 1, 1, 1, 1, 1]);
  });
});

describe('what the server accepts', () => {
  const ok = (fields: unknown[]) => { const r = parseFieldsPayload(fields); expect(r.ok, JSON.stringify(r)).toBe(true); return (r as { fields: FormField[] }).fields; };
  const bad = (fields: unknown) => { const r = parseFieldsPayload(fields); expect(r.ok).toBe(false); return (r as { error: string }).error; };

  it('keeps stable ids and option ids, and fills the blanks', () => {
    const [q] = ok([{ id: 'abcdefgh-1', kind: 'single_choice', label: '  Stage?  ', options: [{ id: 'keep-me-1', label: 'Seed' }, { label: 'A' }] }]);
    expect(q.id).toBe('abcdefgh-1');
    expect(q.label).toBe('Stage?');
    expect(q.options[0].id).toBe('keep-me-1');
    expect(q.options[1].id).toMatch(/^opt_/);
  });
  it('rejects unknown types and non-lists, caps the size', () => {
    expect(bad([{ kind: 'photo', label: 'x' }])).toContain('Unknown field type');
    expect(bad('nope')).toContain('list');
    expect(bad(Array.from({ length: 201 }, () => ({ kind: 'short_text', label: 'x' })))).toContain('at most 200');
  });
  it('blank labels get a placeholder instead of failing an autosave', () => {
    expect(ok([{ kind: 'short_text', label: '   ' }])[0].label).toBe('Untitled question');
    expect(ok([{ kind: 'file', label: '' }])[0].label).toBe('Untitled document');
  });
  it('clamps validations to what each type supports', () => {
    const [t, n, file, big] = ok([
      { kind: 'long_text', label: 'a', validations: { maxLength: 999999, maxWords: 50, maxFileMb: 3, currency: true } },
      { kind: 'number', label: 'b', validations: { currency: true, maxLength: 5 } },
      { kind: 'file', label: 'c', validations: { maxFileMb: 9999 }, expectedType: 'Financials', maxAgeMonths: 12 },
      { kind: 'short_text', label: 'd', expectedType: 'x', maxAgeMonths: 3 },
    ]);
    expect(t.validations).toEqual({ maxLength: 20000, maxWords: 50 });
    expect(n.validations).toEqual({ currency: true });
    expect(file.validations).toEqual({ maxFileMb: 50 });
    expect([file.expectedType, file.maxAgeMonths]).toEqual(['Financials', 12]);
    expect([big.expectedType, big.maxAgeMonths]).toEqual([null, null]);
  });
  it('platform links only on text-like fields, from the list', () => {
    expect(ok([{ kind: 'short_text', label: 'a', platformMapping: 'company_name' }])[0].platformMapping).toBe('company_name');
    expect(bad([{ kind: 'number', label: 'a', platformMapping: 'company_name' }])).toContain('text and single-choice');
    expect(bad([{ kind: 'short_text', label: 'a', platformMapping: 'salary' }])).toContain('Unknown platform data');
  });
  it('a condition must point at an earlier question, with a value that is one of its options', () => {
    const yn = { id: 'ctrl-0001', kind: 'yes_no', label: 'Incorporated?', page: 1, position: 0 };
    const dep = { id: 'dep-00001', kind: 'date', label: 'When?', page: 1, position: 1, condition: { fieldId: 'ctrl-0001', operator: 'equals', value: 'yes' } };
    expect(ok([yn, dep])[1].condition).toEqual({ fieldId: 'ctrl-0001', operator: 'equals', value: 'yes' });
    expect(bad([{ ...dep, position: 0 }, { ...yn, position: 1 }])).toContain('placed before');
    expect(bad([yn, { ...dep, condition: { fieldId: 'nope-0000', operator: 'equals', value: 'yes' } }])).toContain('placed before');
    expect(bad([yn, { ...dep, condition: { fieldId: 'ctrl-0001', operator: 'equals', value: 'maybe' } }])).toContain('not one of');
    // while it is being built the value may be missing: autosave must not fail on a half-made condition
    expect(ok([yn, { ...dep, condition: { fieldId: 'ctrl-0001', operator: 'equals' } }])[1].condition).toEqual({ fieldId: 'ctrl-0001', operator: 'equals', value: null });
    expect(bad([yn, { ...dep, condition: { fieldId: 'ctrl-0001', operator: 'sometimes', value: 'yes' } }])).toContain('Invalid display condition');
  });
  it('Yes/No always has exactly its two fixed options', () => {
    expect(ok([{ kind: 'yes_no', label: 'a', options: [{ id: 'x', label: 'Maybe' }] }])[0].options.map((o) => o.id)).toEqual(['yes', 'no']);
  });
});

describe('the life of a call', () => {
  const NOW = new Date('2026-10-09T12:00:00.000Z');
  const call = (over: Partial<Call> = {}): Call => ({
    id: 'c1', promoterKind: 'catalog_entity', promoterId: 'e1', name: 'Seed Call', description: null,
    opensAt: '2026-11-01T09:00:00.000Z', closesAt: '2026-12-01T17:00:00.000Z', timezone: 'Europe/Lisbon', visibility: 'listed',
    limitUnit: 'project', allowMultiple: false, contentLanguage: 'en', currency: 'EUR', status: 'draft', linkToken: null,
    configVersion: 1, validatedAt: null, publishedAt: null, closedAt: null, duplicatedFrom: null, createdBy: 'u1',
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...over,
  });
  const phases: CallPhase[] = [{ id: 'p1', position: 0, name: 'Review', startsOn: null, endsOn: null }];
  const form = [f({ id: 'q1', kind: 'short_text', label: 'Company name' })];

  it('says what is missing, tab by tab', () => {
    expect(readiness(call(), phases, form, NOW)).toEqual([]);
    expect(readiness(call({ name: ' ', opensAt: null }), [], [], NOW).map((i) => i.tab)).toEqual(['general', 'general', 'phases', 'form']);
    expect(readiness(call({ closesAt: '2026-10-01T00:00:00.000Z', opensAt: '2026-09-01T00:00:00.000Z' }), phases, form, NOW)[0].message).toContain('in the past');
    expect(readiness(call({ opensAt: '2026-12-02T00:00:00.000Z' }), phases, form, NOW)[0].message).toContain('close after it opens');
  });
  it('flags unfinished questions and choices', () => {
    const issues = readiness(call(), phases, [
      f({ id: 'a', kind: 'short_text', label: 'Untitled question' }),
      f({ id: 'b', kind: 'single_choice', label: 'Stage', options: [{ id: '1', label: 'Seed' }] }),
      f({ id: 'c', kind: 'single_choice', label: 'Sector', options: [{ id: '1', label: 'A' }, { id: '2', label: 'a' }] }),
    ], NOW).map((i) => i.message);
    expect(issues).toContain('A question still has no text.');
    expect(issues).toContain('“Stage” needs at least two options.');
    expect(issues).toContain('“Sector” has two options with the same text.');
  });
  it('a display condition without a value blocks the confirmation, with the reason', () => {
    const issues = readiness(call(), phases, [
      f({ id: 'a', kind: 'yes_no', label: 'Incorporated?' }),
      f({ id: 'b', kind: 'date', label: 'When?', position: 1, condition: { fieldId: 'a', operator: 'equals', value: null } }),
    ], NOW).map((i) => i.message);
    expect(issues).toContain('“When?” has a display condition without a value.');
  });
  it('summarises what is configured', () => {
    const s = summarise(phases, [form[0], f({ id: 'd', kind: 'file', page: 2, required: true }), f({ id: 'm', kind: 'short_text', platformMapping: 'website', condition: { fieldId: 'q1', operator: 'is_answered' } })]);
    expect(s).toEqual({ phases: 1, pages: 2, fields: 3, questions: 2, documents: 1, required: 1, mapped: 1, conditional: 1 });
  });

  it('confirm: only a ready draft; and "Edit configuration" invalidates the confirmation', () => {
    expect(confirmCall(call(), [{ tab: 'general', message: 'Give the call a name.' }], 'u1', NOW)).toMatchObject({ ok: false });
    expect(confirmCall(call({ status: 'validated' }), [], 'u1', NOW)).toMatchObject({ ok: false });
    const confirmed = confirmCall(call(), [], 'u1', NOW);
    expect(confirmed).toMatchObject({ ok: true, event: 'call_confirmed', patch: { status: 'validated', validated_by: 'u1' } });
    expect(editConfiguration(call({ status: 'validated' }))).toMatchObject({ ok: true, patch: { status: 'draft', validated_at: null } });
    expect(editConfiguration(call({ status: 'scheduled' }))).toMatchObject({ ok: true, patch: { status: 'draft' } });
    expect(editConfiguration(call({ status: 'open' }))).toMatchObject({ ok: false });
    expect(editConfiguration(call({ status: 'draft' }))).toMatchObject({ ok: false });
  });

  it('publish: needs a confirmation; a future opening is Scheduled with a link, a past one is Open', () => {
    expect(publishCall(call(), 'tok', NOW)).toMatchObject({ ok: false });
    expect(publishCall(call({ status: 'validated' }), 'tok', NOW)).toMatchObject({ ok: true, patch: { status: 'scheduled', link_token: 'tok' } });
    expect(publishCall(call({ status: 'validated', opensAt: '2026-10-01T00:00:00.000Z' }), 'tok', NOW)).toMatchObject({ ok: true, patch: { status: 'open' } });
    expect(publishCall(call({ status: 'validated', closesAt: '2026-10-05T00:00:00.000Z', opensAt: '2026-10-01T00:00:00.000Z' }), 'tok', NOW)).toMatchObject({ ok: false });
    // an existing link is never replaced
    expect(publishCall(call({ status: 'validated', linkToken: 'old' }), 'new', NOW)).toMatchObject({ patch: { link_token: 'old' } });
    expect(publishCall(call({ status: 'scheduled' }), 'tok', NOW)).toMatchObject({ ok: false });
  });

  it('a scheduled call opens by itself at its time, and closes at its deadline; a draft never does', () => {
    const sched = call({ status: 'scheduled' });
    expect(effectiveStatus(sched, NOW)).toBe('scheduled');
    expect(effectiveStatus(sched, new Date('2026-11-01T09:00:00.000Z'))).toBe('open');
    expect(effectiveStatus(sched, new Date('2026-12-01T17:00:00.000Z'))).toBe('closed');
    expect(effectiveStatus(call({ status: 'open' }), new Date('2026-12-02T00:00:00.000Z'))).toBe('closed');
    expect(effectiveStatus(call({ status: 'draft' }), new Date('2027-01-01T00:00:00.000Z'))).toBe('draft');
    expect(effectiveStatus(call({ status: 'validated' }), new Date('2027-01-01T00:00:00.000Z'))).toBe('validated'); // opens only if confirmed AND published
  });

  it('after opening: extend for everybody (later only) and close early; nothing else', () => {
    const open = call({ status: 'open', opensAt: '2026-10-01T00:00:00.000Z' });
    expect(extendDeadline(open, '2026-12-15T17:00:00.000Z', NOW)).toMatchObject({ ok: true, patch: { closes_at: '2026-12-15T17:00:00.000Z' } });
    expect(extendDeadline(open, '2026-11-15T17:00:00.000Z', NOW)).toMatchObject({ ok: false });
    expect(extendDeadline(open, 'garbage', NOW)).toMatchObject({ ok: false });
    expect(extendDeadline(call({ status: 'draft' }), '2027-01-01T00:00:00.000Z', NOW)).toMatchObject({ ok: false });
    expect(closeEarly(open, NOW)).toMatchObject({ ok: true, patch: { status: 'closed' } });
    expect(closeEarly(call({ status: 'scheduled' }), NOW)).toMatchObject({ ok: false });
  });

  it('which buttons each state shows', () => {
    expect(availableActions(call(), [], NOW)).toMatchObject({ canEditForm: true, canConfirm: true, canPublish: false });
    expect(availableActions(call(), [{ tab: 'general', message: 'x' }], NOW).canConfirm).toBe(false);
    expect(availableActions(call({ status: 'validated' }), [], NOW)).toMatchObject({ canEditForm: false, canEditConfiguration: true, canPublish: true });
    expect(availableActions(call({ status: 'scheduled' }), [], NOW)).toMatchObject({ canEditConfiguration: true, canExtend: true, canClose: false });
    expect(availableActions(call({ status: 'open', opensAt: '2026-10-01T00:00:00.000Z' }), [], NOW)).toMatchObject({ canEditForm: false, canEditConfiguration: false, canExtend: true, canClose: true });
  });

  it('the placeholder behind the link', () => {
    expect(linkPlaceholderText(call({ status: 'scheduled' }), '01 Nov 2026', NOW)).toBe('Applications open on 01 Nov 2026.');
    expect(linkPlaceholderText(call({ status: 'open', opensAt: '2026-10-01T00:00:00.000Z' }), 'x', NOW)).toBe('Applications are open.');
    expect(linkPlaceholderText(call({ status: 'closed' }), 'x', NOW)).toBe('This call is closed.');
  });
});
