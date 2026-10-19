// Prompt 909 (Adenda 2) — the background reading, on its own: its clock, the way each failure is named, what a failed or cut-off answer leaves behind.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callsDb, fakeCallsAdmin, type CallsDb } from '@/test/fake-calls-db';

const aiLog = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/ai-cost-log', async (orig) => ({ ...(await orig<typeof import('@/lib/ai-cost-log')>()), logAiCall: (...a: unknown[]) => aiLog(...a) }));

import { MODEL_BUDGET_MS, IMPORT_MAX_DURATION_S, INTERNAL_FAILURE_MESSAGE, classifyFailure, runImportJob, timedOutMessage } from './job';
import { ImportProviderError, TRUNCATED_MESSAGE, callAnthropic } from './anthropic';
import { createReadingRun, expireStaleRuns, loadRun, READING_STALE_MS } from './store';
import type { ModelCaller } from './propose';

const CALL = '22222222-2222-4222-8222-222222222222';
let db: CallsDb;
const admin = () => fakeCallsAdmin(db) as never;
const PROPOSAL = { general: { name: 'Edition 2027' }, phases: [], form_pages: [{ fields: [{ label: 'Company name', kind: 'short_text' }] }] };
const docs = [{ kind: 'form' as const, format: 'docx' as const, text: 'Application form', pdfBase64: null }];
const files = [{ name: 'form.pdf', kind: 'form', bytes: 170209 }];

async function newRun() {
  const run = await createReadingRun(admin(), CALL, { sourceDocumentIds: [], sourceBytes: 170209, userId: 'ana' });
  return run!.id;
}
const input = (runId: string) => ({ admin: admin(), callId: CALL, callName: 'Edition 2027', runId, userId: 'ana', docs, files, sourceDocumentIds: [] as string[] });

beforeEach(() => { db = callsDb(); db.clock = Date.now(); aiLog.mockClear(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.ANTHROPIC_API_KEY; });

describe('the budget', () => {
  it('leaves the model 30 s less than the route is allowed, so there is time to save what it answered', () => {
    expect(MODEL_BUDGET_MS).toBe((IMPORT_MAX_DURATION_S - 30) * 1000);
  });
});

describe('a slow model', () => {
  it('is stopped by the job\'s own clock and the run says so — it does not wait for the platform to cut it', async () => {
    const id = await newRun();
    let signalSeen = false;
    const slow: ModelCaller = (req) => new Promise((_res, rej) => {
      signalSeen = !!req.signal;
      req.signal?.addEventListener('abort', () => rej(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
    });
    await runImportJob(input(id), { callModel: slow, budgetMs: 25 });
    expect(signalSeen).toBe(true);
    const run = await loadRun(admin(), CALL, id);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'timed_out', errorMessage: timedOutMessage(25) });
    expect(db.tables.call_events.map((e) => e.event)).toContain('import_failed');
    expect(aiLog).not.toHaveBeenCalled();
  });
});

describe('failures are named', () => {
  it('provider errors keep their sentence and code; a timeout and anything unexpected get theirs', () => {
    expect(classifyFailure(new ImportProviderError('Busy, try later.', 503, 'provider'), false, 1000)).toMatchObject({ code: 'provider', message: 'Busy, try later.' });
    expect(classifyFailure(new ImportProviderError(TRUNCATED_MESSAGE, 502, 'truncated'), false, 1000)).toMatchObject({ code: 'truncated' });
    expect(classifyFailure(new Error('x'), true, 270_000)).toMatchObject({ code: 'timed_out', message: expect.stringContaining('4.5 minutes') });
    const other = classifyFailure(new TypeError('boom'), false, 1000);
    expect(other).toMatchObject({ code: 'internal', message: INTERNAL_FAILURE_MESSAGE });
    expect(other.message).toContain('sherlockdeal.com/contact');
    expect(other.detail).toContain('boom');                          // the detail is for the logs, never for the person
    expect(other.message).not.toContain('boom');
  });
});

describe('what a failed run leaves behind', () => {
  it('logs the reason, the call and the size of the files; the run keeps no proposal', async () => {
    const id = await newRun();
    await runImportJob(input(id), { callModel: async () => { throw new Error('ECONNRESET'); } });
    const logged = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain(`run=${id}`); expect(logged).toContain(`call=${CALL}`); expect(logged).toContain('code=internal'); expect(logged).toContain('bytes=170209'); expect(logged).toContain('ECONNRESET');
    expect(await loadRun(admin(), CALL, id)).toMatchObject({ status: 'failed', proposal: {}, errorCode: 'internal', sourceBytes: 170209 });
  });

  it('an answer that arrives after the run was closed (discarded, or expired) does not bring it back to life', async () => {
    const id = await newRun();
    db.tables.call_import_runs[0].status = 'discarded';
    await runImportJob(input(id), { callModel: async () => ({ input: PROPOSAL, usage: { input_tokens: 1, output_tokens: 1 }, model: 'claude-sonnet-4-5' }) });
    expect(db.tables.call_import_runs[0].status).toBe('discarded');
    expect(db.tables.call_events.map((e) => e.event)).not.toContain('import_proposed');
  });

  it('never throws, even when recording the failure fails', async () => {
    const id = await newRun();
    const broken = { from: () => { throw new Error('db down'); } } as never;
    await expect(runImportJob({ ...input(id), admin: broken }, { callModel: async () => { throw new Error('x'); } })).resolves.toBeUndefined();
  });
});

describe('a run whose function is gone', () => {
  it('is closed as failed once it is older than any function could be alive, and not before', async () => {
    const id = await newRun();
    const started = Date.parse(db.tables.call_import_runs[0].created_at as string);
    expect(await expireStaleRuns(admin(), CALL, new Date(started + READING_STALE_MS - 1000))).toEqual([]);
    const closed = await expireStaleRuns(admin(), CALL, new Date(started + READING_STALE_MS + 1000));
    expect(closed.map((r) => r.id)).toEqual([id]);
    expect(db.tables.call_import_runs[0]).toMatchObject({ status: 'failed', error_code: 'timed_out' });
    // and the maximum a function can live is shorter than that
    expect(READING_STALE_MS).toBeGreaterThan(IMPORT_MAX_DURATION_S * 1000);
  });
});

describe('the real provider call', () => {
  const answerWith = (body: unknown, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, text: async () => JSON.stringify(body), json: async () => body })));
  const req = (signal?: AbortSignal) => ({ system: 's', content: [{ type: 'text' as const, text: 'x' }], tool: { name: 'propose' } as never, signal });

  it('an answer cut off by max_tokens is NEVER read as a proposal: it is a "truncated" failure with a clear sentence', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    answerWith({ stop_reason: 'max_tokens', content: [{ type: 'tool_use', input: { general: { name: 'half of it' } } }], usage: { input_tokens: 1, output_tokens: 6000 } });
    await expect(callAnthropic(req())).rejects.toMatchObject({ code: 'truncated', message: TRUNCATED_MESSAGE });
  });

  it('the job\'s clock reaches the request: the signal is passed to fetch', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    answerWith({ stop_reason: 'tool_use', content: [{ type: 'tool_use', input: PROPOSAL }], usage: { input_tokens: 1, output_tokens: 1 } });
    const ctl = new AbortController();
    await callAnthropic(req(ctl.signal));
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(ctl.signal);
    expect(JSON.parse(String(init.body)).max_tokens).toBe(6000);       // the limit of tokens is unchanged
  });

  it('a missing key is "not_configured"', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(callAnthropic(req())).rejects.toMatchObject({ code: 'not_configured', status: 503 });
  });
});
