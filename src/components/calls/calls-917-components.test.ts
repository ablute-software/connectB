// Prompt 917, I1 — the new kinds as the three sides draw them: the applicant's inputs (the same ones the preview and the test mode use), the entity's editor
// panels, and the read-only Submissions. Static markup: what is written, which controls exist, which are off.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { newField } from '@/lib/calls/form-builder';
import type { FormField, GroupConfig, SubField } from '@/lib/calls/types';

vi.mock('@/lib/supabase', () => ({ browserClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }), authEnabled: false }));

import { FieldInput } from './FieldInput';
import { GroupInput } from './GroupInput';
import { FileConfigEditor, GroupEditor, UrlConfigEditor } from './GroupEditor';
import { AnswerView } from './SubmissionsTab';
import { FileQuestion } from './applicant/FileQuestion';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sub = (n: number, kind: SubField['kind'], over: Partial<SubField> = {}): SubField => ({ id: U(n), kind, label: `Q${n}`, required: false, options: [], validations: {}, ...over });
const grp = (cfg: Partial<GroupConfig>, over: Partial<FormField> = {}): FormField => ({
  ...newField('group', 1, 0), id: 'group-team-1', label: 'Team',
  validations: { group: { entryLabel: 'Team member', min: 1, max: 3, display: 'cards', presetRows: [], subFields: [sub(1, 'short_text', { label: 'Name', required: true }), sub(2, 'email', { label: 'Email' }), sub(3, 'file', { label: 'CV' })], ...cfg } }, ...over,
});
const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const input = (field: FormField, value: unknown = undefined, extra: Record<string, unknown> = {}) =>
  render(createElement(FieldInput, { field, value: value as never, currency: 'EUR', onChange: () => {}, ...extra }));

describe('the applicant\'s inputs', () => {
  it('a link: a URL input that says https://, with the entity\'s hint (never a restriction)', () => {
    const html = input({ ...newField('url', 1, 0), validations: { urlHint: 'video' }, label: 'Pitch video' });
    expect(html).toContain('type="url"'); expect(html).toContain('placeholder="https://"');
    expect(html).toContain('A link to a video (youtube, vimeo…), starting with https://');
  });
  it('an email: an email input', () => {
    expect(input({ ...newField('email', 1, 0), label: 'Email' })).toContain('type="email"');
  });
  it('a File: only the accepted formats are offered, several files when the question takes several; the hint says what it takes', () => {
    const several = input({ ...newField('file', 1, 0), validations: { fileFormats: ['pdf', 'word'], maxFiles: 3, maxFileMb: 5 } });
    expect(several).toContain('multiple=""'); expect(several).toContain('.docx'); expect(several).toContain('application/pdf');
    expect(several).toContain('PDF or Word only, up to 5 MB each · up to 3 files');
    const single = input(newField('file', 1, 0));
    expect(single).not.toContain('multiple'); expect(single).toContain('PDF only, up to 10 MB');
    expect(single).not.toContain('.docx');
  });
  it('a File question of the applicant lists each attached file with its own Remove, offers "Add another file" up to the maximum, and no ZIP', () => {
    const q = { ...newField('file', 1, 0), validations: { fileFormats: ['pdf' as const, 'word' as const], maxFiles: 3 } };
    const files = [{ id: 'f1', fieldId: q.id, source: 'upload' as const, fileName: 'plan.pdf', size: 2048 }, { id: 'f2', fieldId: q.id, source: 'upload' as const, fileName: 'cv.docx', size: 4096 }];
    const html = render(createElement(FileQuestion, { field: q, applicationId: 'a1', orgId: 'o1', files, disabled: false, onAttached: () => {}, onRemoved: () => {}, onUpdated: () => {} }));
    expect(html).toContain('plan.pdf'); expect(html).toContain('cv.docx');
    expect((html.match(/data-testid="attached-file"/g) ?? [])).toHaveLength(2);
    expect(html).toContain('Add another file');
    expect(html).toContain('PDF or Word only, up to 10 MB each · up to 3 files');
    expect(html).toContain('choose-from-vault');                      // a PDF question may still take one from the Vault
    expect(html).not.toMatch(/\.zip/i);
    const full = render(createElement(FileQuestion, { field: q, applicationId: 'a1', orgId: 'o1', files: [...files, { ...files[0], id: 'f3', fileName: 'x.pdf' }], disabled: false, onAttached: () => {}, onRemoved: () => {}, onUpdated: () => {} }));
    expect(full).toContain('The maximum of 3 files is attached'); expect(full).not.toContain('Add another file');
    const noPdf = render(createElement(FileQuestion, { field: { ...q, validations: { fileFormats: ['image' as const] } }, applicationId: 'a1', orgId: 'o1', files: [], disabled: false, onAttached: () => {}, onRemoved: () => {}, onUpdated: () => {} }));
    expect(noPdf).not.toContain('choose-from-vault');                 // the Vault only holds PDFs for this purpose
    expect(noPdf).toContain('Image (JPG, PNG) only');
  });
});

describe('a repeatable group, drawn', () => {
  it('as cards: each entry has its title, its questions, Up / Down / Remove; "Add another" with the count; Remove off at the minimum', () => {
    const value = [{ id: 'entry-1', values: { [U(1)]: 'Ana' } }, { id: 'entry-2', values: { [U(1)]: 'Bruno' } }];
    const html = render(createElement(GroupInput, { field: grp({}), value, currency: 'EUR', onChange: () => {} }));
    expect(html).toContain('Team member 1'); expect(html).toContain('Team member 2');
    expect(html).toContain('data-display="cards"');
    expect(html).toContain('+ Add another team member'); expect(html).toContain('2 of 3 · at least 1');
    expect((html.match(/data-testid="group-entry"/g) ?? [])).toHaveLength(2);
    // a single entry at the minimum cannot be removed
    const one = render(createElement(GroupInput, { field: grp({}), value: [value[0]], currency: 'EUR', onChange: () => {} }));
    expect(one).toMatch(/data-testid="remove-entry"[^>]*disabled|disabled=""[^>]*data-testid="remove-entry"/);
    // at the maximum "Add another" is off
    const max = render(createElement(GroupInput, { field: grp({ max: 2 }), value, currency: 'EUR', onChange: () => {} }));
    expect(max).toMatch(/disabled=""[^>]*data-testid="add-entry"|data-testid="add-entry"[^>]*disabled/);
  });
  it('an empty group says what is needed; inside an entry a File question uses the applicant\'s own control', () => {
    const empty = render(createElement(GroupInput, { field: grp({}), value: undefined, currency: 'EUR', onChange: () => {} }));
    expect(empty).toContain('Optional — add a team member only if it applies.');
    expect(empty).not.toContain('Add at least');
    const required = render(createElement(GroupInput, { field: grp({}, { required: true }), value: undefined, currency: 'EUR', onChange: () => {} }));
    expect(required).toContain('Add at least one team member.');
    const withFile = input(grp({}), [{ id: 'entry-1', values: {} }], { fileControlFor: (s: SubField, entryId: string) => createElement('i', { 'data-testid': 'custom-file' }, `${s.label}@${entryId}`) });
    expect(withFile).toContain('CV@entry-1');
  });
  it('shows every problem when asked (test mode, a failed attempt), the entry and the question: and only what was typed wrong otherwise', () => {
    const value = [{ id: 'entry-1', values: { [U(2)]: 'not-an-email' } }];
    const typed = render(createElement(GroupInput, { field: grp({}), value, currency: 'EUR', onChange: () => {} }));
    expect(typed).toContain('Enter a valid email address.');
    expect(typed).not.toContain('This answer is required.');           // the required Name was simply not reached yet
    const all = render(createElement(GroupInput, { field: grp({}), value, currency: 'EUR', showAllErrors: true, onChange: () => {} }));
    expect(all).toContain('This answer is required.');
  });
  it('as a table: the questions are the columns and the entries the rows', () => {
    const t = grp({ display: 'table', subFields: [sub(1, 'short_text', { label: 'Company' }), sub(2, 'long_text', { label: 'Strengths', required: true })] });
    const html = render(createElement(GroupInput, { field: t, value: [{ id: 'e1', values: {} }, { id: 'e2', values: {} }], currency: 'EUR', onChange: () => {} }));
    expect(html).toContain('data-display="table"'); expect(html).toContain('<table');
    expect(html).toContain('>Company'); expect(html).toContain('Strengths');
    expect((html.match(/data-testid="group-entry"/g) ?? [])).toHaveLength(2);
    expect(html).toContain('aria-label="Company"');                     // a cell has no label of its own: the column header names it
  });
  it('with rows set by the entity: the first columns are read-only text, and there is no Add, Remove or Move', () => {
    const t = grp({ display: 'table', presetRows: [['Your company'], ['Competitor 1']], min: 2, max: 2, subFields: [sub(1, 'short_text', { label: 'Company' }), sub(2, 'long_text', { label: 'Strengths' })] });
    const value = [{ id: 'row1', values: { [U(1)]: 'Your company' } }, { id: 'row2', values: { [U(1)]: 'Competitor 1' } }];
    const html = render(createElement(GroupInput, { field: t, value, currency: 'EUR', onChange: () => {} }));
    expect(html).toContain('Your company'); expect(html).toContain('Competitor 1');
    expect((html.match(/data-testid="preset-cell"/g) ?? [])).toHaveLength(2);
    expect(html).not.toContain('Add another'); expect(html).not.toContain('Remove'); expect(html).not.toContain('Move');
    // read-only everywhere when the form is not editable
    const ro = render(createElement(GroupInput, { field: grp({}), value: [{ id: 'e1', values: {} }], currency: 'EUR', disabled: true, onChange: () => {} }));
    expect(ro).not.toContain('Add another'); expect(ro).not.toContain('data-testid="remove-entry"');
  });
});

describe('the entity\'s editor', () => {
  it('a File: the formats (PDF by default, no ZIP anywhere), the size, "Allow several files" and the maximum up to 10', () => {
    const html = render(createElement(FileConfigEditor, { value: { maxFileMb: 10 }, idPrefix: 'fp', onChange: () => {} }));
    for (const f of ['PDF', 'Word', 'Excel', 'PowerPoint', 'Image (JPG, PNG)']) expect(html).toContain(f);
    expect(html).toMatch(/checked=""[^>]*data-testid="format-pdf"|data-testid="format-pdf"[^>]*checked=""/);
    expect(html).not.toMatch(/data-testid="format-word"[^>]*checked/);
    expect(html).toContain('ZIP files are never accepted'); expect(html).toContain('Allow several files');
    expect(html).not.toContain('data-testid="max-files"');
    const several = render(createElement(FileConfigEditor, { value: { maxFiles: 4, fileFormats: ['pdf', 'word'] }, idPrefix: 'fp', onChange: () => {} }));
    expect(several).toContain('data-testid="max-files"'); expect(several).toContain('value="4"'); expect(several).toContain('max="10"');
  });
  it('a Link: the hint, and what is accepted and how it is shown in Submissions', () => {
    const html = render(createElement(UrlConfigEditor, { value: { urlHint: 'website' }, onChange: () => {} }));
    expect(html).toContain('Video (YouTube, Vimeo…)'); expect(html).toContain('Website'); expect(html).toContain('Other');
    expect(html).toContain('http:// and https://'); expect(html).toContain('opens in a new tab');
  });
  it('a group: its name, minimum, maximum, cards or table, and its questions; the rows only for a table; the v1 limits written out', () => {
    const cards = render(createElement(GroupEditor, { value: grp({}).validations.group!, onChange: () => {} }));
    expect(cards).toContain('What is one entry called?'); expect(cards).toContain('Team member');
    expect(cards).toContain('data-testid="group-min"'); expect(cards).toContain('data-testid="group-max"'); expect(cards).toContain('data-testid="group-display"');
    expect((cards.match(/data-testid="group-subfield"/g) ?? [])).toHaveLength(3);
    expect(cards).not.toContain('data-testid="group-rows"');
    expect(cards).toContain('cannot contain another group'); expect(cards).toContain('cannot depend on a question inside a group');
    expect(cards).not.toMatch(/<option value="group"/);                         // no group inside a group
    const table = render(createElement(GroupEditor, { value: grp({ display: 'table', presetRows: [['Your company'], ['Competitor 1']], min: 2, max: 2 }).validations.group!, onChange: () => {} }));
    expect(table).toContain('data-testid="group-rows"');
    expect(table).toContain('Your company\nCompetitor 1');
    expect(table).toMatch(/data-testid="group-min"[^>]*disabled|disabled=""[^>]*data-testid="group-min"/);   // fixed rows: min = max = the rows
  });
});

describe('Submissions: the entity reads it, read-only', () => {
  const docs = [{ fileId: 'f1', fieldId: 'x', fileName: 'plan.pdf', size: 2048, source: 'upload', versionNumber: null, url: '/api/calls/c/submissions/a/documents/f1' }, { fileId: 'f2', fieldId: 'x', fileName: 'cv.docx', size: 4096, source: 'vault', versionNumber: 3, url: '/api/calls/c/submissions/a/documents/f2' }];
  const view = (field: FormField, value: unknown) => render(createElement(AnswerView, { field, value: value as never, docs, currency: 'EUR' }));
  it('a link opens in a NEW tab, without the opener or the referrer, and is never embedded; only http(s) becomes a link', () => {
    const f = newField('url', 1, 0);
    const ok = view(f, 'https://youtu.be/abc123');
    expect(ok).toContain('href="https://youtu.be/abc123"'); expect(ok).toContain('target="_blank"'); expect(ok).toContain('rel="noopener noreferrer"');
    expect(ok).not.toMatch(/<iframe|<embed|<video|<object/);
    const bad = view(f, 'javascript:alert(1)');
    expect(bad).not.toContain('<a '); expect(bad).toContain('javascript:alert(1)');
    expect(view(f, undefined)).toBe('—');
  });
  it('several files are listed, each a download with its size; a Vault file says so', () => {
    const f = { ...newField('file', 1, 0), validations: { maxFiles: 3 } };
    const html = view(f, [{ fileName: 'plan.pdf', size: 2048, fileId: 'f1' }, { fileName: 'cv.docx', size: 4096, fileId: 'f2' }]);
    expect(html).toContain('href="/api/calls/c/submissions/a/documents/f1"'); expect(html).toContain('href="/api/calls/c/submissions/a/documents/f2"');
    expect(html).toContain('2 KB'); expect(html).toContain('from the Vault (v3)');
  });
  it('a group as cards (one per entry, each question named) and as a table (its columns and rows), files inside entries included', () => {
    const value = [{ id: 'e1', values: { [U(1)]: 'Ana', [U(2)]: 'ana@acme.pt', [U(3)]: { fileName: 'plan.pdf', size: 2048, fileId: 'f1' } } }, { id: 'e2', values: { [U(1)]: 'Bruno' } }];
    const cards = view(grp({}), value);
    expect(cards).toContain('data-testid="answer-group-cards"'); expect(cards).toContain('Team member 1'); expect(cards).toContain('Team member 2');
    expect(cards).toContain('Ana'); expect(cards).toContain('ana@acme.pt'); expect(cards).toContain('href="/api/calls/c/submissions/a/documents/f1"');
    const table = view(grp({ display: 'table' }), value);
    expect(table).toContain('data-testid="answer-group-table"'); expect(table).toContain('<th'); expect(table).toContain('Bruno');
    expect(view(grp({}), [])).toBe('—');
  });
  it('has nothing to edit: no input, no button', () => {
    const html = view(grp({}), [{ id: 'e1', values: { [U(1)]: 'Ana' } }]);
    expect(html).not.toMatch(/<input|<button|<textarea|<select/);
  });
});
