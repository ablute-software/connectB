// Prompt 905 — what the Calls components draw, rendered with react-dom/server (no DOM library in this repo; the
// behaviours that need a browser — typing, dragging, autosave timing — were checked live). Written as .ts.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FieldInput } from './FieldInput';
import { FormPreview } from './FormPreview';
import { GeneralTab } from './GeneralTab';
import { PhasesTab } from './PhasesTab';
import { PreviewTab, callLink } from './PreviewTab';
import { SaveStatus, saveStateText } from './SaveStatus';
import { StatusBadge } from './StatusBadge';
import { availableActions, readiness, summarise } from '@/lib/calls/lifecycle';
import { CALL_STATUS_LABELS, CALL_STATUSES, type Call, type FormField } from '@/lib/calls/types';

const noop = () => {};
const field = (over: Partial<FormField> & Pick<FormField, 'id' | 'kind'>): FormField => ({
  page: 1, position: 0, label: 'Q', instruction: null, required: false, options: [], validations: {}, condition: null,
  platformMapping: null, expectedType: null, maxAgeMonths: null, ...over,
});
const call = (over: Partial<Call> = {}): Call => ({
  id: 'c1', promoterKind: 'incubator', promoterId: 'i1', name: 'Seed Call', description: null, opensAt: '2027-02-01T09:00:00.000Z',
  closesAt: '2027-03-31T16:00:00.000Z', timezone: 'Europe/Lisbon', visibility: 'listed', limitUnit: 'project', allowMultiple: false,
  contentLanguage: 'en', currency: 'EUR', status: 'draft', linkToken: null, configVersion: 1, validatedAt: null, publishedAt: null, closedAt: null,
  duplicatedFrom: null, createdBy: 'u', createdAt: '', updatedAt: '', ...over,
});

describe('state is never colour alone', () => {
  it('every status shows its written label', () => {
    for (const s of CALL_STATUSES) expect(renderToStaticMarkup(createElement(StatusBadge, { status: s }))).toContain(CALL_STATUS_LABELS[s]);
  });
  it('the save indicator says what is happening, and never "Saved" before it is', () => {
    expect(saveStateText('saving')).toBe('Saving…');
    expect(saveStateText('saved')).toBe('Saved');
    expect(saveStateText('error')).toBe('Save error');
    expect(renderToStaticMarkup(createElement(SaveStatus, { state: 'dirty' }))).toContain('Unsaved changes');
    expect(renderToStaticMarkup(createElement(SaveStatus, { state: 'dirty' }))).not.toContain('Saved');
    expect(renderToStaticMarkup(createElement(SaveStatus, { state: 'error', message: 'boom', onRetry: noop }))).toContain('Try again');
    expect(renderToStaticMarkup(createElement(SaveStatus, { state: 'conflict', onReload: noop }))).toContain('Reload');
    expect(renderToStaticMarkup(createElement(SaveStatus, { state: 'idle' }))).not.toContain('Save');
  });
});

describe('inputs per type', () => {
  const render = (f: FormField, value?: unknown, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(FieldInput, { field: f, value: value as never, currency: 'EUR', onChange: noop, ...extra }));

  it('numbers: digits-only input with the formatted value underneath (and the currency when asked)', () => {
    const n = field({ id: 'n', kind: 'number', validations: { currency: true } });
    const html = render(n, '500000');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('500 000 €');
    expect(render(field({ id: 'n', kind: 'number' }), '500000')).not.toContain('€');
  });
  it('files: PDF only, with the size and validity said out loud', () => {
    const html = render(field({ id: 'f', kind: 'file', validations: { maxFileMb: 5 }, maxAgeMonths: 6, expectedType: 'Financials' }));
    expect(html).toContain('accept="application/pdf,.pdf"');
    expect(html).toContain('PDF only, up to 5 MB');
    expect(html).toContain('within the last 6 months');
    expect(html).toContain('Financials');
  });
  it('Yes/No starts with nothing selected', () => {
    const html = render(field({ id: 'y', kind: 'yes_no', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }));
    expect(html).not.toContain('checked');
    expect(render(field({ id: 'y', kind: 'yes_no', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }), 'yes')).toContain('checked');
  });
  it('a field linked to platform data says so; a required one is starred; an error is announced', () => {
    const html = render(field({ id: 's', kind: 'short_text', required: true, platformMapping: 'company_name', label: 'Startup name' }), '', { error: 'This answer is required.' });
    expect(html).toContain('Prefilled from your profile (Startup name)');
    expect(html).toContain('aria-label="required"');
    expect(html).toContain('role="alert"');
  });
  it('long text shows its limits', () => {
    expect(render(field({ id: 'l', kind: 'long_text', validations: { maxLength: 500, maxWords: 80 } }), 'two words')).toContain('9 / 500 characters · 2 / 80 words');
  });
});

describe('the preview', () => {
  it('says nothing is saved, starts on page 1 and hides what its condition hides', () => {
    const fields = [
      field({ id: 'a', kind: 'yes_no', label: 'Incorporated?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], page: 1, position: 0 }),
      field({ id: 'b', kind: 'date', label: 'When?', page: 1, position: 1, condition: { fieldId: 'a', operator: 'equals', value: 'yes' } }),
      field({ id: 'c', kind: 'short_text', label: 'Country', page: 2, position: 0 }),
    ];
    const html = renderToStaticMarkup(createElement(FormPreview, { fields, currency: 'EUR', title: 'Seed Call' }));
    expect(html).toContain('Preview — nothing is saved');
    expect(html).toContain('Page 1 of 2');
    expect(html).toContain('Incorporated?');
    expect(html).not.toContain('When?');
    expect(html).toContain('Next');
  });
  it('an empty form says how to start', () => {
    expect(renderToStaticMarkup(createElement(FormPreview, { fields: [], currency: 'EUR' }))).toContain('Add questions in the Form tab');
  });
});

describe('tabs', () => {
  it('General shows the time zone spelled out and the UTC instant under each date; locked when disabled', () => {
    const html = renderToStaticMarkup(createElement(GeneralTab, { call: call(), promoterName: 'Demo Hub', disabled: false, onChange: noop }));
    expect(html).toContain('Europe/Lisbon');
    expect(html).toContain('= 2027-02-01 09:00 UTC');
    expect(html).toContain('= 2027-03-31 16:00 UTC'); // Lisbon is on summer time by then
    expect(html).toContain('Demo Hub');
    expect(html).toContain('Listed');
    expect(renderToStaticMarkup(createElement(GeneralTab, { call: call(), promoterName: 'x', disabled: true, onChange: noop }))).toContain('disabled=""');
  });
  it('General warns when the call would close before it opens', () => {
    const html = renderToStaticMarkup(createElement(GeneralTab, { call: call({ closesAt: '2027-01-01T00:00:00.000Z' }), promoterName: 'x', disabled: false, onChange: noop }));
    expect(html).toContain('must close after it opens');
  });
  it('Phases: a single phase cannot be deleted; more can be added', () => {
    const one = renderToStaticMarkup(createElement(PhasesTab, { phases: [{ id: 'p1', name: 'Phase 1', startsOn: null, endsOn: null }], disabled: false, onChange: noop }));
    expect(one).toMatch(/aria-label="Delete phase"[^>]*disabled=""|disabled=""[^>]*aria-label="Delete phase"/);
    expect(one).toContain('+ Add phase');
    const two = renderToStaticMarkup(createElement(PhasesTab, { phases: [{ id: 'p1', name: 'A', startsOn: null, endsOn: null }, { id: 'p2', name: 'B', startsOn: '2027-03-01', endsOn: '2027-02-01' }], disabled: false, onChange: noop }));
    expect(two).toContain('This phase ends before it starts');
  });
});

describe('Preview & confirm', () => {
  const fields = [field({ id: 'q', kind: 'short_text', label: 'Startup name' })];
  const phases = [{ id: 'p', position: 0, name: 'Review', startsOn: null, endsOn: null }];
  const render = (c: Call, over: Record<string, unknown> = {}) => {
    const issues = readiness(c, phases, fields, new Date('2026-10-09T12:00:00Z'));
    return renderToStaticMarkup(createElement(PreviewTab, {
      call: c, effectiveStatus: c.status, phases, fields, issues, summary: summarise(phases, fields),
      actions: availableActions(c, issues, new Date('2026-10-09T12:00:00Z')), canManage: true, busy: false, error: '', origin: 'https://www.sherlockdeal.com',
      onJump: noop, onAction: noop, ...over,
    }));
  };
  it('a draft offers Confirm; a confirmed call offers Publish and Edit configuration; the link appears once published', () => {
    expect(render(call())).toContain('data-testid="confirm"');
    const validated = render(call({ status: 'validated' }));
    expect(validated).toContain('data-testid="publish"');
    expect(validated).toContain('data-testid="edit-config"');
    expect(validated).not.toContain('data-testid="call-link"');
    const published = render(call({ status: 'scheduled', linkToken: 'Zk4f03abc5d43b4d5e899' }));
    expect(published).toContain('https://www.sherlockdeal.com/call/Zk4f03abc5d43b4d5e899');
    expect(published).toContain('Copy link');
    expect(published).toContain('data-testid="extend"');
  });
  it('lists what is missing with a way to go there', () => {
    const html = render(call({ name: ' ', opensAt: null }));
    expect(html).toContain('Give the call a name.');
    expect(html).toContain('Go to General');
    expect(html).toContain('disabled=""'); // Confirm is disabled
  });
  it('a viewer who cannot manage sees the summary but no lifecycle buttons', () => {
    const html = render(call({ status: 'validated' }), { canManage: false });
    expect(html).toContain('Summary');
    expect(html).not.toContain('data-testid="publish"');
  });
  it('shows an open call as locked with its close-early action', () => {
    const open = call({ status: 'open', opensAt: '2026-10-01T00:00:00.000Z', closesAt: '2027-03-31T16:00:00.000Z', linkToken: 'abcdefghijklmnopqrstuv' });
    const html = renderToStaticMarkup(createElement(PreviewTab, {
      call: open, effectiveStatus: 'open', phases, fields, issues: [], summary: summarise(phases, fields),
      actions: availableActions(open, [], new Date('2026-10-09T12:00:00Z')), canManage: true, busy: false, error: '', origin: 'https://x.test', onJump: noop, onAction: noop,
    }));
    expect(html).toContain('questions and options are locked');
    expect(html).toContain('data-testid="close-early"');
    expect(html).not.toContain('data-testid="edit-config"');
  });
  it('builds the link from the origin without doubling slashes', () => {
    expect(callLink('https://www.sherlockdeal.com/', 'tok')).toBe('https://www.sherlockdeal.com/call/tok');
  });
});
