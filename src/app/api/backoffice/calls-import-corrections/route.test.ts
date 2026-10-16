// Prompt 917 (Adenda 1, Part B) — the back office's simple view of the import from documents: how the proposals were made (platform alone / platform + AI / AI) and the
// corrections people make most. Platform admin only; read only; and a missing table never breaks the page.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb } from '@/test/fake-calls-db';

let db: CallsDb;
let isAdmin = true;

vi.mock('@/lib/backoffice-auth', () => ({
  requirePlatformAdmin: async () => (isAdmin
    ? { admin: fakeCallsAdmin(db), userId: 'bo-1' }
    : { error: NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 }) }),
}));

import { GET, dynamic } from './route';

const run = (o: Record<string, unknown>) => db.tables.call_import_runs.push({ id: `r${db.tables.call_import_runs.length + 1}`, call_id: 'c', status: 'proposed', ...o });
const corr = (kind: string, source: string | null, detail: Record<string, unknown>) => db.tables.call_import_corrections.push({ id: `k${db.tables.call_import_corrections.length + 1}`, run_id: 'r1', call_id: 'c', kind, number: null, source, detail, created_at: '2026-10-16T10:00:00Z' });

beforeEach(() => { db = callsDb(); isAdmin = true; });

describe('/api/backoffice/calls-import-corrections', () => {
  it('is never cached, and is for the platform team only', async () => {
    expect(dynamic).toBe('force-dynamic');
    isAdmin = false;
    expect((await GET()).status).toBe(403);
  });

  it('counts the proposals by how they were made, with the averages, and ignores the ones still reading or failed', async () => {
    run({ mode: 'internal', quality: { coverage: 1, typeConfidence: 0.96 }, duration_ms: 3000 });
    run({ mode: 'internal+ai', quality: { coverage: 0.97, typeConfidence: 0.9 }, duration_ms: 9000 });
    run({ mode: 'ai', quality: null, duration_ms: 40000, status: 'applied' });
    run({ mode: null, quality: null, duration_ms: null, status: 'discarded' });          // before the platform reader existed
    run({ mode: 'internal', quality: { coverage: 1, typeConfidence: 1 }, status: 'failed' });
    run({ mode: 'internal', status: 'reading' });
    const body = await (await GET()).json();
    expect(body.available).toBe(true);
    expect(body.runs).toMatchObject({ total: 4, byMode: { internal: 1, 'internal+ai': 1, ai: 1, unknown: 1 } });
    expect(body.runs.avgCoverage).toBeCloseTo(0.985, 3);
    expect(body.runs.avgTypeConfidence).toBeCloseTo(0.93, 3);
    expect(body.runs.avgDurationMs).toBe(17333);
  });

  it('summarises the corrections: the most frequent first, who made the item they changed', async () => {
    corr('kind_changed', 'internal', { from: 'short_text', to: 'long_text' });
    corr('kind_changed', 'ai', { from: 'short_text', to: 'long_text' });
    corr('field_deleted', 'internal', { kind: 'file' });
    const body = await (await GET()).json();
    expect(body.corrections.total).toBe(3);
    expect(body.corrections.kindChanges[0]).toEqual({ from: 'short_text', to: 'long_text', count: 2, internal: 1, ai: 1 });
    expect(body.corrections.deleted).toEqual([{ kind: 'file', count: 1 }]);
  });

  it('with nothing yet it answers an empty summary, not an error', async () => {
    const body = await (await GET()).json();
    expect(body).toMatchObject({ ok: true, available: true, corrections: { total: 0 }, runs: { total: 0, avgCoverage: null, avgDurationMs: null } });
  });

  it('a table that is not there yet (the migration not applied) hides the panel instead of breaking the page', async () => {
    Object.defineProperty(db.tables, 'call_import_corrections', { get() { throw new Error('relation does not exist'); }, configurable: true });
    expect(await (await GET()).json()).toEqual({ ok: true, available: false });
  });
});
