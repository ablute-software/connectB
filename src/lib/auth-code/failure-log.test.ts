// Prompt 911 (B.2) — the failure registry's writer: it records what the provider said, tidies after itself, and can never
// make a request fail.
import { describe, expect, it, vi } from 'vitest';
import { AUTH_FAILURE_RETENTION_DAYS, failureFields, recordAuthEmailFailure } from './failure-log';

function fakeAdmin(opts: { insertError?: string; throws?: boolean } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const deletedBefore: string[] = [];
  const admin = {
    from: (table: string) => {
      expect(table).toBe('auth_email_failures');
      return {
        insert: async (row: Record<string, unknown>) => {
          if (opts.throws) throw new Error('network down');
          if (opts.insertError) return { error: { message: opts.insertError } };
          inserted.push(row); return { error: null };
        },
        delete: () => ({ lt: async (_col: string, v: string) => { deletedBefore.push(v); return { error: null }; } }),
      };
    },
  };
  return { admin: admin as never, inserted, deletedBefore };
}

describe('failureFields', () => {
  it('reduces an AuthApiError to status, code and message', () => {
    const err = Object.assign(new Error('gomail: could not send email 1: 550 "The sherlockdeal.com domain is not verified"'), { status: 500, code: 'unexpected_failure' });
    expect(failureFields({ error: err })).toEqual({ http_status: 500, error_code: 'unexpected_failure', error_message: err.message });
  });
  it('takes explicit fields from the browser report, truncating the text', () => {
    const f = failureFields({ status: 429, code: 'over_email_send_rate_limit', message: 'x'.repeat(900) });
    expect(f.http_status).toBe(429);
    expect(f.error_code).toBe('over_email_send_rate_limit');
    expect(f.error_message?.length).toBeLessThanOrEqual(401);
  });
  it('an unknown shape gives nulls, never "{}"', () => {
    expect(failureFields({ error: {} })).toEqual({ http_status: null, error_code: null, error_message: null });
    expect(failureFields({ error: 42 })).toEqual({ http_status: null, error_code: null, error_message: null });
  });
});

describe('recordAuthEmailFailure', () => {
  it('writes a lower-cased email with the action and source, then clears what is older than the retention window', async () => {
    const { admin, inserted, deletedBefore } = fakeAdmin();
    await recordAuthEmailFailure(admin, { email: '  IVaz@CTVC.pt ', action: 'signup', source: 'server', error: Object.assign(new Error('x'), { status: 500, code: 'unexpected_failure' }) });
    expect(inserted).toEqual([{ email: 'ivaz@ctvc.pt', action: 'signup', source: 'server', http_status: 500, error_code: 'unexpected_failure', error_message: 'x' }]);
    expect(deletedBefore).toHaveLength(1);
    const ageDays = (Date.now() - Date.parse(deletedBefore[0])) / 86_400_000;
    expect(Math.round(ageDays)).toBe(AUTH_FAILURE_RETENTION_DAYS);
  });
  it('an empty email records nothing', async () => {
    const { admin, inserted } = fakeAdmin();
    await recordAuthEmailFailure(admin, { email: '   ', action: 'recover', source: 'browser' });
    expect(inserted).toEqual([]);
  });
  it('never throws, whatever goes wrong while recording', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordAuthEmailFailure(fakeAdmin({ insertError: 'permission denied' }).admin, { email: 'a@b.co', action: 'signup', source: 'server' })).resolves.toBeUndefined();
    await expect(recordAuthEmailFailure(fakeAdmin({ throws: true }).admin, { email: 'a@b.co', action: 'signup', source: 'server' })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
