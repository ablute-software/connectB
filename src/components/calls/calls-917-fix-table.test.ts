// Prompt 917 fix (16/10/2026): a table with fixed rows shows them at once (applicant, preview and test share GroupInput; the entity reads them in Submissions), and an optional
// group says it is optional instead of "Add at least 3…".
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { newField } from '@/lib/calls/form-builder';
import type { FormField, GroupConfig, SubField } from '@/lib/calls/types';

vi.mock('@/lib/supabase', () => ({ browserClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }), authEnabled: false }));

import { GroupInput } from './GroupInput';
import { AnswerView } from './SubmissionsTab';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sub = (n: number, kind: SubField['kind'], over: Partial<SubField> = {}): SubField => ({ id: U(n), kind, label: `Q${n}`, required: false, options: [], validations: {}, ...over });
const render = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('a table with fixed rows, drawn', () => {
  const cfg: GroupConfig = {
    entryLabel: 'Company', min: 3, max: 3, display: 'table', presetRows: [['Your company'], ['Competitor 1'], ['Competitor 2']],
    subFields: [sub(1, 'short_text', { label: 'Company' }), sub(2, 'short_text', { label: 'Strengths' })],
  };
  const table = (over: Partial<FormField> = {}): FormField => ({ ...newField('group', 1, 0), id: 'group-table-1', label: 'Competitive analysis', validations: { group: cfg }, ...over });

  it('the three rows are there with nothing typed: the first column is the entity\'s text, the others are inputs; no "add" button, no "Add at least"', () => {
    const html = render(createElement(GroupInput, { field: table(), value: undefined, currency: 'EUR', onChange: () => {} }));
    expect((html.match(/data-testid="group-entry"/g) ?? []).length).toBe(3);
    for (const t of ['Your company', 'Competitor 1', 'Competitor 2']) expect(html).toContain(t);
    expect((html.match(/data-testid="preset-cell"/g) ?? []).length).toBe(3);
    expect((html.match(/<input/g) ?? []).length).toBe(3);                                   // one editable cell per row
    expect(html).not.toContain('Add at least');
    expect(html).not.toContain('data-testid="add-entry"');
    expect(html).not.toContain('group-empty');
  });

  it('an optional group with no rows says only that it is optional; the minimum appears once it is required or started', () => {
    const team = {
      ...newField('group', 1, 0), id: 'group-team-1',
      validations: { group: { entryLabel: 'Team member', min: 2, max: 4, display: 'cards', presetRows: [], subFields: [sub(1, 'short_text', { label: 'Name' })] } as GroupConfig },
    } as FormField;
    const optional = render(createElement(GroupInput, { field: team, value: undefined, currency: 'EUR', onChange: () => {} }));
    expect(optional).toContain('Optional — add a team member only if it applies.');
    expect(optional).toContain('0 of 4 · optional');
    expect(optional).not.toMatch(/at least/i);
    const started = render(createElement(GroupInput, { field: team, value: [{ id: 'e1', values: { [U(1)]: 'Ana' } }], currency: 'EUR', onChange: () => {} }));
    expect(started).toContain('1 of 4 · at least 2');
    expect(render(createElement(GroupInput, { field: { ...team, required: true }, value: undefined, currency: 'EUR', onChange: () => {} }))).toContain('Add at least 2 team member entries.');
  });

  it('the entity reads the fixed rows in the Submissions with their first column, even for an answer stored before they were kept', () => {
    const html = render(createElement(AnswerView, { field: table(), value: [{ id: 'row2', values: { [U(2)]: 'cheap' } }] as never, docs: [], currency: 'EUR' }));
    for (const t of ['Your company', 'Competitor 1', 'Competitor 2', 'cheap']) expect(html).toContain(t);
    expect(render(createElement(AnswerView, { field: table(), value: undefined, docs: [], currency: 'EUR' }))).toBe('—');
  });
});
