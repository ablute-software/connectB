// Prompt 917, Adenda 2 (B) — the Table question, in pure functions: how its configuration is read, how an answer is kept (only what the applicant may author), what is required, what each cell type
// accepts, what a new column is called, and how an old repeatable group in table mode becomes a Table. The server and the screens share every one of these.
import { describe, expect, it } from 'vitest';
import { newField } from './form-builder';
import { defaultGroupConfig, newSubField } from './field-config';
import { isAnswered, validateAnswer, validateAnswers } from './form-logic';
import { finalCheck } from './preview-logic';
import { sanitizeAnswers } from './applicant/answers';
import {
  cellKindOf, coerceCell, coerceTable, convertGroupToTable, defaultTableConfig, isTableAnswered, nextDefaultName, parseTableConfig, tableColumns, tableIssues, tableRows, tableSummary, validateCell,
} from './table';
import type { AnswerValue, FormField, GroupConfig, TableAnswer, TableConfig } from './types';

/** The competitive-analysis table of the INNOV-ID, as the import now makes it. */
function innov(over: Partial<TableConfig> = {}): TableConfig {
  const parsed = parseTableConfig({
    cornerTitle: 'Relevant Criteria',
    columns: [{ id: 'c_you', label: 'Your solution/company' }, { id: 'c_1', label: 'Competitor #1' }, { id: 'c_2', label: 'Competitor #2' }],
    rows: [{ id: 'r_prod', label: 'Products & Services' }, { id: 'r_model', label: 'Business Model' }, { id: 'r_share', label: 'Market Share (%)' }],
    cellKind: 'long_text', rowKinds: { r_share: 'percent' },
    addColumns: { allowed: true, max: 5, defaultName: 'Competitor #' }, addRows: { allowed: false, max: 3, defaultName: 'Row #' }, required: 'none', ...over,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.config;
}
const tableField = (cfg: TableConfig, required = false): FormField => ({ ...newField('table', 1, 0), id: 'tbl', label: 'Competitive analysis', required, validations: { table: cfg } });
const answer = (over: Partial<TableAnswer> = {}): TableAnswer => ({ columns: [], rows: [], cells: {}, ...over });

describe('reading the configuration', () => {
  it('keeps what is valid, and the ids the editor gave; the type of a row is kept only when it differs from the table\'s', () => {
    const c = innov();
    expect(c.columns.map((x) => x.id)).toEqual(['c_you', 'c_1', 'c_2']);
    expect(c.rowKinds).toEqual({ r_share: 'percent' });
    expect(cellKindOf(c, 'r_share')).toBe('percent');
    expect(cellKindOf(c, 'r_prod')).toBe('long_text');
    expect(c.addColumns).toEqual({ allowed: true, max: 5, defaultName: 'Competitor #' });
  });
  it('a table needs a column with a name, and a row — or the right to add rows; rows may have no name (they are numbered)', () => {
    expect(parseTableConfig({ columns: [], rows: [{ label: 'x' }] })).toMatchObject({ ok: false });
    expect(parseTableConfig({ columns: [{ label: '  ' }], rows: [{ label: 'x' }] })).toMatchObject({ ok: false });
    expect(parseTableConfig({ columns: [{ label: 'A' }], rows: [] })).toMatchObject({ ok: false, error: expect.stringContaining('at least one row') });
    expect(parseTableConfig({ columns: [{ label: 'A' }], rows: [], addRows: { allowed: true, max: 5 } })).toMatchObject({ ok: true });
    const numbered = parseTableConfig({ columns: [{ label: 'A' }], rows: [{ label: '' }, { label: '' }] });
    expect(numbered.ok && tableRows(numbered.config, null).map((r) => r.label)).toEqual(['1', '2']);
    expect(parseTableConfig(null)).toMatchObject({ ok: false });
  });
  it('the maximum counts the entity\'s own headers, is never below them and never above the ceiling; an unknown type or mode falls back', () => {
    const c = parseTableConfig({ columns: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], rows: [{ label: 'r' }], addColumns: { allowed: true, max: 1 }, addRows: { allowed: true, max: 9999 }, cellKind: 'nonsense', required: 'everything' });
    expect(c.ok && [c.config.addColumns.max, c.config.addRows.max, c.config.cellKind, c.config.required]).toEqual([3, 50, 'short_text', 'none']);
  });
  it('duplicate ids are given new ones, and a rowKinds entry for a row that does not exist is dropped', () => {
    const c = parseTableConfig({ columns: [{ id: 'same_id', label: 'A' }, { id: 'same_id', label: 'B' }], rows: [{ id: 'r_1', label: 'x' }], rowKinds: { r_1: 'number', ghost: 'amount' } });
    expect(c.ok && new Set(c.config.columns.map((x) => x.id)).size).toBe(2);
    expect(c.ok && c.config.rowKinds).toEqual({ r_1: 'number' });
  });
  it('a new table starts valid', () => { expect(parseTableConfig(defaultTableConfig())).toMatchObject({ ok: true }); });
});

describe('what a new column is called', () => {
  it('"Competitor #" gives the next number after the ones in use (Competitor #3 after #1 and #2); without a "#" a repeated name gets a number', () => {
    expect(nextDefaultName('Competitor #', ['Your solution/company', 'Competitor #1', 'Competitor #2'])).toBe('Competitor #3');
    expect(nextDefaultName('Competitor #', ['Your company'])).toBe('Competitor #1');
    expect(nextDefaultName('Competitor #', ['Competitor #1', 'Competitor #7'])).toBe('Competitor #8');
    expect(nextDefaultName('Other', ['A'])).toBe('Other');
    expect(nextDefaultName('Other', ['Other', 'Other 2'])).toBe('Other 3');
  });
});

describe('what each cell type accepts', () => {
  it('numbers and amounts: digits only; a percentage: 0 to 100, at most two decimals; text: a length', () => {
    expect(coerceCell('number', '12a3')).toBe('123');
    expect(coerceCell('amount', '€ 1 500,50')).toBe('150050');                        // digits only, like a Number question
    expect(coerceCell('percent', '12,5')).toBe('12.5');                               // a comma is accepted and stored as a dot
    expect(coerceCell('percent', 'abc')).toBeUndefined();
    expect(coerceCell('percent', '12.555')).toBeUndefined();
    expect(coerceCell('short_text', '   ')).toBeUndefined();
    expect(coerceCell('short_text', 'x'.repeat(600))).toHaveLength(500);
    expect(coerceCell('long_text', 'y'.repeat(6000))).toHaveLength(5000);
    expect(coerceCell('number', 5 as unknown as string)).toBeUndefined();
    expect(validateCell('percent', '100')).toBeNull(); expect(validateCell('percent', '100.5')).toContain('between 0 and 100'); expect(validateCell('percent', '101')).toContain('between 0 and 100');
    expect(validateCell('percent', '12.')).toContain('between 0 and 100');            // half-typed survives the autosave, the final check refuses it
    expect(validateCell('number', '12')).toBeNull(); expect(validateCell('number', 'x')).toBe('Digits only, please.');
  });
});

describe('what the server keeps of an answer: only what the applicant may author', () => {
  const cfg = innov();
  it('keeps the cells of the entity\'s rows and columns, coerced to the type of their row, and drops what has no row or no column', () => {
    const kept = coerceTable(cfg, { columns: [], rows: [], cells: { r_prod: { c_you: 'Our product', c_1: 'Theirs', nope: 'x' }, r_share: { c_you: '12,5', c_1: 'abc' }, ghost: { c_you: 'x' } } })!;
    expect(kept.cells).toEqual({ r_prod: { c_you: 'Our product', c_1: 'Theirs' }, r_share: { c_you: '12.5' } });
  });
  it('the entity\'s headers are not part of the answer: whatever the request says about them is ignored', () => {
    const kept = coerceTable(cfg, { columns: [{ id: 'c_you', name: 'HACKED', addedBy: 'applicant' }, { id: 'c_1', name: 'x', addedBy: 'applicant' }], rows: [{ id: 'r_prod', name: 'HACKED', addedBy: 'applicant' }], cells: { r_prod: { c_you: 'v' } }, headers: [{ id: 'c_you', label: 'HACKED' }], columnsOverride: [] } as unknown)!;
    expect(kept.columns).toEqual([]);                                                // an "added" column that has an entity id is refused
    expect(kept.rows).toEqual([]);                                                   // the entity does not let applicants add rows here
    expect(tableColumns(cfg, kept).map((c) => c.label)).toEqual(['Your solution/company', 'Competitor #1', 'Competitor #2']);
    expect(JSON.stringify(kept)).not.toContain('HACKED');
  });
  it('the applicant\'s own columns are kept up to the maximum (the entity\'s three counted), named as they chose, with their cells', () => {
    const extras = ['x_aaaa1111', 'x_bbbb2222', 'x_cccc3333', 'x_dddd4444'].map((id, i) => ({ id, name: `Mine ${i}`, addedBy: 'applicant' as const }));
    const kept = coerceTable(cfg, { columns: extras, rows: [], cells: { r_prod: { x_aaaa1111: 'a', x_dddd4444: 'dropped, over the maximum' } } })!;
    expect(kept.columns.map((c) => c.id)).toEqual(['x_aaaa1111', 'x_bbbb2222']);        // 3 own + 2 = the maximum of 5
    expect(kept.columns[0]).toEqual({ id: 'x_aaaa1111', name: 'Mine 0', addedBy: 'applicant' });
    expect(kept.cells).toEqual({ r_prod: { x_aaaa1111: 'a' } });
  });
  it('without the right to add, nothing the applicant "added" survives; a name that is empty gets the default; ids must be sane and unique', () => {
    const closed = innov({ addColumns: { allowed: false, max: 3, defaultName: 'Competitor #' } });
    expect(coerceTable(closed, { columns: [{ id: 'x_aaaa1111', name: 'A', addedBy: 'applicant' }], rows: [], cells: {} })).toBeUndefined();
    const kept = coerceTable(cfg, { columns: [{ id: 'x_aaaa1111', name: '   ', addedBy: 'applicant' }, { id: 'x_aaaa1111', name: 'dup', addedBy: 'applicant' }, { id: 'bad id!', name: 'z', addedBy: 'applicant' }, { id: 'ab', name: 'z', addedBy: 'applicant' }], rows: [], cells: {} })!;
    expect(kept.columns).toEqual([{ id: 'x_aaaa1111', name: 'Competitor 1', addedBy: 'applicant' }]);
  });
  it('rows the applicant adds, when allowed, work the same way', () => {
    const rows = innov({ addRows: { allowed: true, max: 5, defaultName: 'Criterion #' } });
    const kept = coerceTable(rows, { columns: [], rows: [{ id: 'x_row00001', name: 'Team size', addedBy: 'applicant' }], cells: { x_row00001: { c_you: '12' } } })!;
    expect(tableRows(rows, kept).map((r) => [r.label, r.own])).toEqual([['Products & Services', false], ['Business Model', false], ['Market Share (%)', false], ['Team size', true]]);
    expect(kept.cells.x_row00001).toEqual({ c_you: '12' });
  });
  it('an empty answer is no answer; one with only a column the applicant added is kept (they did something); a non-table value is dropped', () => {
    expect(coerceTable(cfg, { columns: [], rows: [], cells: {} })).toBeUndefined();
    expect(coerceTable(cfg, 'a string')).toBeUndefined();
    expect(coerceTable(cfg, [1, 2])).toBeUndefined();
    expect(coerceTable(cfg, { columns: [{ id: 'x_aaaa1111', name: 'Mine', addedBy: 'applicant' }], rows: [], cells: {} })).toMatchObject({ columns: [{ id: 'x_aaaa1111' }] });
  });
  it('goes through sanitizeAnswers like every other kind (and never trusts the key of a field that is not a table)', () => {
    const f = tableField(cfg);
    const out = sanitizeAnswers([f], { tbl: { columns: [], rows: [], cells: { r_prod: { c_you: 'Ours' } } }, other: { x: 1 } });
    expect(out).toEqual({ tbl: { columns: [], rows: [], cells: { r_prod: { c_you: 'Ours' } } } });
  });
});

describe('what is required', () => {
  const full = (cfg: TableConfig) => {
    const cells: Record<string, Record<string, string>> = {};
    for (const r of cfg.rows) { cells[r.id] = {}; for (const c of cfg.columns) cells[r.id][c.id] = r.id === 'r_share' ? '10' : 'text'; }
    return answer({ cells });
  };
  it('"none": nothing is required (an optional table may be left empty); "Required" on the question needs one cell', () => {
    const f = tableField(innov());
    expect(validateAnswer(f, null)).toBeNull();
    expect(validateAnswer({ ...f, required: true }, null)).toBe('This answer is required.');
    expect(validateAnswer({ ...f, required: true }, answer({ cells: { r_prod: { c_1: 'x' } } }))).toBeNull();
  });
  it('"all": every cell of the entity\'s columns, once the table is started (or required) — one item per missing cell, "Row — Column"', () => {
    const f = tableField(innov({ required: 'all' }));
    expect(tableIssues(f, null)).toEqual([]);                                          // optional and not started: it asks for nothing
    const started = answer({ cells: { r_prod: { c_you: 'ours' } } });
    const issues = tableIssues(f, started);
    expect(issues).toHaveLength(8);                                                    // 3 rows × 3 columns = 9 cells, 1 filled
    expect(issues[0]).toEqual({ key: 'tbl#r_prod/c_1', message: 'Products & Services — Competitor #1: This answer is required.' });
    expect(tableIssues({ ...f, required: true }, null)).toHaveLength(9);              // required: everything, from the start
    expect(tableIssues(f, full(innov({ required: 'all' })))).toEqual([]);
  });
  it('"first_column": only the cells of the first of the entity\'s columns', () => {
    const f = tableField(innov({ required: 'first_column' }));
    const issues = tableIssues({ ...f, required: true }, null);
    expect(issues.map((i) => i.key)).toEqual(['tbl#r_prod/c_you', 'tbl#r_model/c_you', 'tbl#r_share/c_you']);
  });
  it('the applicant\'s own columns are never required, even with "all"', () => {
    const f = tableField(innov({ required: 'all' }));
    const a = full(innov({ required: 'all' }));
    a.columns = [{ id: 'x_aaaa1111', name: 'Mine', addedBy: 'applicant' }];
    expect(tableIssues(f, a)).toEqual([]);
  });
  it('a wrong value is reported with its cell, in the form\'s final check too; a column over the maximum, or added where it is not allowed, is reported', () => {
    const cfg = innov();
    const f = tableField(cfg);
    const a = answer({ cells: { r_share: { c_you: '150' } } });
    expect(tableIssues(f, a)).toEqual([{ key: 'tbl#r_share/c_you', message: 'Market Share (%) — Your solution/company: Enter a percentage between 0 and 100.' }]);
    const fc = finalCheck([f], { tbl: a });
    expect(fc).toHaveLength(1); expect(fc[0]).toMatchObject({ fieldId: 'tbl', key: 'tbl#r_share/c_you', label: 'Competitive analysis' });
    const many = answer({ columns: Array.from({ length: 4 }, (_, i) => ({ id: `x_col0000${i}`, name: `n${i}`, addedBy: 'applicant' as const })) });
    expect(tableIssues(f, many).map((i) => i.key)).toEqual(['tbl#columns']);
    const closed = tableField(innov({ addColumns: { allowed: false, max: 3, defaultName: 'C #' } }));
    expect(tableIssues(closed, answer({ columns: [{ id: 'x_aaaa1111', name: 'z', addedBy: 'applicant' }] })).map((i) => i.key)).toEqual(['tbl#columns']);
  });
  it('validateAnswers and the form\'s answered-ness: a header the applicant added and left empty is not an answer', () => {
    const f = tableField(innov({ required: 'all' }), true);
    expect(isAnswered(answer({ columns: [{ id: 'x_aaaa1111', name: 'Mine', addedBy: 'applicant' }] }) as AnswerValue)).toBe(false);
    expect(isAnswered(answer({ cells: { r_prod: { c_1: 'x' } } }) as AnswerValue)).toBe(true);
    expect(Object.keys(validateAnswers([f], {}))).toEqual(['tbl']);
  });
});

describe('reading it as text', () => {
  it('says how big it is and how much is filled in', () => {
    const f = tableField(innov());
    expect(tableSummary(f, answer({ cells: { r_prod: { c_you: 'a', c_1: 'b' } } }))).toBe('3 rows × 3 columns · 2 cells filled');
    expect(tableSummary(f, answer({ columns: [{ id: 'x_aaaa1111', name: 'M', addedBy: 'applicant' }], cells: { r_prod: { x_aaaa1111: 'z' } } }))).toBe('3 rows × 4 columns · 1 cell filled');
    expect(isTableAnswered(null)).toBe(false);
  });
});

describe('converting an old group in table mode', () => {
  /** The shape the import used to make: the companies as fixed rows (first column), the criteria as the other questions. */
  function oldGroup(over: Partial<GroupConfig> = {}): FormField {
    const g: GroupConfig = defaultGroupConfig();
    const company = newSubField('short_text'); company.label = 'Company';
    const products = newSubField('long_text'); products.label = 'Products & Services'; products.id = '11111111-1111-4111-8111-111111111111';
    const share = newSubField('number'); share.label = 'Market share'; share.id = '22222222-2222-4222-8222-222222222222';
    return { ...newField('group', 6, 3), label: 'Competitive Detailed Analysis', validations: { group: { ...g, display: 'table', entryLabel: 'Company', presetRows: [['Your solution/company'], ['Competitor #1'], ['Competitor #2']], min: 3, max: 3, subFields: [company, products, share], ...over } } };
  }
  it('the fixed rows become columns, the questions become criteria (rows); applicants can add columns; the table is valid', () => {
    const c = convertGroupToTable(oldGroup());
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.table.columns.map((x) => [x.id, x.label])).toEqual([['row1', 'Your solution/company'], ['row2', 'Competitor #1'], ['row3', 'Competitor #2']]);
    expect(c.table.rows.map((r) => r.label)).toEqual(['Products & Services', 'Market share']);
    expect(c.table.rowKinds).toEqual({ '11111111-1111-4111-8111-111111111111': 'long_text', '22222222-2222-4222-8222-222222222222': 'number' });
    expect(c.table.addColumns).toEqual({ allowed: true, max: 6, defaultName: 'Competitor #' });
    expect(c.table.addRows.allowed).toBe(false);
    expect(parseTableConfig(c.table)).toMatchObject({ ok: true });
    expect(c.summary).toContain('3 fixed rows became columns');
  });
  it('a draft answer is re-keyed, not rewritten: entry ids are the column ids, question ids the row ids, nothing is invented', () => {
    const c = convertGroupToTable(oldGroup());
    if (!c.ok) throw new Error(c.reason);
    const carried = c.answer([
      { id: 'row1', values: { [oldGroup().validations.group!.subFields[0].id]: 'Your solution/company', '11111111-1111-4111-8111-111111111111': 'Our product', '22222222-2222-4222-8222-222222222222': '12' } },
      { id: 'row2', values: { '11111111-1111-4111-8111-111111111111': 'Their product' } },
      { id: 'stranger', values: { '11111111-1111-4111-8111-111111111111': 'ignored' } },
    ] as unknown as AnswerValue)!;
    expect(carried).toEqual({ columns: [], rows: [], cells: { '11111111-1111-4111-8111-111111111111': { row1: 'Our product', row2: 'Their product' }, '22222222-2222-4222-8222-222222222222': { row1: '12' } } });
    expect(c.answer(undefined as unknown as AnswerValue)).toBeUndefined();
    expect(c.answer([{ id: 'row1', values: {} }] as unknown as AnswerValue)).toBeUndefined();
  });
  it('"every cell required" when every question was required; otherwise none in particular', () => {
    const g = oldGroup(); const subs = g.validations.group!.subFields.map((s) => ({ ...s, required: true }));
    const all = convertGroupToTable({ ...g, validations: { group: { ...g.validations.group!, subFields: subs } } });
    expect(all.ok && all.table.required).toBe('all');
    expect(convertGroupToTable(g).ok && (convertGroupToTable(g) as { table: TableConfig }).table.required).toBe('none');
  });
  it('refuses, with the reason, what it cannot convert: not a group, not a table, rows not set, fixed text beyond the first column, a file/choice question', () => {
    expect(convertGroupToTable(newField('short_text'))).toMatchObject({ ok: false });
    expect(convertGroupToTable(oldGroup({ display: 'cards' }))).toMatchObject({ ok: false, reason: expect.stringContaining('shown as a table') });
    expect(convertGroupToTable(oldGroup({ presetRows: [] }))).toMatchObject({ ok: false });
    expect(convertGroupToTable(oldGroup({ presetRows: [['A', 'x'], ['B', 'y']] }))).toMatchObject({ ok: false, reason: expect.stringContaining('first column') });
    const f = oldGroup(); const subs = [...f.validations.group!.subFields, { ...newSubField('file'), label: 'Evidence' }];
    expect(convertGroupToTable({ ...f, validations: { group: { ...f.validations.group!, subFields: subs } } })).toMatchObject({ ok: false, reason: expect.stringContaining('Evidence') });
    expect(convertGroupToTable(oldGroup({ subFields: [newSubField('short_text')] }))).toMatchObject({ ok: false, reason: expect.stringContaining('no criteria') });
  });
});
