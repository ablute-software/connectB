// Prompt 917 fixes (16/10/2026, from the test of the INNOV-ID call): (1) "no value" is not "1" — a file saved with no age limit became "1 month"; (2) the rows an entity fixed in a
// table are always there for the applicant (nothing used to create them), and an OPTIONAL group asks for nothing until the person starts filling it in.
import { describe, expect, it } from 'vitest';
import { groupStarted, parseSimpleValidations, presetEntriesFor } from './field-config';
import { groupErrors, validateAnswer } from './form-logic';
import { newField, parseFieldsPayload } from './form-builder';
import { sanitizeAnswers, withPresetRows } from './applicant/answers';
import type { FormField, GroupConfig, SubField } from './types';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sub = (n: number, kind: SubField['kind'], over: Partial<SubField> = {}): SubField => ({ id: U(n), kind, label: `Q${n}`, required: false, options: [], validations: {}, ...over });

describe('no value is not a number', () => {
  const file = (over: Record<string, unknown>) => ({ ...newField('file', 1, 0), id: 'file-field-0001', ...over });
  it('a file question saved with no age limit keeps none (null, "", undefined) — it used to become "1 month"', () => {
    for (const none of [null, undefined, '', '  ']) {
      const r = parseFieldsPayload([file({ maxAgeMonths: none })]);
      expect(r.ok && r.fields[0].maxAgeMonths, String(none)).toBeNull();
    }
  });
  it('a real limit survives, and is kept inside 1..240', () => {
    const at = (v: unknown) => { const r = parseFieldsPayload([file({ maxAgeMonths: v })]); return r.ok ? r.fields[0].maxAgeMonths : 'refused'; };
    expect(at(3)).toBe(3);
    expect(at('6')).toBe(6);
    expect(at(1000)).toBe(240);
  });
  it('the same for the other numbers a question is configured with: no maximum length, no size, no number of files is not "1"', () => {
    expect(parseSimpleValidations('short_text', { maxLength: null })).toEqual({});
    expect(parseSimpleValidations('file', { maxFileMb: null, maxFiles: null }).maxFiles).toBeUndefined();
    expect(parseSimpleValidations('file', { maxFileMb: null }).maxFileMb).toBeGreaterThan(1);
  });
});

describe('a table with rows the entity fixed', () => {
  const cfg: GroupConfig = {
    entryLabel: 'Company', min: 3, max: 3, display: 'table', presetRows: [['Your company'], ['Competitor 1'], ['Competitor 2']],
    subFields: [sub(1, 'short_text', { label: 'Company' }), sub(2, 'short_text', { label: 'Strengths', required: true })],
  };
  const table = (over: Partial<FormField> = {}): FormField => ({ ...newField('group', 1, 0), id: 'group-table-1', label: 'Competitive analysis', validations: { group: cfg }, ...over });

  it('the rows are there before anything is typed, with the first column filled in; what was typed is kept next to it', () => {
    const rows = presetEntriesFor(cfg, undefined);
    expect(rows.map((r) => [r.id, r.values[U(1)]])).toEqual([['row1', 'Your company'], ['row2', 'Competitor 1'], ['row3', 'Competitor 2']]);
    const typed = presetEntriesFor(cfg, [{ id: 'row2', values: { [U(2)]: 'cheap' } }]);
    expect(typed[0].values[U(2)]).toBeUndefined();
    expect(typed[1].values[U(2)]).toBe('cheap');
    expect(withPresetRows([table()], {})['group-table-1']).toHaveLength(3);
  });

  it('the entity\'s own text does not count as "started"; the person\'s does', () => {
    expect(groupStarted(cfg, undefined)).toBe(false);
    expect(groupStarted(cfg, presetEntriesFor(cfg, undefined))).toBe(false);
    expect(groupStarted(cfg, [{ id: 'row1', values: { [U(2)]: 'cheap' } }])).toBe(true);
    expect(groupStarted(cfg, [{ id: 'row1', values: { [U(2)]: '  ' } }])).toBe(false);
  });

  it('an OPTIONAL table asks for nothing until it is started; started, every row needs its required question; a REQUIRED one always does', () => {
    expect(validateAnswer(table(), undefined)).toBeNull();
    expect(groupErrors(table(), undefined)).toEqual({});
    const started = groupErrors(table(), [{ id: 'row1', values: { [U(2)]: 'cheap' } }]);
    expect(Object.keys(started).sort()).toEqual([`row2/${U(2)}`, `row3/${U(2)}`]);
    expect(validateAnswer(table(), [{ id: 'row1', values: { [U(2)]: 'cheap' } }])).toMatch(/Company 2 — Strengths/);
    const required = table({ required: true });
    expect(validateAnswer(required, undefined)).toMatch(/Company 1 — Strengths: This answer is required/);      // the rows exist: the answers are what is missing, never "add 3 rows"
    expect(validateAnswer(required, undefined)).not.toMatch(/Add at least/);
  });

  it('an optional repeatable group (no fixed rows) with a minimum asks for it only once started', () => {
    const team = {
      ...newField('group', 1, 0), id: 'group-team-1',
      validations: { group: { entryLabel: 'Team member', min: 2, max: 5, display: 'cards', presetRows: [], subFields: [sub(1, 'short_text', { required: true })] } as GroupConfig },
    } as FormField;
    expect(validateAnswer(team, undefined)).toBeNull();
    expect(validateAnswer(team, [{ id: 'e1', values: { [U(1)]: 'Ana' } }])).toBe('Add at least 2 entries (team member).');
    expect(validateAnswer({ ...team, required: true }, undefined)).toBe('Add at least 2 entries (team member).');
  });

  it('on the server an optional table nobody filled in is not stored (only the entity\'s own text would be); a started one keeps ALL its rows', () => {
    expect(sanitizeAnswers([table()], { 'group-table-1': presetEntriesFor(cfg, undefined) })).toEqual({});
    const kept = sanitizeAnswers([table()], { 'group-table-1': [{ id: 'row1', values: { [U(2)]: 'cheap' } }] })['group-table-1'] as { id: string; values: Record<string, unknown> }[];
    expect(kept.map((r) => r.values[U(1)])).toEqual(['Your company', 'Competitor 1', 'Competitor 2']);
    expect(kept[0].values[U(2)]).toBe('cheap');
    expect(Object.keys(sanitizeAnswers([table({ required: true })], { 'group-table-1': presetEntriesFor(cfg, undefined) }))).toEqual(['group-table-1']);
  });
});
