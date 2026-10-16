// Prompt 917 (I2) — the proposal now carries every kind of question the form has (link, email, files with formats, repeatable groups, conditions), whoever made the item.
// What is checked: the sanitiser keeps only what applies to each kind, a condition survives only if it points at an EARLIER yes/no (by id or by the document's number),
// a choice with no options and a group that does not parse become short text with a warning, and what is accepted becomes form fields the editor itself would accept.
import { describe, expect, it } from 'vitest';
import { fieldItemsToFormFields, sanitizeFieldItems, sanitizeProposal, type ProposalFieldItem } from './proposal';
import { AI_FIELD_KINDS, FIELD_KINDS } from '../types';
import { parseFieldsPayload } from '../form-builder';
import { dedupeAttention, dedupeFields, numberOf } from './dedupe';
import { conditionLine, configLines, metaLine, sourceLabel } from './review-view';

const clean = (raw: unknown, source?: 'internal' | 'ai') => sanitizeFieldItems(raw, { paged: false, source });

describe('every kind the form has can be proposed', () => {
  it('the AI is offered all of them', () => { expect([...AI_FIELD_KINDS]).toEqual([...FIELD_KINDS]); });

  it('a link keeps its hint, an email nothing, a number its currency; settings of another kind are dropped', () => {
    const r = clean([
      { label: 'Video', kind: 'url', url_hint: 'video', file_formats: ['pdf'], currency: true },
      { label: 'Mail', kind: 'email', max_files: 4 },
      { label: 'Amount', kind: 'number', currency: true, url_hint: 'video' },
    ]);
    expect(r.fields.map((f) => [f.kind, f.validations])).toEqual([['url', { urlHint: 'video' }], ['email', undefined], ['number', { currency: true }]]);
  });

  it('a file keeps its formats and how many files it takes; the formats are the product\'s own names', () => {
    const r = clean([{ label: 'Deck', kind: 'file', file_formats: ['powerpoint', 'nonsense'], max_files: 3, expected_document_type: 'Pitch deck' }]);
    expect(r.fields[0].validations).toMatchObject({ fileFormats: ['powerpoint'], maxFiles: 3 });
    expect(r.fields[0].expectedType).toBe('Pitch deck');
  });

  it('a group is read as the editor reads it; one that does not parse becomes short text and says so', () => {
    const good = clean([{ label: 'Team', kind: 'group', group: { entry_label: 'Team member', min: 1, max: 5, display: 'cards', sub_fields: [{ label: 'Name', kind: 'short_text' }, { label: 'CV', kind: 'file', file_formats: ['pdf'] }] } }]);
    expect(good.fields[0].group).toMatchObject({ entryLabel: 'Team member', min: 1, max: 5, display: 'cards' });
    expect(good.fields[0].group?.subFields.map((s) => s.kind)).toEqual(['short_text', 'file']);
    const bad = clean([{ label: 'Team', kind: 'group', group: { entry_label: 'x', sub_fields: [] } }]);
    expect(bad.fields[0].kind).toBe('short_text');
    expect(bad.attention[0]).toMatchObject({ kind: 'not_covered', what: '“Team”' });
  });

  it('a table group keeps its fixed rows', () => {
    const r = clean([{ label: 'Competitors', kind: 'group', group: { entry_label: 'Company', min: 3, max: 3, display: 'table', preset_rows: [['Us'], ['A'], ['B']], sub_fields: [{ label: 'Company', kind: 'short_text' }, { label: 'Price', kind: 'number' }] } }]);
    expect(r.fields[0].group).toMatchObject({ display: 'table', presetRows: [['Us'], ['A'], ['B']] });
  });

  it('a choice without two options is short text, with the reason; a kind nobody knows is short text, with the reason', () => {
    const r = clean([{ label: 'Sector', kind: 'single_choice', options: ['Only one'] }, { label: 'Odd', kind: 'hologram' }]);
    expect(r.fields.map((f) => f.kind)).toEqual(['short_text', 'short_text']);
    expect(r.attention).toHaveLength(2);
  });
});

describe('conditions', () => {
  const base = [
    { tmpId: 'a', label: '1.3 Incubated?', kind: 'yes_no', number: '1.3' },
    { tmpId: 'b', label: '1.3.1 Which?', kind: 'short_text', number: '1.3.1', condition: { tmpId: 'a', value: 'yes' } },
    { tmpId: 'c', label: '1.4 Amount', kind: 'number', number: '1.4', condition: { depends_on_number: '1.3', value: 'no' } },
  ];
  it('by tmpId (the platform) or by the number the document gave (the AI): both point at the earlier yes/no', () => {
    const r = clean(base);
    expect(r.fields[1].condition).toEqual({ tmpId: 'a', value: 'yes' });
    expect(r.fields[2].condition).toEqual({ tmpId: 'a', value: 'no' });
  });
  it('a condition on a question that comes LATER, or is not a yes/no, or does not exist, is dropped (the editor would refuse it)', () => {
    const r = clean([
      { tmpId: 'x', label: 'Before', kind: 'short_text', condition: { tmpId: 'y', value: 'yes' } },
      { tmpId: 'y', label: 'Later yes/no', kind: 'yes_no' },
      { tmpId: 'z', label: 'On text', kind: 'short_text', condition: { tmpId: 'x', value: 'yes' } },
      { tmpId: 'w', label: 'On nothing', kind: 'short_text', condition: { depends_on_number: '9.9', value: 'yes' } },
    ]);
    expect(r.fields.map((f) => f.condition ?? null)).toEqual([null, null, null, null]);
  });
  it('accepted, the condition points at the NEW id of its controller; if the controller was not accepted it is dropped', () => {
    const items = clean(base).fields;
    let n = 0; const mk = () => `id${++n}`;
    const all = fieldItemsToFormFields(items, 0, mk);
    expect(all[1].condition).toEqual({ fieldId: all[0].id, operator: 'equals', value: 'yes' });
    const without = fieldItemsToFormFields(items.slice(1), 0, mk);
    expect(without.every((f) => f.condition === null)).toBe(true);
  });
  it('what comes out is a form the editor accepts: conditions, a group, a link and a file with formats included', () => {
    const items = clean([
      ...base,
      { tmpId: 'g', label: 'Team', kind: 'group', group: { entry_label: 'Member', min: 1, max: 4, display: 'cards', sub_fields: [{ label: 'Name', kind: 'short_text' }, { label: 'CV', kind: 'file', file_formats: ['pdf'] }] } },
      { tmpId: 'u', label: 'Video', kind: 'url', url_hint: 'video' },
      { tmpId: 'f', label: 'Deck', kind: 'file', file_formats: ['powerpoint'], max_files: 2 },
    ]).fields;
    const parsed = parseFieldsPayload(fieldItemsToFormFields(items, 0));
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
  });
  it('the group is copied, never shared with the proposal', () => {
    const items = clean([{ label: 'Team', kind: 'group', group: { entry_label: 'Member', min: 0, max: 3, display: 'cards', sub_fields: [{ label: 'Name', kind: 'short_text' }] } }]).fields;
    const f = fieldItemsToFormFields(items, 0)[0];
    (f.validations.group as { entryLabel: string }).entryLabel = 'changed';
    expect(items[0].group?.entryLabel).toBe('Member');
  });
});

describe('who made the item', () => {
  it('the AI\'s own answer is marked as the AI\'s; the platform\'s is marked as the platform\'s; a mark on the item itself wins', () => {
    const p = sanitizeProposal({ form_pages: [{ fields: [{ label: 'From the AI', kind: 'short_text' }] }] });
    expect(p.fields[0].source).toBe('ai');
    const r = clean([{ label: 'A', kind: 'short_text' }, { label: 'B', kind: 'short_text', source: 'ai' }], 'internal');
    expect(r.fields.map((f) => f.source)).toEqual(['internal', 'ai']);
  });
  it('the review says it discreetly, in words', () => {
    expect(sourceLabel('internal')).toBe('read by our platform');
    expect(sourceLabel('ai')).toBe('completed by our AI provider');
    expect(sourceLabel(undefined)).toBeNull();
  });
});

describe('attention: a model may say "done" and the screen separates it from what needs the person', () => {
  it('"done" survives the sanitiser as its own kind', () => {
    const p = sanitizeProposal({ needs_attention: [{ kind: 'done', what: '6.5 asked for 4 documents', why: 'split into 4 file questions' }, { kind: 'not_covered', what: 'A budget table' }] });
    expect(p.attention.map((a) => a.kind)).toEqual(['done', 'not_covered']);
  });
});

describe('no repetitions', () => {
  it('the number a warning is about is read from its start, with the quotes the sanitiser puts, and a follow-up counts as its question', () => {
    expect(numberOf('6.5 asked for 4 documents')).toBe('6.5');
    expect(numberOf('“2.10.2” in the label')).toBe('2.10.2');
    expect(numberOf('4.4/2 became a number')).toBe('4.4');
    expect(numberOf('Competitive Detailed Analysis')).toBeNull();
    expect(numberOf('2024 edition')).toBe('2024');
  });
  it('one warning per question number: the stronger kind wins (not covered > out of date > done) and the first of equals stays', () => {
    const out = dedupeAttention([
      { kind: 'done', what: '6.5 asked for 4 documents', why: 'split' },
      { kind: 'outdated', what: '6.5 mentions 2024', why: '' },
      { kind: 'not_covered', what: '6.5 has a table', why: 'by hand' },
      { kind: 'done', what: '6.4 became a group', why: '' },
      { kind: 'done', what: '6.4.1 something', why: '' },
    ]);
    expect(out.map((a) => [a.kind, numberOf(a.what)])).toEqual([['not_covered', '6.5'], ['done', '6.4'], ['done', '6.4.1']]);
  });
  it('the same text without a number is said once', () => {
    expect(dedupeAttention([{ kind: 'not_covered', what: 'A budget table', why: '' }, { kind: 'not_covered', what: 'a budget  table', why: 'x' }])).toHaveLength(1);
  });
  const item = (over: Partial<ProposalFieldItem>): ProposalFieldItem => ({ tmpId: over.tmpId ?? 't', page: 1, kind: 'short_text', label: 'L', instruction: null, required: true, options: [], expectedType: null, maxAgeMonths: null, ...over });
  it('a question is never twice: the same number is the same question; with no number, the same text and kind; a follow-up of the same number is its own', () => {
    const d = dedupeFields([
      item({ tmpId: 'a', number: '6.3', label: '6.3 Video' }), item({ tmpId: 'b', number: '6.3', label: '6.3 Video link', kind: 'url' }),
      item({ tmpId: 'c', label: 'Name' }), item({ tmpId: 'd', label: 'name' }), item({ tmpId: 'e', label: 'Name', kind: 'email' }),
      item({ tmpId: 'f', number: '4.4', kind: 'yes_no' }), item({ tmpId: 'g', number: '4.4/2', kind: 'number', condition: { tmpId: 'f', value: 'yes' } }),
    ]);
    expect(d.fields.map((f) => f.tmpId)).toEqual(['a', 'c', 'e', 'f', 'g']);
    expect(d.removed).toEqual(['6.3', 'name']);
    // the number may be only in the label (the AI writes it there): "1.2 Morada" is the platform's 1.2
    expect(dedupeFields([item({ tmpId: 'p', number: '1.2', label: '1.2 Morada' }), item({ tmpId: 'q', label: '1.2 Morada' }), item({ tmpId: 'r', label: '2024 edition' })]).fields.map((f) => f.tmpId)).toEqual(['p', 'r']);
  });
  it('a condition that pointed at a removed duplicate is dropped, not left dangling', () => {
    const d = dedupeFields([item({ tmpId: 'a', number: '1', kind: 'yes_no' }), item({ tmpId: 'b', number: '1', kind: 'yes_no' }), item({ tmpId: 'c', number: '2', condition: { tmpId: 'b', value: 'yes' } })]);
    expect(d.fields.find((f) => f.tmpId === 'c')?.condition).toBeNull();
  });
});

describe('what the review shows under a question', () => {
  const group = clean([{ label: 'Team', kind: 'group', group: { entry_label: 'Member', min: 1, max: 4, display: 'cards', sub_fields: [{ label: 'Name', kind: 'short_text' }, { label: 'CV', kind: 'file' }] } }]).fields[0];
  it('a file, a link, a number and a group are described in words', () => {
    const f = clean([{ label: 'Deck', kind: 'file', file_formats: ['powerpoint'], max_files: 2 }, { label: 'V', kind: 'url', url_hint: 'video' }, { label: 'W', kind: 'url' }, { label: 'Eur', kind: 'number', currency: true }]).fields;
    expect(configLines(f[0])[0]).toMatch(/PowerPoint.*up to 2 files/);
    expect(configLines(f[1])[0]).toMatch(/^A link to a video/);
    expect(configLines(f[2])).toEqual(['A link (https://)']);
    expect(configLines(f[3])).toEqual(['Shown with the call’s currency']);
    expect(configLines(group)[0]).toContain('Repeatable group “Member”: 2 questions (Name, CV)');
    expect(configLines(group)[1]).toBe('Shown as cards, 1 to 4 entries');
  });
  it('a condition says which question it depends on, by number when the document has one', () => {
    const [a, b] = clean([{ tmpId: 'a', label: 'Incubated?', kind: 'yes_no', number: '1.3' }, { tmpId: 'b', label: 'Which?', kind: 'short_text', condition: { tmpId: 'a', value: 'yes' } }]).fields;
    expect(conditionLine(b, [a, b])).toBe('Shown only if question 1.3 is Yes');
    expect(conditionLine(a, [a, b])).toBeNull();
  });
  it('the top line says who read the form, how well, and what went to the provider', () => {
    expect(metaLine({ mode: 'internal', coverage: 1, typeConfidence: 0.96, aiSections: [] })).toBe('Read by our platform alone (100% of the numbered items read, 96% of the question types recognised). Nothing was sent to the AI provider.');
    expect(metaLine({ mode: 'internal+ai', coverage: 0.97, typeConfidence: 0.9, aiSections: ['page 6: Template'] })).toContain('only one part went to our AI provider: page 6: Template');
    expect(metaLine({ mode: 'ai', coverage: null, typeConfidence: null, aiSections: [] })).toContain('Read by our AI provider');
    expect(metaLine({ mode: null, coverage: null, typeConfidence: null, aiSections: [] })).toBeNull();
    expect(metaLine(null)).toBeNull();
  });
});
