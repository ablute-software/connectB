// Prompt 909 (I2) — importing the form of another call: what is copied, what gets a new id, how Replace and Add
// differ, and what is dropped (a display condition that points at a question that did not come).
import { describe, expect, it } from 'vitest';
import { importForm } from './form-import';
import type { FormField } from './types';

const f = (id: string, over: Partial<FormField> = {}): FormField => ({
  id, page: 1, position: 0, kind: 'short_text', label: `Q ${id}`, instruction: null, required: false, options: [], validations: {},
  condition: null, platformMapping: null, expectedType: null, maxAgeMonths: null, ...over,
});
const counter = () => { let n = 0; return () => `new-${++n}`; };

const source: FormField[] = [
  f('s1', { page: 1, position: 0, kind: 'yes_no', label: 'Incorporated?', required: true, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }),
  f('s2', { page: 1, position: 1, kind: 'date', label: 'Date of incorporation', required: true, condition: { fieldId: 's1', operator: 'equals', value: 'yes' } }),
  f('s3', { page: 3, position: 0, kind: 'file', label: 'Certificate', expectedType: 'Company registration certificate', maxAgeMonths: 6, validations: { maxFileMb: 8 } }),
  f('s4', { page: 3, position: 1, kind: 'short_text', label: 'Company name', platformMapping: 'company_name', validations: { maxLength: 120 } }),
];
const current: FormField[] = [f('c1', { page: 1, position: 0 }), f('c2', { page: 2, position: 0 })];

describe('Replace', () => {
  const r = importForm([], source, 'replace', counter());
  it('copies the fields with new ids, in order', () => {
    expect(r.imported).toBe(4);
    expect(r.fields.map((x) => x.id)).toEqual(['new-1', 'new-2', 'new-3', 'new-4']);
    expect(r.fields.map((x) => x.label)).toEqual(source.map((x) => x.label));
  });
  it('keeps the kind, requiredness, options, validations, platform links and the expected document', () => {
    const [yn, , cert, name] = r.fields;
    expect(yn).toMatchObject({ kind: 'yes_no', required: true, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] });
    expect(cert).toMatchObject({ kind: 'file', expectedType: 'Company registration certificate', maxAgeMonths: 6, validations: { maxFileMb: 8 } });
    expect(name).toMatchObject({ platformMapping: 'company_name', validations: { maxLength: 120 } });
  });
  it('carries the display conditions over to the NEW ids (still pointing at the earlier question)', () => {
    expect(r.fields[1].condition).toEqual({ fieldId: 'new-1', operator: 'equals', value: 'yes' });
    expect(r.warnings).toEqual([]);
  });
  it('renumbers the pages from 1 (a source with a gap) and the positions within each page', () => {
    expect(r.fields.map((x) => [x.page, x.position])).toEqual([[1, 0], [1, 1], [2, 0], [2, 1]]);
  });
  it('replaces: nothing of the current form is kept', () => {
    const replaced = importForm(current, source, 'replace', counter());
    expect(replaced.fields.map((x) => x.id)).not.toContain('c1');
    expect(replaced.fields).toHaveLength(4);
  });
  it('does not touch the source', () => {
    const snapshot = JSON.stringify(source);
    importForm(current, source, 'replace', counter());
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});

describe('Add after current form', () => {
  const r = importForm(current, source, 'add', counter());
  it('keeps the current form exactly as it was, and the imported pages come after it', () => {
    expect(r.fields.slice(0, 2)).toEqual(current);
    expect(r.fields.slice(2).map((x) => x.page)).toEqual([3, 3, 4, 4]);
    expect(r.fields.slice(2).map((x) => x.position)).toEqual([0, 1, 0, 1]);
    expect(r.imported).toBe(4);
  });
  it('conditions inside the imported part still point at imported questions', () => {
    const cond = r.fields.find((x) => x.label === 'Date of incorporation')!.condition!;
    expect(r.fields.find((x) => x.id === cond.fieldId)?.label).toBe('Incorporated?');
  });
  it('never repeats a field id', () => {
    expect(new Set(r.fields.map((x) => x.id)).size).toBe(r.fields.length);
  });
  it('adding to an empty form is the same as replacing it', () => {
    expect(importForm([], source, 'add', counter()).fields).toEqual(importForm([], source, 'replace', counter()).fields);
  });
});

describe('what cannot come along', () => {
  it('a condition on a question that is not in the source is removed, and the person is told which one', () => {
    const broken = [f('b1'), f('b2', { condition: { fieldId: 'gone', operator: 'equals', value: 'x' } })];
    const r = importForm([], broken, 'replace', counter());
    expect(r.fields[1].condition).toBeNull();
    expect(r.warnings).toEqual(['“Q b2” had a display condition on a question that was not imported, so the condition was removed.']);
  });
});
