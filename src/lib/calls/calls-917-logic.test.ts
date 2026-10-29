// Prompt 917 (I1) — the new kinds of question, as pure rules: link, email, File (formats, several files), and the repeatable group — how they are read from the
// editor, validated, sanitised on the server and handled when files are attached and removed.
import { describe, expect, it } from 'vitest';
import {
  FILE_FORMATS, acceptAttr, entriesOf, fileFormatsOf, fileIdsInAnswers, fileQuestions, formatOfName, formatsText, groupMin, isEmail, isHttpUrl, locateFile, maxFilesForTarget,
  maxFilesOf, newEntry, parseGroupConfig, parseSimpleValidations, removeFileFromAnswers, setFileInAnswers, subFieldAsField,
} from './field-config';
import { groupErrors, isAnswered, validateAnswer, validateAnswers } from './form-logic';
import { newField, parseFieldsPayload } from './form-builder';
import { finalCheck } from './preview-logic';
import { sanitizeAnswers, withPresetRows, type FileRef } from './applicant/answers';
import { frozenPath, planSubmission } from './applicant/submit';
import type { FormField, GroupConfig, SubField } from './types';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sub = (n: number, kind: SubField['kind'], over: Partial<SubField> = {}): SubField => ({ id: U(n), kind, label: `Q${n}`, required: false, options: [], validations: {}, ...over });
const group = (cfg: Partial<GroupConfig> & { subFields: SubField[] }, over: Partial<FormField> = {}): FormField => ({
  ...newField('group', 1, 0), id: 'group-team-1', label: 'Team', validations: { group: { entryLabel: 'Team member', min: 0, max: 5, display: 'cards', presetRows: [], ...cfg } }, ...over,
});
const field = (kind: FormField['kind'], over: Partial<FormField> = {}): FormField => ({ ...newField(kind, 1, 0), id: `field-${kind}-0001`, ...over });
const fv = (name: string, size = 1000, id?: string) => ({ fileName: name, size, ...(id ? { fileId: id } : {}) });

describe('a link', () => {
  it('accepts only http(s)://, never anything that could run or read something when opened', () => {
    for (const ok of ['https://youtu.be/abc123', 'http://example.com/path?x=1#y', 'https://www.sherlockdeal.com']) expect(isHttpUrl(ok)).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'ftp://example.com/x', '//example.com', 'example.com', 'https://', 'https://a b.com', '  ', 'https://exa mple.com', `https://x.com/${'a'.repeat(2100)}`]) expect(isHttpUrl(bad), bad).toBe(false);
  });
  it('is validated as a question: a wrong link says what is expected', () => {
    const f = field('url', { required: true });
    expect(validateAnswer(f, 'https://vimeo.com/1')).toBeNull();
    expect(validateAnswer(f, 'vimeo.com/1')).toMatch(/http/);
    expect(validateAnswer(f, '')).toBe('This answer is required.');
    expect(validateAnswer(field('url'), '')).toBeNull();
  });
  it('keeps the hint the entity chose (video, website, other) and nothing else; a hint is not a restriction', () => {
    expect(parseSimpleValidations('url', { urlHint: 'video' })).toEqual({ urlHint: 'video' });
    expect(parseSimpleValidations('url', { urlHint: 'something-else' })).toEqual({});
    expect(validateAnswer(field('url', { validations: { urlHint: 'video' } }), 'https://example.com/not-a-video')).toBeNull();
  });
});

describe('an email', () => {
  it('has its format checked', () => {
    const f = field('email', { required: true });
    expect(validateAnswer(f, 'ana@example.pt')).toBeNull();
    for (const bad of ['ana', 'ana@', '@example.pt', 'ana@example', 'a b@example.pt', 'ana@@example.pt']) expect(validateAnswer(f, bad), bad).toMatch(/valid email/);
    expect(isEmail(' ana@example.pt ')).toBe(true);
  });
});

describe('a File question: formats and several files', () => {
  it('takes PDF by default (existing questions are unchanged), and exactly what the entity chose otherwise', () => {
    expect(fileFormatsOf(undefined)).toEqual(['pdf']);
    expect(fileFormatsOf({ fileFormats: [] })).toEqual(['pdf']);
    expect(fileFormatsOf({ fileFormats: ['excel', 'pdf'] })).toEqual(['pdf', 'excel']);
    expect(formatsText(['pdf'])).toBe('PDF');
    expect(formatsText(['pdf', 'word'])).toBe('PDF or Word');
    expect(formatsText(['pdf', 'word', 'excel'])).toBe('PDF, Word or Excel');
    expect(acceptAttr(['pdf', 'image'])).toContain('image/png');
    expect(Object.keys(FILE_FORMATS)).toEqual(['pdf', 'word', 'excel', 'powerpoint', 'image']);        // no zip, no legacy .doc/.xls
    expect(Object.values(FILE_FORMATS).flatMap((f) => f.extensions)).not.toContain('zip');
  });
  it('the name of a file must belong to an accepted format (the server checks the bytes as well)', () => {
    expect(formatOfName('cv.PDF', ['pdf'])).toBe('pdf');
    expect(formatOfName('cv.docx', ['pdf'])).toBeNull();
    expect(formatOfName('photo.jpeg', ['image'])).toBe('image');
    expect(formatOfName('bundle.zip', ['pdf', 'word', 'excel', 'powerpoint', 'image'])).toBeNull();
    // The old Office formats count since 29/10/2026 (the server decides by the bytes); a macro-enabled file never does.
    expect(formatOfName('old.doc', ['word'])).toBe('word');
    expect(formatOfName('old.XLS', ['excel'])).toBe('excel');
    expect(formatOfName('old.ppt', ['powerpoint'])).toBe('powerpoint');
    for (const n of ['book.xlsm', 'cv.docm', 'deck.pptm']) expect(formatOfName(n, ['word', 'excel', 'powerpoint'])).toBeNull();
  });
  it('validates the format, the size, and how many files', () => {
    const f = field('file', { required: true, validations: { fileFormats: ['pdf', 'word'], maxFiles: 2, maxFileMb: 1 } });
    expect(validateAnswer(f, [fv('a.pdf'), fv('b.docx')])).toBeNull();
    expect(validateAnswer(f, [fv('a.pdf'), fv('b.docx'), fv('c.pdf')])).toBe('You can attach at most 2 files.');
    expect(validateAnswer(f, fv('a.xlsx'))).toBe('“a.xlsx” is not an accepted file type. This question accepts PDF or Word files (.pdf, .docx, .doc).');
    expect(validateAnswer(f, [fv('a.pdf', 2 * 1024 * 1024)])).toBe('The file is too large (maximum 1 MB).');
    expect(validateAnswer(f, fv('a.pdf'))).toBeNull();                                       // one file where several are allowed
    expect(validateAnswer(field('file', { validations: { maxFileMb: 10 } }), [fv('a.pdf'), fv('b.pdf')])).toBe('Only one file can be attached here.');
  });
  it('is read from the editor within the limits: up to 10 files, up to 50 MB, at least one format; one file stays "one"', () => {
    expect(parseSimpleValidations('file', { maxFiles: 99, maxFileMb: 999, fileFormats: ['pdf', 'zip', 'image'] })).toEqual({ maxFileMb: 50, maxFiles: 10, fileFormats: ['pdf', 'image'] });
    expect(parseSimpleValidations('file', { maxFiles: 1 })).toEqual({ maxFileMb: 10 });
    expect(maxFilesOf(parseSimpleValidations('file', { maxFiles: 4 }))).toBe(4);
  });
  it('a list of files is "answered" when it is not empty', () => {
    expect(isAnswered([fv('a.pdf')])).toBe(true);
    expect(isAnswered([])).toBe(false);
  });
});

describe('a repeatable group — its configuration', () => {
  it('is read from the editor: entries, min, max, questions, cards or table', () => {
    const r = parseGroupConfig({ entryLabel: ' Team member ', min: 1, max: 6, display: 'table', subFields: [{ id: U(1), kind: 'short_text', label: 'Name', required: true }, { id: U(2), kind: 'email', label: 'Email' }, { id: U(3), kind: 'file', label: 'CV', validations: { maxFiles: 1, fileFormats: ['pdf'] } }] });
    expect(r).toMatchObject({ ok: true, config: { entryLabel: 'Team member', min: 1, max: 6, display: 'table', presetRows: [] } });
    if (r.ok) expect(r.config.subFields.map((s) => [s.kind, s.required])).toEqual([['short_text', true], ['email', false], ['file', false]]);
  });
  it('refuses a group in a group, a group with no question, too many questions, and a minimum above the maximum', () => {
    expect(parseGroupConfig({ subFields: [{ kind: 'group', label: 'inner' }] })).toEqual({ ok: false, error: 'A group cannot contain another group.' });
    expect(parseGroupConfig({ subFields: [] })).toEqual({ ok: false, error: 'A group needs at least one question.' });
    expect(parseGroupConfig({ subFields: Array.from({ length: 21 }, () => ({ kind: 'short_text', label: 'x' })) })).toMatchObject({ ok: false });
    expect(parseGroupConfig({ min: 5, max: 2, subFields: [{ kind: 'short_text', label: 'x' }] })).toEqual({ ok: false, error: 'The minimum number of entries cannot be above the maximum.' });
    expect(parseGroupConfig(null)).toMatchObject({ ok: false });
  });
  it('gives every question an id of its own (a file in an entry is registered under it) and never repeats one', () => {
    const r = parseGroupConfig({ subFields: [{ id: 'not-a-uuid', kind: 'short_text', label: 'a' }, { id: U(1), kind: 'short_text', label: 'b' }, { id: U(1), kind: 'short_text', label: 'c' }] });
    expect(r).toEqual({ ok: false, error: 'Duplicate question in a group.' });
    const ok = parseGroupConfig({ subFields: [{ id: 'not-a-uuid', kind: 'short_text', label: 'a' }] });
    expect(ok.ok && /^[0-9a-f-]{36}$/.test(ok.config.subFields[0].id)).toBe(true);
  });
  it('a table whose rows the entity sets has exactly those rows: first columns fixed, minimum = maximum = the rows', () => {
    const r = parseGroupConfig({ display: 'table', min: 0, max: 20, presetRows: [['Your company'], ['Competitor 1'], [' '], ['Competitor 2 | x']], subFields: [{ kind: 'short_text', label: 'Name' }, { kind: 'long_text', label: 'Strengths' }] });
    expect(r.ok && r.config.presetRows).toEqual([['Your company'], ['Competitor 1'], ['Competitor 2 | x']]);
    expect(r.ok && [r.config.min, r.config.max]).toEqual([3, 3]);
  });
  it('a question in a group keeps its own configuration (options, file formats, link hint)', () => {
    const r = parseGroupConfig({ subFields: [
      { kind: 'single_choice', label: 'Role', options: [{ label: 'CEO' }, { label: 'CTO' }] },
      { kind: 'file', label: 'CV', validations: { fileFormats: ['word'], maxFiles: 3 } },
      { kind: 'url', label: 'LinkedIn', validations: { urlHint: 'website' } },
    ] });
    expect(r.ok && r.config.subFields[0].options.map((o) => o.label)).toEqual(['CEO', 'CTO']);
    expect(r.ok && r.config.subFields[1].validations).toMatchObject({ fileFormats: ['word'], maxFiles: 3 });
    expect(r.ok && r.config.subFields[2].validations).toEqual({ urlHint: 'website' });
  });
});

describe('the form the server accepts', () => {
  it('keeps the new kinds with their configuration, and the old ones as they were', () => {
    const g = group({ subFields: [sub(1, 'short_text', { label: 'Name', required: true }), sub(2, 'email', { label: 'Email' })], min: 1 });
    const parsed = parseFieldsPayload([field('url', { id: 'link-field-001', label: 'Video', validations: { urlHint: 'video' } }), g, field('file', { id: 'file-field-0001', label: 'Others', validations: { maxFiles: 4, fileFormats: ['pdf', 'word'], maxFileMb: 5 } }), field('short_text', { id: 'old-field-0001', label: 'Name' })]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const byId = new Map(parsed.fields.map((f) => [f.id, f]));
    expect(byId.get('link-field-001')!.validations).toEqual({ urlHint: 'video' });
    expect(byId.get('group-team-1')!.validations.group).toMatchObject({ entryLabel: 'Team member', min: 1, max: 5 });
    expect(byId.get('file-field-0001')!.validations).toEqual({ maxFileMb: 5, fileFormats: ['pdf', 'word'], maxFiles: 4 });
    expect(byId.get('old-field-0001')!.validations).toEqual({});
  });
  it('refuses an unknown kind, a group without its configuration, and a display condition that depends on a group', () => {
    expect(parseFieldsPayload([{ ...field('short_text'), kind: 'video' }])).toMatchObject({ ok: false });
    expect(parseFieldsPayload([{ ...group({ subFields: [sub(1, 'short_text')] }), validations: {} }])).toMatchObject({ ok: false, error: expect.stringContaining('group') });
    const g = group({ subFields: [sub(1, 'short_text')] }, { position: 0 });
    const dep = field('short_text', { id: 'dependent-0001', position: 1, condition: { fieldId: g.id, operator: 'is_answered', value: null } });
    expect(parseFieldsPayload([g, dep])).toEqual({ ok: false, error: '“Untitled question” cannot depend on a repeatable group.' });
  });
  it('a new group starts with one question and a usable configuration; changing the kind away resets it', () => {
    const g = newField('group', 1, 0);
    expect(g.validations.group?.subFields).toHaveLength(1);
    expect(g.validations.group?.display).toBe('cards');
    expect(newField('url').validations).toEqual({});
    expect(fileQuestions([g, newField('file', 1, 1)])).toHaveLength(1);
  });
});

describe('a group — answering and validating', () => {
  const team = group({ min: 1, max: 3, subFields: [sub(1, 'short_text', { label: 'Name', required: true }), sub(2, 'email', { label: 'Email', required: true }), sub(3, 'file', { label: 'CV', validations: { maxFileMb: 5 } })] }, { required: true });
  const entry = (id: string, values: Record<string, unknown>) => ({ id, values: values as never });

  it('counts the entries: at least the minimum, at most the maximum', () => {
    expect(validateAnswer(team, [])).toBe('Add at least one team member.');
    expect(validateAnswer(team, undefined)).toBe('Add at least one team member.');
    const ok = (n: number) => Array.from({ length: n }, (_, i) => entry(`entry-${i + 1}`, { [U(1)]: 'Ana', [U(2)]: 'ana@example.pt' }));
    expect(validateAnswer(team, ok(1))).toBeNull();
    expect(validateAnswer(team, ok(4))).toBe('At most 3 entries (team member).');
    expect(groupMin(team, team.validations.group!)).toBe(1);
    // an optional group with no minimum may be left empty; a required one needs one entry
    const optional = group({ min: 0, subFields: [sub(1, 'short_text', { required: true })] });
    expect(validateAnswer(optional, undefined)).toBeNull();
    expect(validateAnswer({ ...optional, required: true }, [])).toBe('Add at least one team member.');
  });
  it('every entry validates its own required questions, and says which entry and which question', () => {
    const answer = [entry('entry-1', { [U(1)]: 'Ana', [U(2)]: 'ana@example.pt' }), entry('entry-2', { [U(1)]: 'Bruno' })];
    expect(validateAnswer(team, answer)).toBe('Team member 2 — Email: This answer is required.');
    expect(groupErrors(team, answer)).toEqual({ ['entry-2/' + U(2)]: 'This answer is required.' });
    expect(validateAnswer(team, [entry('entry-1', { [U(1)]: 'Ana', [U(2)]: 'not-an-email' })])).toBe('Team member 1 — Email: Enter a valid email address.');
    expect(validateAnswer(team, [entry('entry-1', { [U(1)]: 'Ana', [U(2)]: 'ana@example.pt', [U(3)]: fv('cv.docx') })])).toBe('Team member 1 — CV: “cv.docx” is not an accepted file type. This question accepts PDF files (.pdf).');
  });
  it('a group is answered when an entry holds something; a group with only empty entries is not', () => {
    expect(isAnswered([entry('e1', { [U(1)]: 'Ana' })])).toBe(true);
    expect(isAnswered([entry('e1', {})])).toBe(false);
  });
  it('the final check names the group and the page it is on', () => {
    const issues = finalCheck([team], { [team.id]: [entry('entry-1', { [U(1)]: 'Ana' })] });
    expect(issues).toMatchObject([{ fieldId: team.id, label: 'Team', message: 'Team member 1 — Email: This answer is required.' }]);
    expect(validateAnswers([team], {})).toEqual({ [team.id]: 'Add at least one team member.' });
  });
  it('a question inside a group is validated with the very same rules as one in the form', () => {
    const s = subFieldAsField(sub(1, 'number', { validations: { currency: true } }));
    expect(validateAnswer(s, '12a')).toBe('Digits only, please.');
    expect(validateAnswer(subFieldAsField(sub(2, 'url')), 'ftp://x.com')).toMatch(/http/);
  });
});

describe('what the server keeps of the answers (sanitising)', () => {
  const FILES: FileRef[] = [
    { id: 'file-a', fieldId: U(3), entryId: 'entry-1', source: 'upload', fileName: 'cv-ana.pdf', size: 100 },
    { id: 'file-b', fieldId: U(3), entryId: 'entry-2', source: 'upload', fileName: 'cv-bruno.pdf', size: 200 },
    { id: 'file-deck', fieldId: 'file-field-0001', source: 'upload', fileName: 'deck.pdf', size: 300 },
    { id: 'file-extra', fieldId: 'file-field-0001', source: 'upload', fileName: 'extra.docx', size: 400 },
  ];
  const team = group({ min: 0, max: 2, subFields: [sub(1, 'short_text', { label: 'Name' }), sub(2, 'email', { label: 'Email' }), sub(3, 'file', { label: 'CV' }), sub(4, 'single_choice', { options: [{ id: 'opt_ceo00001', label: 'CEO' }, { id: 'opt_cto00001', label: 'CTO' }] })] });
  const several = field('file', { id: 'file-field-0001', validations: { maxFiles: 2, fileFormats: ['pdf', 'word'] } });
  const link = field('url', { id: 'link-field-0001' });

  it('a link and an email are kept as typed (a half-typed one survives the autosave); the final check is what refuses a wrong one', () => {
    const out = sanitizeAnswers([link, field('email', { id: 'mail-field-0001' })], { [link.id]: 'https://youtu', 'mail-field-0001': 'ana@exa' });
    expect(out).toEqual({ [link.id]: 'https://youtu', 'mail-field-0001': 'ana@exa' });
    expect(sanitizeAnswers([link], { [link.id]: 42 })).toEqual({});
    expect(sanitizeAnswers([link], { [link.id]: 'h'.repeat(5000) })[link.id]).toHaveLength(2000);
  });
  it('files are rebuilt from what the SERVER registered for the question: several in a list, one as a single answer, never a stranger\'s id', () => {
    const out = sanitizeAnswers([several, field('file', { id: 'file-single-0001' })], {
      [several.id]: [{ fileId: 'file-deck', fileName: 'FORGED.pdf', size: 1 }, { fileId: 'file-extra' }, { fileId: 'file-a' }, { fileId: 'nonexistent' }, { fileId: 'file-deck' }],
      'file-single-0001': { fileId: 'file-deck' },
    }, FILES);
    expect(out[several.id]).toMatchObject([{ fileName: 'deck.pdf', size: 300, fileId: 'file-deck', mime: 'application/pdf' }, { fileName: 'extra.docx', fileId: 'file-extra', mime: expect.stringContaining('wordprocessingml') }]);
    expect(out['file-single-0001']).toBeUndefined();                                          // "file-deck" belongs to another question
    expect(sanitizeAnswers([several], { [several.id]: [{ fileId: 'file-deck' }, { fileId: 'file-extra' }, { fileId: 'file-deck' }] }, FILES)[several.id]).toHaveLength(2);
  });
  it('a group is a list of entries, each coerced question by question; at most the maximum; an entry kept even while empty', () => {
    const out = sanitizeAnswers([team], { [team.id]: [
      { id: 'entry-1', values: { [U(1)]: 'Ana', [U(2)]: 'ana@example.pt', [U(3)]: { fileId: 'file-a' }, [U(4)]: 'opt_ceo00001', 'unknown-q': 'x' } },
      { id: 'entry-2', values: { [U(4)]: 'not-an-option', [U(3)]: { fileId: 'file-a' } } },
      { id: 'entry-3', values: { [U(1)]: 'dropped: above the maximum' } },
    ] }, FILES);
    const entries = entriesOf(out[team.id]);
    expect(entries.map((e) => e.id)).toEqual(['entry-1', 'entry-2']);
    expect(entries[0].values).toMatchObject({ [U(1)]: 'Ana', [U(2)]: 'ana@example.pt', [U(4)]: 'opt_ceo00001', [U(3)]: { fileId: 'file-a', fileName: 'cv-ana.pdf' } });
    expect(Object.keys(entries[0].values)).not.toContain('unknown-q');
    expect(entries[1].values[U(4)]).toBeUndefined();
    expect(entries[1].values[U(3)]).toMatchObject({ fileId: 'file-a' });                          // the registered file of THIS question
    expect(sanitizeAnswers([team], { [team.id]: 'nope' })).toEqual({});
    expect(sanitizeAnswers([team], { [team.id]: [] })).toEqual({});
  });
  it('pre-defined rows are the entity\'s: exactly those rows, their first columns whatever the browser sent', () => {
    const table = group({ display: 'table', presetRows: [['Your company'], ['Competitor 1']], min: 2, max: 2, subFields: [sub(1, 'short_text', { label: 'Name' }), sub(2, 'long_text', { label: 'Strengths' })] });
    const out = sanitizeAnswers([table], { [table.id]: [{ id: 'x1', values: { [U(1)]: 'HACKED', [U(2)]: 'ours' } }, { id: 'x2', values: { [U(2)]: 'theirs' } }, { id: 'x3', values: { [U(2)]: 'a third row' } }] });
    const rows = entriesOf(out[table.id]);
    expect(rows.map((r) => r.id)).toEqual(['row1', 'row2']);
    expect(rows.map((r) => r.values[U(1)])).toEqual(['Your company', 'Competitor 1']);
    expect(rows.map((r) => r.values[U(2)])).toEqual(['ours', 'theirs']);
    // and before anything was typed the rows are there to be filled
    const initial = withPresetRows([table], {});
    expect(entriesOf(initial[table.id]).map((r) => r.values[U(1)])).toEqual(['Your company', 'Competitor 1']);
  });
});

describe('putting a file into the answers, and taking it out', () => {
  const team = group({ min: 0, max: 3, subFields: [sub(1, 'short_text'), sub(3, 'file')] });
  const several = field('file', { id: 'file-field-0001', validations: { maxFiles: 3 } });
  const single = field('file', { id: 'file-single-0001' });
  const fields = [several, single, team];
  const target = { questionId: U(3), groupId: team.id, entryId: 'entry-2' };

  it('one file replaces the old; several are added (the same file twice is one)', () => {
    let a = setFileInAnswers(fields, {}, { questionId: single.id }, { ...fv('a.pdf'), fileId: 'f1' });
    a = setFileInAnswers(fields, a, { questionId: single.id }, { ...fv('b.pdf'), fileId: 'f2' });
    expect(a[single.id]).toMatchObject({ fileId: 'f2' });
    let b = setFileInAnswers(fields, {}, { questionId: several.id }, { ...fv('a.pdf'), fileId: 'f1' });
    b = setFileInAnswers(fields, b, { questionId: several.id }, { ...fv('b.pdf'), fileId: 'f2' });
    b = setFileInAnswers(fields, b, { questionId: several.id }, { ...fv('a2.pdf'), fileId: 'f1' });
    expect(b[several.id]).toMatchObject([{ fileId: 'f2' }, { fileId: 'f1', fileName: 'a2.pdf' }]);
    expect(maxFilesForTarget(fields, { questionId: several.id })).toBe(3);
    expect(maxFilesForTarget(fields, target)).toBe(1);
  });
  it('a file lands in ITS entry of a group and nowhere else', () => {
    const base = { [team.id]: [newEntry(), { id: 'entry-2', values: {} }] };
    const a = setFileInAnswers(fields, base, target, { ...fv('cv.pdf'), fileId: 'f9' });
    const entries = entriesOf(a[team.id]);
    expect(entries[0].values[U(3)]).toBeUndefined();
    expect(entries[1].values[U(3)]).toMatchObject({ fileId: 'f9' });
    expect(locateFile(fields, a, 'f9')).toEqual(target);
    expect(fileIdsInAnswers(fields, a)).toEqual(['f9']);
  });
  it('removing a file takes it out wherever it is — a question, a list, an entry — and touches nothing else', () => {
    let a = setFileInAnswers(fields, {}, { questionId: several.id }, { ...fv('a.pdf'), fileId: 'f1' });
    a = setFileInAnswers(fields, a, { questionId: several.id }, { ...fv('b.pdf'), fileId: 'f2' });
    a = setFileInAnswers(fields, { ...a, [team.id]: [{ id: 'entry-2', values: { [U(1)]: 'Ana' } }] }, target, { ...fv('cv.pdf'), fileId: 'f9' });
    const r1 = removeFileFromAnswers(fields, a, 'f1');
    expect(r1.changed).toBe(true);
    expect(r1.answers[several.id]).toMatchObject([{ fileId: 'f2' }]);
    const r2 = removeFileFromAnswers(fields, r1.answers, 'f2');
    expect(r2.answers[several.id]).toBeUndefined();
    const r3 = removeFileFromAnswers(fields, a, 'f9');
    expect(entriesOf(r3.answers[team.id])[0].values).toEqual({ [U(1)]: 'Ana' });                       // the entry stays, minus its file
    expect(removeFileFromAnswers(fields, a, 'nothing').changed).toBe(false);
  });
});

describe('submitting', () => {
  const team = group({ min: 1, max: 3, subFields: [sub(1, 'short_text', { required: true }), sub(3, 'file')] }, { required: true });
  it('the submission carries every file the answers point at — in questions, in lists and inside entries — and no other', () => {
    const several = field('file', { id: 'file-field-0001', validations: { maxFiles: 3 } });
    const files: FileRef[] = ['f1', 'f2', 'f9', 'orphan'].map((id) => ({ id, fieldId: 'x', source: 'upload' as const, fileName: `${id}.pdf`, size: 1 }));
    const answers = {
      [several.id]: [fv('a.pdf', 1, 'f1'), fv('b.pdf', 1, 'f2')],
      [team.id]: [{ id: 'entry-1', values: { [U(1)]: 'Ana', [U(3)]: fv('cv.pdf', 1, 'f9') } }],
    } as never;
    const r = planSubmission([several, team], answers, files);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.files.map((f) => f.id).sort()).toEqual(['f1', 'f2', 'f9']);
  });
  it('a missing entry or a missing required question in an entry blocks it, with the question named', () => {
    expect(planSubmission([team], {}, [])).toMatchObject({ ok: false, failures: [{ fieldId: team.id, message: 'Add at least one team member.' }] });
    expect(planSubmission([team], { [team.id]: [{ id: 'entry-1', values: {} }] } as never, [])).toMatchObject({ ok: false, failures: [{ message: 'Team member 1 — Q1: This answer is required.' }] });
  });
  it('the frozen copy keeps the extension of the file (a Word file is not turned into a PDF)', () => {
    expect(frozenPath('c1', 'a1', 'f1', 'CV Ana.DOCX')).toBe('calls/c1/applications/a1/frozen/f1.docx');
    expect(frozenPath('c1', 'a1', 'f1', 'deck.pdf')).toBe('calls/c1/applications/a1/frozen/f1.pdf');
    expect(frozenPath('c1', 'a1', 'f1')).toBe('calls/c1/applications/a1/frozen/f1.pdf');
  });
});
