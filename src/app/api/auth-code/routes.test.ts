// Prompt 904 Part B — the routes are thin; what matters here is the gate in front of them and
// that they hand the service the right things. The service itself is covered by
// src/lib/auth-code/service.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requestCode = vi.fn();
const verifyRegistrationCode = vi.fn();

vi.mock('@/lib/auth-code/supabase-ports', () => ({
  adminClientOrNull: () => ({}),
  makeSupabasePorts: () => ({ marker: 'ports' }),
}));
vi.mock('@/lib/auth-code/service', () => ({
  requestCode: (...a: unknown[]) => requestCode(...a),
  verifyRegistrationCode: (...a: unknown[]) => verifyRegistrationCode(...a),
}));

import { POST as register } from './register/route';
import { POST as resend } from './resend/route';
import { POST as verify } from './verify/route';

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, 'https://www.sherlockdeal.com'), {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
  });
}

const FORM = { email: ' Ana@Example.com ', fullName: 'Ana', startup: 'S', country: 'PT', role: 'CEO', password: 'Correct-Horse-9!' };

beforeEach(() => {
  requestCode.mockReset().mockResolvedValue({ status: 200, body: { ok: true } });
  verifyRegistrationCode.mockReset().mockResolvedValue({ status: 200, body: { ok: true, passwordSet: true } });
  delete process.env.AUTH_CODE_MODE;
  delete process.env.AUTH_CODE_TEST_EMAILS;
});
afterEach(() => { delete process.env.AUTH_CODE_MODE; delete process.env.AUTH_CODE_TEST_EMAILS; });

describe('the switch is off by default: the routes do not exist', () => {
  it.each([
    ['register', () => register(post('/api/auth-code/register', FORM))],
    ['resend', () => resend(post('/api/auth-code/resend', { email: FORM.email }))],
    ['verify', () => verify(post('/api/auth-code/verify', { ...FORM, code: '123456' }))],
  ])('%s answers 404 and touches nothing', async (_n, call) => {
    const res = await call();
    expect(res.status).toBe(404);
    expect(requestCode).not.toHaveBeenCalled();
    expect(verifyRegistrationCode).not.toHaveBeenCalled();
  });
});

describe('allowlist mode', () => {
  beforeEach(() => { process.env.AUTH_CODE_MODE = 'allowlist'; process.env.AUTH_CODE_TEST_EMAILS = 'ana@example.com'; });

  it('lets a listed email through (normalised) and passes the client IP and the profile on', async () => {
    const res = await register(post('/api/auth-code/register', FORM, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }));
    expect(res.status).toBe(200);
    expect(requestCode).toHaveBeenCalledTimes(1);
    const [, input, opts] = requestCode.mock.calls[0];
    expect(input).toMatchObject({
      email: 'ana@example.com', ip: '203.0.113.9', password: 'Correct-Horse-9!',
      profile: { fullName: 'Ana', startup: 'S', country: 'PT', role: 'CEO' },
    });
    expect(opts).toEqual({ allowCreate: true });
  });

  it('refuses an unlisted email with 404, without calling the service', async () => {
    const res = await register(post('/api/auth-code/register', { ...FORM, email: 'stranger@example.com' }));
    expect(res.status).toBe(404);
    expect(requestCode).not.toHaveBeenCalled();
  });

  it('resend never creates an account', async () => {
    await resend(post('/api/auth-code/resend', { email: 'ana@example.com' }));
    expect(requestCode.mock.calls[0][2]).toEqual({ allowCreate: false });
  });

  it('verify strips spaces from the code and forwards the service status', async () => {
    verifyRegistrationCode.mockResolvedValue({ status: 400, body: { ok: false, code: 'wrong_code', attemptsLeft: 4 } });
    const res = await verify(post('/api/auth-code/verify', { ...FORM, code: '123 456' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'wrong_code', attemptsLeft: 4 });
    expect(verifyRegistrationCode.mock.calls[0][1]).toMatchObject({ email: 'ana@example.com', code: '123456' });
  });

  it('survives a body that is not JSON (404 for the empty email, never a crash)', async () => {
    const req = new NextRequest(new URL('/api/auth-code/register', 'https://www.sherlockdeal.com'), { method: 'POST', body: 'nope' });
    expect((await register(req)).status).toBe(404);
  });
});
