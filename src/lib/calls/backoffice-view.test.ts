// Prompt 908 — the back-office Calls list: search by organisation or call, status filter, sort (newest first by
// default), how a person is written, and that the link is built by the SAME helper the entity's tab uses.
import { describe, expect, it } from 'vitest';
import { callLink } from './link';
import { filterCallRows, personLabel, sortCallRows, type BackofficeCallRow } from './backoffice-view';
import { callLink as callLinkFromEditor } from '@/components/calls/PreviewTab';

const row = (o: Partial<BackofficeCallRow> & { id: string; name: string }, org = 'Alpha Ventures'): BackofficeCallRow => ({
  status: 'draft', organisation: { kind: 'catalog_entity', id: `o-${org}`, name: org, isTest: false },
  admin: { name: 'Ana', email: 'ana@x.com' }, applications: { submitted: 0, inProgress: 0 }, linkToken: null, timezone: 'Europe/Lisbon',
  createdAt: '2026-10-01T10:00:00Z', opensAt: null, closesAt: null, phases: [], fieldsPerPage: [], validatedBy: null, validatedAt: null, publishedAt: null, ...o,
});

const rows = [
  row({ id: '1', name: 'Seed Call', createdAt: '2026-10-01T10:00:00Z', status: 'open' }, 'Alpha Ventures'),
  row({ id: '2', name: 'Growth Call', createdAt: '2026-10-05T10:00:00Z', status: 'draft' }, 'beta Capital'),
  row({ id: '3', name: 'zz-test call 908', createdAt: '2026-10-03T10:00:00Z', status: 'scheduled' }, 'ablute_ — Internal QA'),
];

describe('search, filter, sort', () => {
  it('searches by organisation or by call name, in any case', () => {
    expect(filterCallRows(rows, { q: 'ALPHA' }).map((r) => r.id)).toEqual(['1']);
    expect(filterCallRows(rows, { q: 'growth' }).map((r) => r.id)).toEqual(['2']);
    expect(filterCallRows(rows, { q: 'internal qa' }).map((r) => r.id)).toEqual(['3']);
    expect(filterCallRows(rows, { q: '908' }).map((r) => r.id)).toEqual(['3']);
    expect(filterCallRows(rows, { q: 'nothing' })).toEqual([]);
    expect(filterCallRows(rows, { q: '  ' })).toHaveLength(3);
  });
  it('filters by status, and combines with the search', () => {
    expect(filterCallRows(rows, { status: 'open' }).map((r) => r.id)).toEqual(['1']);
    expect(filterCallRows(rows, { status: '' })).toHaveLength(3);
    expect(filterCallRows(rows, { status: 'draft', q: 'alpha' })).toEqual([]);
  });
  it('sorts by creation date, newest first by default; or by organisation or call name', () => {
    expect(sortCallRows(rows).map((r) => r.id)).toEqual(['2', '3', '1']);
    expect(sortCallRows(rows, 'organisation').map((r) => r.id)).toEqual(['3', '1', '2']);
    expect(sortCallRows(rows, 'name').map((r) => r.id)).toEqual(['2', '1', '3']);
    const before = rows.map((r) => r.id);
    sortCallRows(rows, 'name');
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('a person', () => {
  it('is written as name and email, either alone, or a dash', () => {
    expect(personLabel({ name: 'Alexandra', email: 'a@x.com' })).toBe('Alexandra (a@x.com)');
    expect(personLabel({ name: null, email: 'a@x.com' })).toBe('a@x.com');
    expect(personLabel({ name: 'Alexandra', email: null })).toBe('Alexandra');
    expect(personLabel({ name: null, email: null })).toBe('—');
    expect(personLabel(null)).toBe('—');
  });
});

describe('the link', () => {
  it('is built by ONE helper, shared by the back-office and the entity\'s editor', () => {
    expect(callLinkFromEditor).toBe(callLink);
    expect(callLink('https://www.sherlockdeal.com/', 'tok123')).toBe('https://www.sherlockdeal.com/call/tok123');
  });
});
