// Prompt 909, I1 — the "⋯" menu of a call card, "Show archived", the lifecycle rules for delete and archive, and the
// back-office filter. Pure, no browser.
import { describe, expect, it } from 'vitest';
import { callMenu, hasMenu, visibleCalls } from './list-view';
import { archiveCall, availableActions, deleteProblem } from './lifecycle';
import { filterCallRows, type BackofficeCallRow } from './backoffice-view';
import type { Call, CallStatus } from './types';

const item = (status: CallStatus, applicationsTotal = 0, effectiveStatus: CallStatus = status) => ({ status, effectiveStatus, applicationsTotal });

describe('who gets what in the menu', () => {
  it('delete only before opening and with nobody applied; archive anything that is not open or archived; duplicate always', () => {
    expect(callMenu(item('draft'), true)).toEqual({ duplicate: true, archive: true, delete: true });
    expect(callMenu(item('validated'), true).delete).toBe(true);
    expect(callMenu(item('scheduled'), true).delete).toBe(true);
    expect(callMenu(item('draft', 1), true)).toEqual({ duplicate: true, archive: true, delete: false });
    expect(callMenu(item('open'), true)).toEqual({ duplicate: true, archive: false, delete: false });
    expect(callMenu(item('closed'), true)).toEqual({ duplicate: true, archive: true, delete: false });
    expect(callMenu(item('archived'), true)).toEqual({ duplicate: true, archive: false, delete: false });
  });
  it('a scheduled call whose time has come counts as open (it must be closed first)', () => {
    expect(callMenu(item('scheduled', 0, 'open'), true)).toEqual({ duplicate: true, archive: false, delete: false });
  });
  it('someone who cannot configure the call gets no menu at all', () => {
    expect(hasMenu(callMenu(item('draft'), false))).toBe(false);
    expect(hasMenu(callMenu(item('draft'), true))).toBe(true);
  });
});

describe('Show archived', () => {
  const calls = [item('draft'), item('archived'), item('closed')];
  it('hides archived calls by default and shows them when asked', () => {
    expect(visibleCalls(calls, false)).toHaveLength(2);
    expect(visibleCalls(calls, true)).toHaveLength(3);
  });
});

describe('the lifecycle rules behind it', () => {
  const call = (status: CallStatus, over: Partial<Call> = {}): Call => ({
    id: 'c', promoterKind: 'catalog_entity', promoterId: 'e', name: 'X', description: null, opensAt: null, closesAt: null, timezone: 'Europe/Lisbon',
    visibility: 'listed', limitUnit: 'project', allowMultiple: false, contentLanguage: 'en', currency: 'EUR', status, linkToken: null, configVersion: 1,
    validatedAt: null, publishedAt: null, closedAt: null, archivedAt: null, duplicatedFrom: null, createdBy: 'u', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
  });
  it('deleteProblem names the reason', () => {
    expect(deleteProblem('draft', 0)).toBeNull();
    expect(deleteProblem('open', 0)).toBe('This call has opened, so it cannot be deleted. Archive it instead.');
    expect(deleteProblem('scheduled', 2)).toContain('2 applicants have started an application (not submitted yet)');
  });
  it('archive: refused while open (and archived), allowed otherwise, with the patch', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    expect(archiveCall(call('open', { opensAt: '2026-01-01T00:00:00Z', closesAt: '2027-01-01T00:00:00Z' }), 'u', now)).toMatchObject({ ok: false });
    expect(archiveCall(call('archived'), 'u', now)).toMatchObject({ ok: false });
    expect(archiveCall(call('closed'), 'ana', now)).toMatchObject({ ok: true, event: 'call_archived', patch: { status: 'archived', archived_by: 'ana', archived_at: now.toISOString() } });
  });
  it('availableActions carries canDelete and canArchive', () => {
    expect(availableActions(call('draft'), [], new Date(), 0)).toMatchObject({ canDelete: true, canArchive: true });
    expect(availableActions(call('draft'), [], new Date(), 3)).toMatchObject({ canDelete: false, canArchive: true });
    expect(availableActions(call('archived'), [], new Date(), 0)).toMatchObject({ canDelete: false, canArchive: false });
  });
});

describe('back-office: archived calls', () => {
  const row = (id: string, status: CallStatus): BackofficeCallRow => ({
    id, name: id, status, organisation: { kind: 'catalog_entity', id: 'o', name: 'Org', isTest: false }, admin: { name: null, email: null },
    applications: { submitted: 0, inProgress: 0 }, linkToken: null, timezone: 'Europe/Lisbon', createdAt: '2026-10-01T00:00:00Z', opensAt: null, closesAt: null,
    phases: [], fieldsPerPage: [], validatedBy: null, validatedAt: null, publishedAt: null,
  });
  const rows = [row('a', 'open'), row('b', 'archived')];
  it('are hidden unless "Show archived" is ticked or the status filter is "archived"', () => {
    expect(filterCallRows(rows, {}).map((r) => r.id)).toEqual(['a']);
    expect(filterCallRows(rows, { showArchived: true }).map((r) => r.id)).toEqual(['a', 'b']);
    expect(filterCallRows(rows, { status: 'archived' }).map((r) => r.id)).toEqual(['b']);
  });
});
