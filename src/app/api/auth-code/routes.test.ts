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

// Prompt 911: the code is how EVERYBODY registers now. Only an explicit AUTH_CODE_MODE=off is the emergency brake.
describe('AUTH_CODE_MODE=off (the emergency brake): the routes do not exist', () => {
  beforeEach(() => { process.env.AUTH_CODE_MODE = 'off'; });
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

describe('the default (variable unset) is ON: every email may register with a code', () => {
  it('lets any email through, and passes on only what the route is meant to carry', async () => {
    const res = await register(post('/api/auth-code/register', { ...FORM, email: 'stranger@example.com', intent: 'incubator_member', strict: false }));
    expect(res.status).toBe(200);
    const [, input] = requestCode.mock.calls[0];
    expect(input).toMatchObject({ email: 'stranger@example.com', ctx: { intent: 'incubator_member' }, strict: false });
  });
  it('ignores an intent it does not know (the browser cannot make an account something else) and defaults to lenient', async () => {
    await register(post('/api/auth-code/register', { ...FORM, intent: 'platform_admin' }));
    const [, input] = requestCode.mock.calls[0];
    expect(input.ctx).toEqual({ intent: null, redirectTo: 'https://www.sherlockdeal.com/' });
    expect(input.strict).toBe(false);
  });
  it('hands the service the full emailRedirectTo of the path that registered: origin + a validated path, the platform by default', async () => {
    await register(post('/api/auth-code/register', { ...FORM, redirectPath: '/invite/abc' }));
    expect(requestCode.mock.calls[0][1].ctx.redirectTo).toBe('https://www.sherlockdeal.com/invite/abc');
    await register(post('/api/auth-code/register', { ...FORM }));
    expect(requestCode.mock.calls[1][1].ctx.redirectTo).toBe('https://www.sherlockdeal.com/');
    // a path that is not a plain path of this site is ignored, never followed
    await register(post('/api/auth-code/register', { ...FORM, redirectPath: 'https://evil.example/x' }));
    expect(requestCode.mock.calls[2][1].ctx.redirectTo).toBe('https://www.sherlockdeal.com/');
  });

  it('a resend carries the same redirect, so the new email returns to the same place', async () => {
    await resend(post('/api/auth-code/resend', { email: FORM.email, redirectPath: '/call/x/form/3' }));
    expect(requestCode.mock.calls[0][1].ctx.redirectTo).toBe('https://www.sherlockdeal.com/call/x/form/3');
  });

  it('only the 904 test page asks for the strict check', async () => {
    await register(post('/api/auth-code/register', { ...FORM, strict: true }));
    expect(requestCode.mock.calls[0][1].strict).toBe(true);
    await verify(post('/api/auth-code/verify', { ...FORM, code: '123456', strict: true }));
    expect(verifyRegistrationCode.mock.calls[0][1].strict).toBe(true);
  });
});

// Production had AUTH_CODE_MODE=allowlist set by the 904 test; since 911 that value is retired and simply means on, for everybody.
describe('the retired "allowlist" value (production had it set) is just ON', () => {
  beforeEach(() => { process.env.AUTH_CODE_MODE = 'allowlist'; process.env.AUTH_CODE_TEST_EMAILS = 'ana@example.com'; });

  it('lets an email through (normalised) and passes the client IP and the profile on', async () => {
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

  it('lets an email that was NOT on the old list through too: the code is for everybody', async () => {
    const res = await register(post('/api/auth-code/register', { ...FORM, email: 'stranger@example.com' }));
    expect(res.status).toBe(200);
    expect(requestCode).toHaveBeenCalledTimes(1);
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

  it('survives a body that is not JSON (it reaches the service as an empty email, which the service refuses — never a crash)', async () => {
    const req = new NextRequest(new URL('/api/auth-code/register', 'https://www.sherlockdeal.com'), { method: 'POST', body: 'nope' });
    expect((await register(req)).status).toBeLessThan(500);
    expect(requestCode.mock.calls[0][1]).toMatchObject({ email: '' });
  });
});
