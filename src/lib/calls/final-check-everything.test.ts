// The final check lists EVERYTHING at once (Nuno, 16/10/2026): "2 things are missing", one corrected, and a new one appeared that had not been in the first list. A group used to count
// as ONE item (its first problem only), so correcting it revealed the next. Now: every page, every group, every entry, one item per problem. The only acceptable "new" item is a
// conditional question that an answer given since made appear — and it says so.
import { describe, expect, it } from 'vitest';
import { finalCheck, testStep, visibleIds } from './preview-logic';
import { planSubmission } from './applicant/submit';
import { newField } from './form-builder';
import type { FormField, GroupConfig, SubField } from './types';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sub = (n: number, kind: SubField['kind'], over: Partial<SubField> = {}): SubField => ({ id: U(n), kind, label: `Q${n}`, required: false, options: [], validations: {}, ...over });
const f = (id: string, kind: FormField['kind'], label: string, page: number, position: number, over: Partial<FormField> = {}): FormField => ({ ...newField(kind, page, position), id, label, ...over });

const team: GroupConfig = { entryLabel: 'Team member', min: 1, max: 5, display: 'cards', presetRows: [], subFields: [sub(1, 'short_text', { label: 'Name', required: true }), sub(2, 'email', { label: 'Email', required: true })] };
const table: GroupConfig = { entryLabel: 'Row', min: 3, max: 3, display: 'table', presetRows: [['Us'], ['A'], ['B']], subFields: [sub(3, 'short_text', { label: 'Company' }), sub(4, 'short_text', { label: 'Strengths', required: true })] };

// errors on THREE different pages and in two groups
const form: FormField[] = [
  f('name-field-0001', 'short_text', 'Startup name', 1, 0, { required: true }),
  f('mail-field-0001', 'email', 'Contact email', 1, 1),
  f('amount-field-001', 'number', 'Amount', 2, 0, { required: true }),
  f('team-field-0001', 'group', 'Team', 2, 1, { required: true, validations: { group: team } }),
  f('video-field-0001', 'url', 'Pitch video', 3, 0, { required: true }),
  f('table-field-0001', 'group', 'Competitors', 3, 1, { validations: { group: table } }),
];
const answers = {
  'mail-field-0001': 'ana@',                                                                  // page 1: invalid
  'team-field-0001': [{ id: 'e1', values: { [U(1)]: 'Ana' } }, { id: 'e2', values: {} }],        // page 2: entry 1 lacks the email, entry 2 lacks both
  'video-field-0001': 'www.youtube.com',                                                       // page 3: invalid
  'table-field-0001': [{ id: 'row1', values: { [U(4)]: 'cheap' } }],                            // page 3: started, rows 2 and 3 lack "Strengths"
};

describe('the first check lists everything', () => {
  const issues = finalCheck(form, answers as never);
  it('every problem of every page and of every group, in the order of the form, in one list', () => {
    expect(issues.map((i) => [i.pageNumber, i.label, i.message])).toEqual([
      [1, 'Startup name', 'This answer is required.'],
      [1, 'Contact email', 'Enter a valid email address.'],
      [2, 'Amount', 'This answer is required.'],
      [2, 'Team', 'Team member 1 — Email: This answer is required.'],
      [2, 'Team', 'Team member 2 — Name: This answer is required.'],
      [2, 'Team', 'Team member 2 — Email: This answer is required.'],
      [3, 'Pitch video', 'Enter a link that starts with http:// or https://.'],
      [3, 'Competitors', 'Row 2 — Strengths: This answer is required.'],
      [3, 'Competitors', 'Row 3 — Strengths: This answer is required.'],
    ]);
  });
  it('each problem has its own key (the list can be drawn), and nothing is marked new on a first check', () => {
    expect(new Set(issues.map((i) => i.key)).size).toBe(issues.length);
    expect(issues.some((i) => i.newBecause)).toBe(false);
  });
  it('the server\'s plan lists exactly the same things (it runs the same check)', () => {
    const r = planSubmission(form, answers as never, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.map((x) => x.message)).toEqual(issues.map((x) => x.message));
  });
  it('correcting ONE thing removes exactly that one: no other item appears', () => {
    const fixed = finalCheck(form, { ...answers, 'name-field-0001': 'Acme' } as never, visibleIds(form, answers as never));
    expect(fixed).toHaveLength(issues.length - 1);
    expect(fixed.map((i) => i.key)).toEqual(issues.slice(1).map((i) => i.key));
    // and correcting a whole group's first entry removes only that entry's problem
    const teamFixed = finalCheck(form, { ...answers, 'team-field-0001': [{ id: 'e1', values: { [U(1)]: 'Ana', [U(2)]: 'ana@x.pt' } }, { id: 'e2', values: {} }] } as never);
    expect(teamFixed.filter((i) => i.label === 'Team').map((i) => i.message)).toEqual(['Team member 2 — Name: This answer is required.', 'Team member 2 — Email: This answer is required.']);
  });
  it('a required group with no entry at all says so once; an optional one nobody started says nothing', () => {
    const r = finalCheck(form, {} as never);
    expect(r.filter((i) => i.label === 'Team').map((i) => i.message)).toEqual(['Add at least one team member.']);
    expect(r.some((i) => i.label === 'Competitors')).toBe(false);
  });
  it('test mode\'s final step lists the same thing', () => {
    // on the last page, with that page in order, the final step lists what is still wrong on the EARLIER pages — all of it, groups included
    const step = testStep(form, { ...answers, 'video-field-0001': 'https://youtu.be/abc', 'table-field-0001': undefined } as never, 2);
    expect(step.kind).toBe('final');
    if (step.kind === 'final') expect(step.issues.map((i) => i.message)).toEqual(issues.filter((i) => i.pageNumber < 3).map((i) => i.message));
  });
});

describe('the one acceptable exception: a question an answer made appear', () => {
  const cond: FormField[] = [
    f('incubated-field1', 'yes_no', 'Is the startup incubated?', 1, 0, { required: true }),
    f('which-field-0001', 'short_text', 'Which incubator?', 2, 0, { required: true, condition: { fieldId: 'incubated-field1', operator: 'equals', value: 'yes' } }),
    f('name-field-0001', 'short_text', 'Startup name', 3, 0, { required: true }),
  ];
  it('first check: the hidden question is not listed; after answering Yes, it appears as NEW, saying which answer made it appear and where', () => {
    const first = finalCheck(cond, {} as never);
    expect(first.map((i) => i.label)).toEqual(['Is the startup incubated?', 'Startup name']);
    const shown = visibleIds(cond, {} as never);
    const second = finalCheck(cond, { 'incubated-field1': 'yes' } as never, shown);
    expect(second.map((i) => [i.label, i.newBecause ?? null])).toEqual([
      ['Which incubator?', { label: 'Is the startup incubated?', pageNumber: 1 }],
      ['Startup name', null],
    ]);
    expect(second[0].pageNumber).toBe(2);
  });
  it('answering No makes nothing new; and with no previous check nothing is ever called new', () => {
    const no = finalCheck(cond, { 'incubated-field1': 'no' } as never, visibleIds(cond, {} as never));
    expect(no.map((i) => i.label)).toEqual(['Startup name']);
    expect(finalCheck(cond, { 'incubated-field1': 'yes' } as never).some((i) => i.newBecause)).toBe(false);
  });
  it('a question that was already shown at the previous check is never called new, even if it still has a problem', () => {
    const shown = visibleIds(cond, { 'incubated-field1': 'yes' } as never);
    const again = finalCheck(cond, { 'incubated-field1': 'yes' } as never, shown);
    expect(again.some((i) => i.newBecause)).toBe(false);
    expect(again.map((i) => i.label)).toEqual(['Which incubator?', 'Startup name']);
  });
});
