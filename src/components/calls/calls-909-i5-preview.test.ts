// Prompt 909 (I5) — free preview, test mode, "Validate form and settings".
// The behaviours that need a browser (typing, clicking Next) are expressed through the PURE functions the components call
// (src/lib/calls/preview-logic.ts), so the rules are proven here by their exit codes; the components are rendered to
// markup, and the one thing a component test cannot see — that test mode never talks to the server — is asserted on the
// component's source.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { conditionNote, finalCheck, previewPages, testStep, validationHints } from '@/lib/calls/preview-logic';
import { availableActions, confirmCall, publishCall } from '@/lib/calls/lifecycle';
import { CALL_STATUS_LABELS, type Call, type FormField } from '@/lib/calls/types';
import { FormPreview } from './FormPreview';
import { FormTest } from './FormTest';
import { PreviewTab } from './PreviewTab';

const noop = () => {};
const field = (over: Partial<FormField> & Pick<FormField, 'id' | 'kind'>): FormField => ({
  page: 1, position: 0, label: 'Q', instruction: null, required: false, options: [], validations: {}, condition: null,
  platformMapping: null, expectedType: null, maxAgeMonths: null, ...over,
});
const yn = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];
const call = (over: Partial<Call> = {}): Call => ({
  id: 'c1', promoterKind: 'incubator', promoterId: 'i1', name: 'Seed Call', description: null, opensAt: '2027-02-01T09:00:00.000Z',
  closesAt: '2027-03-31T16:00:00.000Z', timezone: 'Europe/Lisbon', visibility: 'listed', limitUnit: 'project', allowMultiple: false,
  contentLanguage: 'en', currency: 'EUR', status: 'draft', linkToken: null, configVersion: 1, validatedAt: null, publishedAt: null, closedAt: null, archivedAt: null,
  duplicatedFrom: null, createdBy: 'u', createdAt: '', updatedAt: '', ...over,
});

// A three-page form: page 1 has a required name and a Yes/No; page 2 has a question shown only on "Yes" (required);
// page 3 has an optional note.
const FORM: FormField[] = [
  field({ id: 'name', kind: 'short_text', label: 'Startup name', required: true, page: 1, position: 0 }),
  field({ id: 'inc', kind: 'yes_no', label: 'Incorporated?', options: yn, required: true, page: 1, position: 1 }),
  field({ id: 'when', kind: 'date', label: 'Incorporation date', required: true, page: 2, position: 0, condition: { fieldId: 'inc', operator: 'equals', value: 'yes' } }),
  field({ id: 'other', kind: 'short_text', label: 'Anything else', page: 2, position: 1 }),
  field({ id: 'note', kind: 'long_text', label: 'Note', page: 3, position: 0, validations: { maxWords: 50 } }),
];

describe('I5 — the free preview', () => {
  it('reaches every page and every question without answering anything, conditional ones included', () => {
    const pages = previewPages(FORM, false, {});
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(pages[1].fields.map((f) => f.id)).toEqual(['when', 'other']); // "when" is hidden for an applicant, here it is not
    expect(previewPages(FORM, false, {}).flatMap((p) => p.fields)).toHaveLength(FORM.length);
  });
  it('the switch applies the conditions to what is answered', () => {
    expect(previewPages(FORM, true, {})[1].fields.map((f) => f.id)).toEqual(['other']);
    expect(previewPages(FORM, true, { inc: 'yes' })[1].fields.map((f) => f.id)).toEqual(['when', 'other']);
  });
  it('the rendered preview shows required marked, the hints and the "Shown when" note, with a page jump', () => {
    const html = renderToStaticMarkup(createElement(FormPreview, { fields: FORM, currency: 'EUR', title: 'Seed Call' }));
    expect(html).toContain('Required');
    expect(html).toContain('aria-label="required"');
    expect(html).toContain('Yes or No'); // page 1 only; the conditional question is on page 2
    expect(html).toContain('data-testid="page-jump"');
    expect(html).toContain('Show as an applicant would see it');
    expect(html).not.toContain('role="alert"'); // nothing is validated here
  });
  it('Next is not blocked by an empty required question: it is enabled on page 1', () => {
    const html = renderToStaticMarkup(createElement(FormPreview, { fields: FORM, currency: 'EUR' }));
    const next = /<button[^>]*>Next<\/button>/.exec(html)?.[0] ?? '';
    expect(next).not.toBe('');
    expect(next).not.toMatch(/\sdisabled(=|\s|>)/);
  });
  it('hints say what the applicant will be asked', () => {
    expect(validationHints(field({ id: 'f', kind: 'file', validations: { maxFileMb: 10 }, required: true }))).toEqual(['Required', 'PDF only, max 10 MB']);
    expect(validationHints(FORM[4])).toEqual(['Up to 50 words']);
    expect(validationHints(field({ id: 'n', kind: 'number' }))[0]).toMatch(/^Digits only/);
    expect(validationHints(field({ id: 'p', kind: 'short_text', platformMapping: 'company_name' })).join(' ')).toMatch(/Pre-filled/);
  });
  it('a condition note names the controlling question and the answer, and survives a deleted controller', () => {
    expect(conditionNote(FORM[2], FORM)).toBe('Shown when “Incorporated?” = Yes');
    expect(conditionNote(FORM[0], FORM)).toBeNull();
    expect(conditionNote(FORM[2], FORM.filter((f) => f.id !== 'inc'))).toMatch(/deleted question/);
  });
});

describe('I5 — test mode enforces what the applicant meets', () => {
  it('Next is blocked while a required question on the page is empty, with the reason', () => {
    const step = testStep(FORM, {}, 0);
    expect(step.kind).toBe('blocked');
    if (step.kind === 'blocked') expect(Object.keys(step.errors).sort()).toEqual(['inc', 'name']);
  });
  it('it goes on once the page is complete, and the conditional question appears only on "Yes"', () => {
    expect(testStep(FORM, { name: 'Acme', inc: 'no' }, 0)).toEqual({ kind: 'next', index: 1 });
    // page 2 with "No": "when" is hidden, "other" is optional → can go on
    expect(testStep(FORM, { name: 'Acme', inc: 'no' }, 1)).toEqual({ kind: 'next', index: 2 });
    // with "Yes" the date becomes required and blocks
    const blocked = testStep(FORM, { name: 'Acme', inc: 'yes' }, 1);
    expect(blocked.kind).toBe('blocked');
    if (blocked.kind === 'blocked') expect(Object.keys(blocked.errors)).toEqual(['when']);
  });
  it('the last page leads to the final check, which lists what is missing with its page', () => {
    // the person answered everything, then went back and cleared the name
    const step = testStep(FORM, { name: '', inc: 'no' }, 2);
    expect(step.kind).toBe('final');
    if (step.kind === 'final') expect(step.issues).toEqual([expect.objectContaining({ fieldId: 'name', pageNumber: 1 })]);
    expect(finalCheck(FORM, { name: 'Acme', inc: 'no' })).toEqual([]);
    expect(finalCheck(FORM, { name: 'Acme', inc: 'yes' }).map((i) => [i.fieldId, i.pageNumber])).toEqual([['when', 2]]);
  });
  it('the rendered test shows the banner and a Next that is a real button', () => {
    const html = renderToStaticMarkup(createElement(FormTest, { fields: FORM, currency: 'EUR', title: 'Seed Call', onExit: noop }));
    expect(html).toContain('Test mode — nothing is saved or submitted');
    expect(html).toContain('data-testid="test-next"');
    expect(html).toContain('data-testid="exit-test"');
    expect(html).not.toContain('Shown when'); // test mode is the applicant's view, not the editor's
  });
  it('NOTHING leaves the browser: test mode has no network, storage or server call in it', () => {
    const src = readFileSync('src/components/calls/FormTest.tsx', 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/\bfetch\b|callsApi|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|FormData|document\.cookie/);
    expect(code).not.toMatch(/from '\.\/api'|from '@\/lib\/supabase/);
    const logic = readFileSync('src/lib/calls/preview-logic.ts', 'utf8');
    expect(logic).not.toMatch(/\bfetch\b|supabase|callsApi/);
  });
});

describe('I5 — "Validate form and settings"', () => {
  const issuesNone: never[] = [];
  const NOW = new Date('2026-10-12T12:00:00Z');
  const render = (c: Call, over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(PreviewTab, {
    call: c, effectiveStatus: c.status, phases: [], fields: FORM, issues: issuesNone, summary: { phases: 1, questions: 5, documents: 0, pages: 3, required: 3, mapped: 0, conditional: 1 } as never,
    actions: availableActions(c, issuesNone, NOW), canManage: true, busy: false, error: '', origin: 'https://www.sherlockdeal.com', onJump: noop, onAction: noop, ...over,
  }));

  it('a draft offers the new button and the sentence that validating does not publish', () => {
    const html = render(call());
    expect(html).toContain('Validate form and settings');
    expect(html).toContain('Validating locks the configuration. The call stays unpublished until you click Publish.');
    expect(html).not.toMatch(/>Confirm</);
  });
  it('the status reads "Validated · not published" and the call has no link, no schedule and is not open', () => {
    expect(CALL_STATUS_LABELS.validated).toBe('Validated · not published');
    const done = confirmCall(call(), [], 'u1', NOW);
    expect(done).toMatchObject({ ok: true, patch: { status: 'validated' } });
    if (!done.ok) return;
    expect(done.patch).not.toHaveProperty('link_token');
    expect(done.patch).not.toHaveProperty('published_at');
    const validated = call({ status: 'validated', validatedAt: NOW.toISOString() });
    const html = render(validated);
    expect(html).toContain('data-testid="validated-note"');
    expect(html).not.toContain('data-testid="call-link"');
    expect(availableActions(validated, issuesNone, NOW)).toMatchObject({ canPublish: true, canClose: false, canExtend: false });
    // only Publish gives the link
    expect(publishCall(validated, 'tok', NOW)).toMatchObject({ ok: true, patch: { link_token: 'tok' } });
  });
  it('"Test the form" is offered to whoever can manage, in any state, and not to a viewer', () => {
    for (const status of ['draft', 'validated', 'scheduled', 'open'] as const) {
      expect(render(call({ status }))).toContain('data-testid="test-form"');
    }
    expect(render(call(), { canManage: false })).not.toContain('data-testid="test-form"');
    expect(render(call(), { fields: [] })).not.toContain('data-testid="test-form"');
  });
});
