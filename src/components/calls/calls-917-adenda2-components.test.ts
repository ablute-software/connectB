// Prompt 917, Adenda 2 (B) — what the screens draw for a Table (static markup; the clicks are driven in a real browser by table-input.browser.test.ts and form-panel-selection.browser.test.ts):
// the entity's editor, the preview, "Convert to Table" on a group the import made the wrong way round, the read-only copy and the summary line of the Submissions tab.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newField } from '@/lib/calls/form-builder';
import { newSubField } from '@/lib/calls/field-config';
import { tableSummary } from '@/lib/calls/table';
import type { FormField, GroupConfig, TableConfig } from '@/lib/calls/types';
import { GroupEditor, type ConvertAction } from './GroupEditor';
import { TableEditor } from './TableEditor';
import { TableInput } from './TableInput';

const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const config = (over: Partial<TableConfig> = {}): TableConfig => ({
  cornerTitle: 'Relevant Criteria',
  rows: [{ id: 'r_prod', label: 'Products & Services' }, { id: 'r_share', label: 'Market Share (%)' }],
  columns: [{ id: 'c_you', label: 'Your solution/company' }, { id: 'c_1', label: 'Competitor #1' }],
  cellKind: 'short_text', rowKinds: { r_share: 'percent' },
  addColumns: { allowed: true, max: 4, defaultName: 'Competitor #' }, addRows: { allowed: false, max: 2, defaultName: 'Row #' }, required: 'none', ...over,
});
const tableField = (cfg = config()): FormField => ({ ...newField('table', 1, 0), id: 'tbl-1', label: 'Competitive analysis', validations: { table: cfg } });

describe('the entity\'s editor', () => {
  it('has every setting the Adenda lists: corner title, row and column headers, cell type (and one per row), what applicants add, what is required, and a preview', () => {
    const h = render(createElement(TableEditor, { value: config(), onChange: () => {} }));
    for (const id of ['table-config', 'rows-text', 'columns-text', 'cell-kind', 'row-kinds', 'allow-columns', 'allow-rows', 'table-required', 'table-preview']) expect(h, id).toContain(`data-testid="${id}"`);
    expect(h).toContain('Corner title (optional)');
    expect(h).toContain('Applicants can add columns');
    expect(h).toContain('Applicants can add rows');
    expect(h).toContain('An applicant can rename and remove only what they added — never your own headers.');
    for (const k of ['none', 'all', 'first_column']) expect(h).toContain(`data-testid="required-${k}"`);
  });
  it('with no row headers the rows are numbered, and it says so', () => {
    const h = render(createElement(TableEditor, { value: config({ rows: [{ id: 'r_1', label: '' }, { id: 'r_2', label: '' }] }), onChange: () => {} }));
    expect(h).toContain('data-testid="row-count"');
    expect(h).toContain('No row headers: the rows are just numbered 1, 2, 3…');
  });
  it('nothing can be changed when the form is locked', () => {
    const h = render(createElement(TableEditor, { value: config(), disabled: true, onChange: () => {} }));
    expect(h).toMatch(/data-testid="rows-text"[^>]*disabled|disabled=""[^>]*data-testid="rows-text"/);
  });
});

describe('the applicant\'s table', () => {
  it('the entity\'s headers are text — no ✕, no field to edit — and the buttons to add appear because the entity allows columns (and not rows)', () => {
    const h = render(createElement(TableInput, { field: tableField(), value: null, currency: 'EUR', variant: 'table', onChange: () => {} }));
    expect(h).toContain('data-testid="add-column"');
    expect(h).not.toContain('data-testid="add-row"');
    expect(h).not.toContain('data-testid="remove-column"');
    expect(h).toContain('3 of 4 columns'.replace('3', '2'));
    expect(h).toContain('data-testid="expand-table"');
    expect(h).toContain('Relevant Criteria');
  });
  it('a cell has the type of its row: a percentage for "Market Share (%)", text for the others', () => {
    const h = render(createElement(TableInput, { field: tableField(), value: null, currency: 'EUR', variant: 'table', onChange: () => {} }));
    expect(h).toContain('aria-label="Market Share (%) — Your solution/company"');
    expect(h).toContain('placeholder="0 – 100"');
  });
  it('the forced phone layout is cards, one per column, with the criteria as fields', () => {
    const h = render(createElement(TableInput, { field: tableField(), value: null, currency: 'EUR', variant: 'cards', onChange: () => {} }));
    expect((h.match(/data-testid="table-card"/g) ?? []).length).toBe(2);
    expect(h).not.toContain('data-testid="expand-table"');
  });
  it('a copy that cannot be changed has no buttons, and says which headers the applicant added', () => {
    const value = { columns: [{ id: 'x_mine00001', name: 'Competitor #3', addedBy: 'applicant' as const }], rows: [], cells: { r_prod: { c_you: 'ours' } } };
    const h = render(createElement(TableInput, { field: tableField(), value, currency: 'EUR', disabled: true, variant: 'table', onChange: () => {} }));
    expect(h).not.toContain('data-testid="add-column"');
    expect(h).not.toContain('data-testid="remove-column"');
    expect(h).toContain('added by applicant');
    expect(h).toContain('value="ours"');
  });
  it('the Submissions tab\'s one-line reading counts what was filled in', () => {
    const f = tableField();
    expect(tableSummary(f, { columns: [{ id: 'x_mine00001', name: 'Competitor #3', addedBy: 'applicant' }], rows: [], cells: { r_prod: { c_you: 'a', c_1: 'b' } } })).toBe('2 rows × 3 columns · 2 cells filled');
  });
});

describe('Convert to Table on a group', () => {
  const group = (over: Partial<GroupConfig> = {}): GroupConfig => ({
    entryLabel: 'Company', min: 3, max: 3, display: 'table', presetRows: [['Your company'], ['Competitor 1'], ['Competitor 2']],
    subFields: [{ ...newSubField('short_text'), label: 'Company' }, { ...newSubField('long_text'), label: 'Products & Services' }], ...over,
  });
  const action = (value: GroupConfig, allowed = true): ConvertAction => ({ field: { kind: 'group', required: false, validations: { group: value } }, allowed, run: async () => ({ ok: true, message: 'done' }) });
  const draw = (value: GroupConfig, allowed = true) => render(createElement(GroupEditor, { value, onChange: () => {}, convert: action(value, allowed) }));

  it('is offered on a group in table mode with rows the entity set — enabled, and saying what will happen', () => {
    const h = draw(group());
    expect(h).toContain('data-testid="convert-to-table"');
    expect(h).toContain('This is a comparison table');
    expect(h).toContain('3 fixed rows became columns, 1 question became criteria (rows)');
    expect(h).not.toMatch(/disabled=""[^>]*data-testid="convert-button"|data-testid="convert-button"[^>]*disabled=""/);
    expect(h).not.toContain('data-testid="convert-confirm"');                                   // the question comes after the click, in the page
  });
  it('is not offered on an ordinary group, and is off (with the reason) when the shape cannot be converted or the person may not', () => {
    expect(draw(group({ display: 'cards', presetRows: [] }))).not.toContain('data-testid="convert-to-table"');
    const odd = draw(group({ subFields: [{ ...newSubField('short_text'), label: 'Company' }, { ...newSubField('file'), label: 'Evidence' }] }));
    expect(odd).toContain('data-testid="convert-reason"');
    expect(odd).toMatch(/data-testid="convert-button"/);
    expect(draw(group(), false)).toMatch(/disabled=""[^>]*data-testid="convert-button"|data-testid="convert-button"[^>]*disabled=""/);
  });
  it('asks IN the page (never with the browser\'s dialog)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(`${process.cwd()}/src/components/calls/GroupEditor.tsx`, 'utf8') + fs.readFileSync(`${process.cwd()}/src/components/calls/TableInput.tsx`, 'utf8');
    expect(src).not.toMatch(/window\.confirm/);
    expect(src).toContain('data-testid="convert-confirm"');
    expect(src).toContain('data-testid="remove-confirm"');
  });
});
