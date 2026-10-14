// Prompt 907 (I2, I3) — the pure rules of the applicant side: pre-filling without overwriting, what the server keeps of the answers, the unit
// of the per-call limit, the reference, and the final check of a submission.
import { describe, expect, it } from 'vitest';
import type { FormField } from '../types';
import { sanitizeAnswers, type FileRef } from './answers';
import { prefillAnswers, prefillValue, profileFromRows } from './profile';
import { newReference } from './reference';
import { frozenPath, planSubmission, formSnapshot } from './submit';
import { unitKey } from './unit';

const field = (over: Partial<FormField> & Pick<FormField, 'id' | 'kind'>): FormField => ({
  page: 1, position: 0, label: 'Q', instruction: null, required: false, options: [], validations: {}, condition: null,
  platformMapping: null, expectedType: null, maxAgeMonths: null, ...over,
});
const yn = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];

const PROFILE = profileFromRows(
  { name: 'Acme Robotics', country: 'Portugal', sector: 'Industrial automation', stage: 'pre_seed', website: 'https://acme.example' },
  { full_name: 'Ana Test', title: 'CEO' },
);

describe('the profile the form is pre-filled from', () => {
  it('is the startup\'s and the person\'s platform data — and nothing else (never a password)', () => {
    expect(PROFILE).toEqual({ company_name: 'Acme Robotics', country: 'Portugal', person_name: 'Ana Test', person_role: 'CEO', sector: 'Industrial automation', stage: 'pre_seed', website: 'https://acme.example' });
    expect(Object.keys(PROFILE).join(' ')).not.toMatch(/pass|secret|token/i);
    expect(profileFromRows(null, null).company_name).toBe('');
  });
});

describe('pre-filling (spec §6.4)', () => {
  const fields = [
    field({ id: 'name', kind: 'short_text', platformMapping: 'company_name' }),
    field({ id: 'who', kind: 'short_text', platformMapping: 'person_name' }),
    field({ id: 'role', kind: 'short_text', platformMapping: 'person_role' }),
    field({ id: 'country', kind: 'short_text', platformMapping: 'country' }),
    field({ id: 'stage', kind: 'single_choice', platformMapping: 'stage', options: [{ id: 'o1', label: 'Pre-seed' }, { id: 'o2', label: 'Seed' }] }),
    field({ id: 'sector', kind: 'single_choice', platformMapping: 'sector', options: [{ id: 's1', label: 'Fintech' }] }),
    field({ id: 'free', kind: 'long_text' }),
    field({ id: 'when', kind: 'date', platformMapping: 'website' }), // a mapping on a kind that cannot hold text: ignored
  ];

  it('fills every linked question from the profile, editable', () => {
    const out = prefillAnswers(fields, PROFILE);
    expect(out).toMatchObject({ name: 'Acme Robotics', who: 'Ana Test', role: 'CEO', country: 'Portugal' });
  });
  it('matches a choice by label or id without caring about case and punctuation ("pre_seed" -> "Pre-seed"); a datum that is not one of the options is left empty', () => {
    const out = prefillAnswers(fields, PROFILE);
    expect(out.stage).toBe('o1');
    expect(out.sector).toBeUndefined();
    expect(prefillValue(fields[4], { ...PROFILE, stage: 'SEED' })).toBe('o2');
  });
  it('never fills what is not linked, and ignores a link on a question that cannot hold text', () => {
    const out = prefillAnswers(fields, PROFILE);
    expect(out.free).toBeUndefined();
    expect(out.when).toBeUndefined();
  });
  it('NEVER overwrites an answer the applicant gave — not even an emptied one', () => {
    const edited = { name: 'Acme Robotics Lda', country: '' };
    const out = prefillAnswers(fields, PROFILE, edited);
    expect(out.name).toBe('Acme Robotics Lda');
    expect(out.country).toBe(''); // they cleared it on purpose
    expect(out.who).toBe('Ana Test'); // still unanswered: filled
    // Running it again after the profile changed changes nothing that already has an answer.
    const again = prefillAnswers(fields, { ...PROFILE, company_name: 'Changed Co', person_name: 'Someone Else' }, out);
    expect(again).toEqual(out);
  });
  it('an empty datum fills nothing', () => {
    expect(prefillAnswers(fields, profileFromRows({ name: '' }, {}))).toEqual({});
  });
});

describe('what the server keeps of the answers (the browser is not trusted)', () => {
  const FILES: FileRef[] = [{ id: 'file-1', fieldId: 'deck', source: 'upload', fileName: 'deck.pdf', size: 1234 }];
  const fields = [
    field({ id: 'name', kind: 'short_text' }),
    field({ id: 'amount', kind: 'number' }),
    field({ id: 'when', kind: 'date' }),
    field({ id: 'inc', kind: 'yes_no', options: yn }),
    field({ id: 'one', kind: 'single_choice', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }),
    field({ id: 'many', kind: 'multiple_choice', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }),
    field({ id: 'deck', kind: 'file' }),
  ];

  it('keeps only this call\'s questions, each coerced to its type', () => {
    const out = sanitizeAnswers(fields, {
      name: 'Acme', amount: '1,500.50 abc', when: '2026-02-30', inc: 'maybe', one: 'zzz', many: ['a', 'zzz', 'a'], injected: 'x', deck: { fileId: 'file-1' },
    }, FILES);
    expect(out).toEqual({ name: 'Acme', amount: '150050', many: ['a'], deck: { fileName: 'deck.pdf', size: 1234, mime: 'application/pdf', fileId: 'file-1', source: 'upload' } });
  });
  it('a file answer is rebuilt from the file the SERVER registered: a made-up name, size or id is dropped', () => {
    expect(sanitizeAnswers(fields, { deck: { fileName: 'evil.pdf', size: 1, fileId: 'not-mine' } }, FILES).deck).toBeUndefined();
    expect(sanitizeAnswers(fields, { deck: { fileName: 'evil.pdf', size: 999999, fileId: 'file-1' } }, FILES).deck).toMatchObject({ fileName: 'deck.pdf', size: 1234 });
    // A file registered for ANOTHER question cannot answer this one.
    expect(sanitizeAnswers([field({ id: 'other', kind: 'file' })], { other: { fileId: 'file-1' } }, FILES).other).toBeUndefined();
  });
  it('drops empty answers and non-object input; refuses an absurdly large payload', () => {
    // A cleared text keeps its (empty) key: it WAS edited, so the profile never fills it again. Other empty answers are dropped.
    expect(sanitizeAnswers(fields, { name: '', many: [], amount: '', inc: '' })).toEqual({ name: '' });
    expect(sanitizeAnswers(fields, null)).toEqual({});
    expect(sanitizeAnswers(fields, [1, 2])).toEqual({});
    const big = Array.from({ length: 60 }, (_, i) => field({ id: `t${i}`, kind: 'long_text' }));
    const raw = Object.fromEntries(big.map((f) => [f.id, 'x'.repeat(20_000)]));
    expect(() => sanitizeAnswers(big, raw)).toThrow(/too large/);
  });
});

describe('the unit of the limit per call (spec §5.1)', () => {
  it('"per project / startup" is the startup account', () => {
    expect(unitKey('project', { id: 'org-1', name: 'Acme' })).toBe('org:org-1');
  });
  it('"per legal entity" is the company: its legal name (or name) and country, compared without case, accents or punctuation', () => {
    const a = unitKey('legal_entity', { id: 'org-1', name: 'Acme', legal_name: 'ACME, Lda.', country: 'Portugal' });
    const b = unitKey('legal_entity', { id: 'org-2', name: 'Other brand', legal_name: 'acme lda', country: 'PORTUGAL' });
    expect(a).toBe(b);
    expect(unitKey('legal_entity', { id: 'org-3', name: 'Acme', legal_name: 'Acme Lda', country: 'Spain' })).not.toBe(a);
    expect(unitKey('legal_entity', { id: 'o', name: 'Açúcar Lda', country: 'PT' })).toBe(unitKey('legal_entity', { id: 'p', name: 'acucar lda', country: 'pt' }));
  });
  it('with nothing to compare by, the account itself — never lumping unrelated startups together', () => {
    expect(unitKey('legal_entity', { id: 'org-9' })).toBe('org:org-9');
  });
});

describe('the reference', () => {
  it('is short, readable aloud, without ambiguous characters', () => {
    for (let i = 0; i < 200; i++) expect(newReference()).toMatch(/^APP-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  });
});

describe('the final check of a submission (spec §14.2)', () => {
  const fields = [
    field({ id: 'name', kind: 'short_text', label: 'Startup name', required: true, page: 1, position: 0 }),
    field({ id: 'inc', kind: 'yes_no', label: 'Incorporated?', options: yn, required: true, page: 1, position: 1 }),
    field({ id: 'when', kind: 'date', label: 'Incorporation date', required: true, page: 2, position: 0, condition: { fieldId: 'inc', operator: 'equals', value: 'yes' } }),
    field({ id: 'deck', kind: 'file', label: 'Pitch deck', required: true, page: 2, position: 1 }),
    field({ id: 'note', kind: 'long_text', label: 'Note', page: 3, position: 0 }),
  ];
  const deck = { fileName: 'deck.pdf', size: 10, mime: 'application/pdf', fileId: 'f1', source: 'upload' as const };
  const FILES: FileRef[] = [{ id: 'f1', fieldId: 'deck', source: 'upload', fileName: 'deck.pdf', size: 10 }, { id: 'f2', fieldId: 'deck', source: 'upload', fileName: 'old.pdf', size: 5 }];

  it('lists each missing question with its page, counted among the pages the applicant sees', () => {
    const r = planSubmission(fields, { name: '', inc: 'no' }, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failures.map((f) => [f.label, f.pageNumber])).toEqual([['Startup name', 1], ['Pitch deck', 2]]); // the date is hidden by "No": it does not block
  });
  it('a required question that its condition hides never blocks, and its answer is not submitted', () => {
    const r = planSubmission(fields, { name: 'Acme', inc: 'no', when: '2020-01-01', deck }, FILES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.answers).toEqual({ name: 'Acme', inc: 'no', deck }); // "when" pruned
  });
  it('with the condition met the date IS required', () => {
    const r = planSubmission(fields, { name: 'Acme', inc: 'yes', deck }, FILES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.map((f) => f.label)).toEqual(['Incorporation date']);
  });
  it('only the files the submitted answers stand for belong to the submission (a replaced file is not part of it)', () => {
    const r = planSubmission(fields, { name: 'Acme', inc: 'no', deck }, FILES);
    expect(r.ok && r.plan.files.map((f) => f.id)).toEqual(['f1']);
  });
  it('a value that is wrong (a too-long text, say) blocks too', () => {
    const tight = [field({ id: 't', kind: 'short_text', label: 'Tagline', validations: { maxLength: 5 } })];
    const r = planSubmission(tight, { t: 'way too long' }, []);
    expect(r.ok).toBe(false);
  });
  it('the form snapshot keeps what the questions said, and the frozen path depends only on the file', () => {
    const snap = formSnapshot({ id: 'c1', name: 'Seed Call', configVersion: 3, currency: 'EUR', timezone: 'Europe/Lisbon' }, fields, new Date('2026-10-14T10:00:00Z'));
    expect(snap).toMatchObject({ callId: 'c1', callName: 'Seed Call', configVersion: 3, capturedAt: '2026-10-14T10:00:00.000Z' });
    expect(snap.fields.map((f) => f.label)).toEqual(['Startup name', 'Incorporated?', 'Incorporation date', 'Pitch deck', 'Note']);
    expect(frozenPath('c1', 'a1', 'f1')).toBe('calls/c1/applications/a1/frozen/f1.pdf');
    expect(frozenPath('c1', 'a1', 'f1')).toBe(frozenPath('c1', 'a1', 'f1'));
  });
});
