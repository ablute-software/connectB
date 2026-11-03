// Prompt 927 (A) — before submitting, the form says "Your startup's profile will be added to «Entity»'s deal flow on Sherlock Deal." — on the last page, only for a call of an investor firm (an incubator has no
// pipeline), only while the application can still be edited, and with the entity's name.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApplicationForm } from './ApplicationForm';
import { newField } from '@/lib/calls/form-builder';
import type { ApplicationState } from '@/lib/calls/applicant/store';

const state = (over: Partial<ApplicationState> = {}, call: Partial<ApplicationState['call']> = {}): ApplicationState => ({
  application: { id: 'a1', reference: 'REF-1', status: 'draft', lastPage: 1, revision: 1, submittedAt: null },
  answers: {}, fields: [{ ...newField('short_text', 1, 0), id: 'f1', label: 'Startup name' }], files: [], orgId: 'o1', canEdit: true,
  call: { name: 'Seed Call', currency: 'EUR', language: 'en', timezone: 'Europe/Lisbon', opensAt: null, closesAt: '2026-12-01T00:00:00Z', promoter: 'Acme Capital', addsToDealFlow: true, ...call },
  ...over,
} as ApplicationState);
const html = (s: ApplicationState) => renderToStaticMarkup(createElement(ApplicationForm, { initial: s, initialPage: 1, onSubmitted: () => {} }));

describe('the deal flow notice in the applicant form', () => {
  it('is shown on the last page of a call of an investor firm, naming the entity', () => {
    const out = html(state());
    expect(out).toContain('data-testid="deal-flow-notice"');
    expect(out).toContain('Your startup&#x27;s profile will be added to «Acme Capital»&#x27;s deal flow on Sherlock Deal.');
  });
  it('is not shown for a call that has no investor pipeline, nor once the application can no longer be edited', () => {
    expect(html(state({}, { addsToDealFlow: false }))).not.toContain('deal-flow-notice');
    expect(html(state({}, { addsToDealFlow: undefined }))).not.toContain('deal-flow-notice');
    expect(html(state({ canEdit: false }))).not.toContain('deal-flow-notice');
  });
});
