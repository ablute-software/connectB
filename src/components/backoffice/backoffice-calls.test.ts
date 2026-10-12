// Prompt 908 — what the back-office Calls list renders: organisation with its kind and the Test mark, the call,
// its status, the admin, application NUMBERS, the link with Copy and Open (or "Not published yet"), the dates in the
// call's own time zone, and the expanded detail. Rendered to static markup, like the other component tests.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BackofficeCallsTable } from './BackofficeCallsPanel';
import type { BackofficeCallRow } from '@/lib/calls/backoffice-view';

const published: BackofficeCallRow = {
  id: 'c1', name: 'zz-test call 908', status: 'scheduled',
  organisation: { kind: 'catalog_entity', id: 'f1', name: 'ablute_ — Internal QA', isTest: true },
  admin: { name: 'Alexandra Meira', email: 'alexandrameira@ablute.pt' },
  applications: { submitted: 0, inProgress: 3 }, linkToken: 'tok-908-abcdefghijklmn', timezone: 'Europe/Lisbon',
  createdAt: '2026-10-09T10:00:00Z', opensAt: '2026-12-01T09:00:00Z', closesAt: '2027-01-01T09:00:00Z',
  phases: [{ name: 'Applications', startsOn: '2026-12-01', endsOn: '2026-12-31' }, { name: 'Evaluation', startsOn: null, endsOn: null }],
  fieldsPerPage: [{ page: 1, fields: 4 }, { page: 2, fields: 1 }],
  validatedBy: { name: 'Alexandra Meira', email: 'alexandrameira@ablute.pt' }, validatedAt: '2026-10-09T10:30:00Z', publishedAt: '2026-10-09T10:35:00Z',
};
const draft: BackofficeCallRow = {
  ...published, id: 'c2', name: 'A draft', status: 'draft', linkToken: null, applications: { submitted: 0, inProgress: 0 },
  organisation: { kind: 'incubator', id: 'i1', name: 'Hub', isTest: false }, opensAt: null, closesAt: null, validatedBy: null, validatedAt: null, publishedAt: null, phases: [], fieldsPerPage: [],
};
const render = (rows: BackofficeCallRow[], initialOpen: string | null = null) =>
  renderToStaticMarkup(createElement(BackofficeCallsTable, { rows, origin: 'https://www.sherlockdeal.com', initialOpen }));

describe('the list', () => {
  const html = render([published, draft]);

  it('shows organisation and its kind, the Test mark, the call, the status and the admin with name and email', () => {
    expect(html).toContain('ablute_ — Internal QA');
    expect(html).toContain('Investor firm');
    expect(html).toContain('Incubator');
    expect(html).toContain('>Test<');
    expect(html).toContain('zz-test call 908');
    expect(html).toContain('data-status="scheduled"');
    expect(html).toContain('Alexandra Meira (alexandrameira@ablute.pt)');
  });
  it('shows the numbers of applications, submitted and in progress, and nothing else about them', () => {
    expect(html).toMatch(/<b>0<\/b> submitted/);
    expect(html).toContain('3 in progress');
  });
  it('shows the complete link with Copy and Open; without a link, "Not published yet"', () => {
    expect(html).toContain('https://www.sherlockdeal.com/call/tok-908-abcdefghijklmn');
    expect(html).toContain('>Copy<');
    expect(html).toContain('href="https://www.sherlockdeal.com/call/tok-908-abcdefghijklmn"');
    expect(html).toContain('>Open<');
    expect(html).toContain('Not published yet');
    expect(html.match(/>Copy</g)).toHaveLength(1);
  });
  it('shows created, opens and closes in the call\'s own time zone', () => {
    expect(html).toContain('Created 09 Oct 2026');
    expect(html).toContain('Opens 01 Dec 2026');
    expect(html).toContain('Closes 01 Jan 2027');
    expect(html).toContain('Europe/Lisbon');
  });
  it('has nothing to edit: no inputs but the search and the "Show archived" filter, no save, no delete', () => {
    expect(html).not.toMatch(/>Save</);
    expect(html).not.toMatch(/>Delete</);
    expect(html).not.toMatch(/>Edit</);
    expect(html.match(/<input/g)).toHaveLength(2); // the search box and the Show archived checkbox
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
  });
  it('is not expanded until a row is clicked', () => {
    expect(html).not.toContain('data-testid="call-detail-c1"');
  });
});

describe('the expanded row', () => {
  it('shows the phases, the fields per page, who confirmed it and when, and when it was published', () => {
    const html = render([published], 'c1');
    expect(html).toContain('data-testid="call-detail-c1"');
    expect(html).toContain('Applications');
    expect(html).toContain('Evaluation');
    expect(html).toContain('Page 1: 4 fields');
    expect(html).toContain('Page 2: 1 field<');
    expect(html).toContain('Alexandra Meira (alexandrameira@ablute.pt) · 09 Oct 2026, 11:30 (Europe/Lisbon)');
    expect(html).toContain('09 Oct 2026, 11:35 (Europe/Lisbon)');
  });
  it('an unconfirmed, unpublished call says so', () => {
    const html = render([draft], 'c2');
    expect(html).toContain('Not confirmed yet.');
    expect(html).toContain('Not published yet.');
    expect(html).toContain('No fields yet.');
  });
});

describe('empty', () => {
  it('says there is no call yet', () => {
    expect(render([])).toContain('No call has been created yet.');
  });
});
