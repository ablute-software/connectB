// Prompt 469 — required test: a client that rejects (or resolves with an
// error) must never propagate out of logAiCall. This is what makes
// `await logAiCall(...)` safe everywhere it now appears (§B) — the caller
// can never fail because its cost/audit log couldn't be written.
import { afterEach, describe, expect, it, vi } from 'vitest';

const insertMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ insert: insertMock }) }),
}));

import { logAiCall } from './ai-cost-log';

afterEach(() => {
  vi.unstubAllEnvs();
  insertMock.mockReset();
});

function stubEnv() {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
}

describe('logAiCall — never propagates a client failure (Prompt 469 required test)', () => {
  it('resolves cleanly when the insert call itself throws/rejects', async () => {
    stubEnv();
    insertMock.mockRejectedValueOnce(new Error('connection refused'));
    await expect(logAiCall({ route: '/x', purpose: 'test', model: 'claude-sonnet-5' })).resolves.toBeUndefined();
  });

  it('resolves cleanly when the insert call resolves with a Postgres error object (no throw)', async () => {
    stubEnv();
    insertMock.mockResolvedValueOnce({ error: { message: 'insert failed', code: '23505' } });
    await expect(logAiCall({ route: '/x', purpose: 'test', model: 'claude-sonnet-5' })).resolves.toBeUndefined();
  });

  it('resolves cleanly with no Supabase env configured (demo mode) — never attempts the insert', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    await expect(logAiCall({ route: '/x', purpose: 'test', model: 'claude-sonnet-5' })).resolves.toBeUndefined();
    expect(insertMock).not.toHaveBeenCalled();
  });
});
