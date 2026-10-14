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
