// Prompt 909 (Adenda 2) — what the import screen does with what the server says: the honest sentence for an answer that is not JSON, and the
// decisions on opening (resume a reading) and while waiting (keep waiting, show the proposal, go back with the reason).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTACT_TEXT, LOST_POLL_MESSAGE, NETWORK_MESSAGE, NON_JSON_MESSAGE, importFailure, splitContact } from './client-errors';
import { POLL_GIVE_UP, afterPoll, onOpen, type ImportState } from './screen-state';
import { callsApi } from '@/components/calls/api';

afterEach(() => vi.unstubAllGlobals());
const PROPOSAL = { general: {}, phases: [], fields: [], attention: [], foundLater: { eligibility: [], evaluation: [] } } as never;

describe('an answer that is not JSON (a 504, a 500 as HTML)', () => {
  it('gets its own sentence — never only "We could not read the documents." — and keeps the HTTP code', () => {
    expect(importFailure(504, null, false)).toEqual({ message: NON_JSON_MESSAGE, httpStatus: 504 });
    expect(NON_JSON_MESSAGE).toBe('Reading took too long or failed on our side. Please try again; if it keeps failing, contact us at sherlockdeal.com/contact.');
    expect(importFailure(500, {}, true).message).toBe(NON_JSON_MESSAGE);          // JSON, but with no error of its own
    expect(importFailure(0, null, false)).toEqual({ message: NETWORK_MESSAGE, httpStatus: null });
  });
  it('a JSON answer keeps the route\'s own sentence', () => {
    expect(importFailure(400, { error: 'This PDF has no readable text. Upload the original document.' }, true)).toEqual({ message: 'This PDF has no readable text. Upload the original document.', httpStatus: 400 });
  });
  it('the contact address in a sentence can be cut out to become a link', () => {
    expect(splitContact(NON_JSON_MESSAGE)).toEqual({ before: 'Reading took too long or failed on our side. Please try again; if it keeps failing, contact us at ', after: '.' });
    expect(NON_JSON_MESSAGE).toContain(CONTACT_TEXT);
    expect(splitContact('A scan.')).toBeNull();
  });
  it('through the real client call: a gateway timeout page becomes the new sentence with the code; a refusal keeps its own', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>An error occurred with your deployment: FUNCTION_INVOCATION_TIMEOUT</html>', { status: 504 })));
    const r = await callsApi.importFromDocuments('c1', new FormData());
    expect(r).toMatchObject({ ok: false, status: 504, httpStatus: 504, body: { error: NON_JSON_MESSAGE } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, code: 'scanned', error: 'This PDF has no readable text. Upload the original document.' }, { status: 400 })));
    expect(await callsApi.importFromDocuments('c1', new FormData())).toMatchObject({ ok: false, httpStatus: 400, body: { error: 'This PDF has no readable text. Upload the original document.' } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await callsApi.importFromDocuments('c1', new FormData())).toMatchObject({ ok: false, status: 0, body: { error: NETWORK_MESSAGE } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, run: { id: 'r1', status: 'reading' } }, { status: 202 })));
    expect(await callsApi.importFromDocuments('c1', new FormData())).toMatchObject({ ok: true, body: { run: { id: 'r1', status: 'reading' } } });
  });
});

describe('opening the screen again', () => {
  const state = (over: Partial<ImportState> = {}): ImportState => ({ pending: null, reading: null, lastFailure: null, ...over });
  it('a run still reading resumes the wait, counted from when it started', () => {
    const d = onOpen(state({ reading: { id: 'r1', createdAt: '2026-10-14T17:09:05.000Z' } }), 0);
    expect(d).toEqual({ kind: 'reading', runId: 'r1', since: Date.parse('2026-10-14T17:09:05.000Z') });
  });
  it('a proposal that is ready is offered (it survives closing the screen); a reading in progress wins over it', () => {
    expect(onOpen(state({ pending: { id: 'p1', proposal: PROPOSAL } }))).toMatchObject({ kind: 'upload', waiting: { id: 'p1' }, error: null });
    expect(onOpen(state({ pending: { id: 'p1', proposal: PROPOSAL }, reading: { id: 'r2', createdAt: '2026-10-14T17:09:05.000Z' } })).kind).toBe('reading');
  });
  it('a failure that happened while the screen was closed is said, with its own sentence', () => {
    expect(onOpen(state({ lastFailure: { id: 'f1', message: 'Reading the documents took longer than we allow.', code: 'timed_out', at: 'x' } })))
      .toEqual({ kind: 'upload', waiting: null, error: 'Reading the documents took longer than we allow.' });
    expect(onOpen(state())).toEqual({ kind: 'upload', waiting: null, error: null });
  });
});

describe('while waiting', () => {
  it('keeps waiting while the run is reading', () => {
    expect(afterPoll({ ok: true, status: 200, run: { id: 'r', status: 'reading' } }, 3)).toEqual({ kind: 'wait', misses: 0 });
  });
  it('shows the proposal the moment it is ready', () => {
    expect(afterPoll({ ok: true, status: 200, run: { id: 'r', status: 'proposed', proposal: PROPOSAL } }, 0)).toMatchObject({ kind: 'review', id: 'r' });
  });
  it('goes back to the upload with the reason when the run failed', () => {
    expect(afterPoll({ ok: true, status: 200, run: { id: 'r', status: 'failed', error: 'Reading the documents took longer than we allow.' } }, 0)).toEqual({ kind: 'upload', error: 'Reading the documents took longer than we allow.' });
    expect(afterPoll({ ok: true, status: 200, run: { id: 'r', status: 'failed' } }, 0)).toMatchObject({ kind: 'upload', error: expect.any(String) });
  });
  it('a poll that fails is tried again; after several in a row the screen says the reading carries on in the background', () => {
    let misses = 0;
    for (let i = 0; i < POLL_GIVE_UP - 1; i++) { const n = afterPoll({ ok: false, status: 0 }, misses); expect(n.kind).toBe('wait'); misses = (n as { misses: number }).misses; }
    expect(afterPoll({ ok: false, status: 0 }, misses)).toEqual({ kind: 'upload', error: LOST_POLL_MESSAGE });
  });
  it('a run that no longer exists, or is no longer available, ends the wait', () => {
    expect(afterPoll({ ok: false, status: 404 }, 0)).toMatchObject({ kind: 'upload' });
    expect(afterPoll({ ok: true, status: 200, run: { id: 'r', status: 'discarded' } }, 0)).toMatchObject({ kind: 'upload' });
  });
});

// --- Adenda 2b: not stuck on the screen ---------------------------------------------------------------------------------------------------
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { IMPORT_NOTICES_EVENT, IMPORT_STATUS_LABEL, importStatusOf } from './screen-state';
import { ImportStatusPill } from '@/components/calls/ImportStatusPill';

describe('the status next to the Import button', () => {
  it('a reading in progress wins over a waiting proposal; a waiting proposal is "ready"; nothing is nothing', () => {
    expect(importStatusOf({ pending: null, reading: { id: 'r', createdAt: 'x' } })).toBe('reading');
    expect(importStatusOf({ pending: { id: 'p', proposal: PROPOSAL }, reading: null })).toBe('ready');
    expect(importStatusOf({ pending: { id: 'p', proposal: PROPOSAL }, reading: { id: 'r', createdAt: 'x' } })).toBe('reading');
    expect(importStatusOf({ pending: null, reading: null })).toBeNull();
  });
  it('says "Proposal ready to review" — a button that opens the review when ready, a plain status while reading, nothing otherwise', () => {
    expect(IMPORT_STATUS_LABEL.ready).toBe('Proposal ready to review');
    const ready = renderToStaticMarkup(createElement(ImportStatusPill, { status: 'ready', onClick: () => {} }));
    expect(ready).toContain('Proposal ready to review'); expect(ready).toContain('<button');
    const reading = renderToStaticMarkup(createElement(ImportStatusPill, { status: 'reading' }));
    expect(reading).toContain('Reading the documents…'); expect(reading).not.toContain('<button');
    expect(renderToStaticMarkup(createElement(ImportStatusPill, { status: null }))).toBe('');
    expect(IMPORT_NOTICES_EVENT).toBe('calls:import-notices-changed');
  });
});

describe('the screen and the workspaces say what was decided', () => {
  const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8');
  it('the dialog: the waiting text, "Continue working", and no evaluation-grid choice', () => {
    const src = read('src/components/calls/ImportFromDocuments.tsx');
    expect(src).toContain("Reading your documents. This can take a minute or two. You can keep using the platform; we&apos;ll let you know when the proposal is ready.");
    expect(src).toContain('Continue working');
    expect(src).not.toMatch(/Evaluation grid|'grid'/);
  });
  it('both workspaces badge the Calls tab with the unseen import notices', () => {
    expect(read('src/components/investor-workspace/InvestorWorkspaceShell.tsx')).toMatch(/useImportNoticeCount\(callsEnabled\)[\s\S]*badge: callsNotices > 0/);
    expect(read('src/components/incubator/IncubatorWorkspace.tsx')).toMatch(/useImportNoticeCount\(callsEnabled\)[\s\S]*n\.key === 'calls' && callsNotices > 0/);
  });
});

// --- 917 Adenda 1, Part A: the way back to a proposal can no longer be consumed or lost by looking at it ---------------------------------------------------------
describe('the way back to a proposal (917 Adenda 1)', () => {
  const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8');
  it('opening the dialog does not mark the notices as seen, and the close button does not discard the proposal', () => {
    const dlg = read('src/components/calls/ImportFromDocuments.tsx');
    expect(dlg).not.toContain('markImportNoticesSeen');
    expect(dlg).toMatch(/onClick=\{onClose\} className="text-sm text-gray-500 hover:text-gray-800" aria-label="Close"/);
    expect(dlg).toContain('Closing this window keeps the proposal');
    expect(dlg).toContain('openRunId');                                   // "Review" opens ON a run
  });
  it('"Review" on a notice opens that run and does not hide the notice; the card and the pill open it too', () => {
    const notices = read('src/components/calls/ImportNotices.tsx');
    expect(notices).toMatch(/onClick=\{\(\) => onReview\(n\.callId, n\.kind === 'import_ready' \? n\.runId : null\)\}/);
    expect(notices).toContain('Dismiss');
    const list = read('src/components/calls/CallsList.tsx');
    expect(list).toContain('card-import-status'); expect(list).toContain('runId: c.importRun!.id');
    expect(read('src/components/calls/CallEditor.tsx')).toContain('reviewProposal');
  });
});
