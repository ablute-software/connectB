// Prompt 911 (B.2) — the public route a page reports a refused authentication email to. It is open (the person is not signed
// in), so what matters is what it refuses to record and that it always answers the same.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const record = vi.fn(async (..._args: unknown[]) => {});
let ipLimited = false;
vi.mock('@/lib/auth-code/failure-log', () => ({ recordAuthEmailFailure: (...a: unknown[]) => record(...a) }));
vi.mock('@/lib/auth-code/supabase-ports', () => ({
  adminClientOrNull: () => ({ rpc: async () => ({ data: ipLimited, error: null }) }),
}));

import { POST } from './route';

const post = (body: unknown) => new NextRequest(new URL('/api/auth-failures/report', 'https://www.sherlockdeal.com'), {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
});
const SEND_FAILURE = { email: 'Pedro.Loureiro@Spaceo.pt', action: 'recover', status: 500, code: 'unexpected_failure', message: 'gomail: could not send email 1: 550' };

beforeEach(() => { record.mockClear(); ipLimited = false; });

describe('the failure report route', () => {
  it('records a send failure reported by the recovery page', async () => {
    const res = await POST(post(SEND_FAILURE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][1]).toMatchObject({ email: 'pedro.loureiro@spaceo.pt', action: 'recover', source: 'browser', status: 500, code: 'unexpected_failure' });
  });

  it('records a passwordless-login failure (investor magic link, guest preview, /pair)', async () => {
    await POST(post({ ...SEND_FAILURE, action: 'login' }));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][1]).toMatchObject({ action: 'login', source: 'browser' });
  });

  it('records a rate limit too', async () => {
    await POST(post({ ...SEND_FAILURE, status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }));
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('ignores anything that is not an outage: a wrong password is not a send failure', async () => {
    await POST(post({ email: 'a@b.co', action: 'recover', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }));
    expect(record).not.toHaveBeenCalled();
  });

  it('ignores an action it does not know and an email that is not one', async () => {
    await POST(post({ ...SEND_FAILURE, action: 'delete_everything' }));
    await POST(post({ ...SEND_FAILURE, email: 'not-an-email' }));
    await POST(post({}));
    expect(record).not.toHaveBeenCalled();
  });

  it('cannot be used to fill the table: over its IP limit it drops silently', async () => {
    ipLimited = true;
    const res = await POST(post(SEND_FAILURE));
    expect(res.status).toBe(200);
    expect(record).not.toHaveBeenCalled();
  });

  it('answers the same 200 on every branch, so it says nothing about anything', async () => {
    const answers = await Promise.all([post(SEND_FAILURE), post({}), post({ ...SEND_FAILURE, status: 400, code: 'x', message: 'y' })].map(async (r) => (await POST(r)).json()));
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
  });
});
