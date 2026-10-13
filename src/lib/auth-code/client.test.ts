// Prompt 911 — the browser side of the code registration, with fetch replaced: one test per outcome a page can meet, and the
// payload each of the three sign-up paths sends. No outcome may ever carry a raw body.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_TEXT, SEND_FAILED_TEXT } from '@/lib/auth-errors';
import { registerWithCode, reportAuthEmailFailure, resendRegistrationCode, verifyRegistrationCodeRequest } from './client';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

const reply = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce({ status, ok: status < 400, json: async () => body });
const sentBody = (n = 0) => JSON.parse(fetchMock.mock.calls[n][1].body as string);

describe('registerWithCode', () => {
  it('founder sign-up: sends the form profile, no intent', async () => {
    reply(200, { ok: true, message: 'We sent a code to a@b.co.', resendAfterSeconds: 60 });
    const r = await registerWithCode({ email: 'a@b.co', password: 'Correct-Horse-9!', profile: { fullName: 'Ana', startup: 'Acme', country: 'PT', role: 'CEO' } });
    expect(r).toEqual({ kind: 'sent', message: 'We sent a code to a@b.co.', resendAfterSeconds: 60 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth-code/register');
    expect(sentBody()).toMatchObject({ email: 'a@b.co', fullName: 'Ana', startup: 'Acme', country: 'PT', role: 'CEO' });
    expect(sentBody().intent).toBeUndefined();
  });

  it('team invite: only the email and the password (an invitee has no profile)', async () => {
    reply(200, { ok: true });
    await registerWithCode({ email: 'inv@b.co', password: 'Correct-Horse-9!' });
    expect(sentBody()).toMatchObject({ email: 'inv@b.co', fullName: '', startup: '', country: '', role: '' });
  });

  it('incubator team invite: the account is for an incubator member', async () => {
    reply(200, { ok: true });
    await registerWithCode({ email: 'm@b.co', password: 'Correct-Horse-9!', intent: 'incubator_member' });
    expect(sentBody().intent).toBe('incubator_member');
  });

  it('AUTH_CODE_MODE=off (404) is "off", so the page falls back to the link flow', async () => {
    reply(404, { ok: false });
    expect(await registerWithCode({ email: 'a@b.co', password: 'x' })).toEqual({ kind: 'off' });
  });

  it('an email the sender refused (503) is the readable sentence, not the body', async () => {
    reply(503, { ok: false, code: 'send_failed', error: SEND_FAILED_TEXT });
    const r = await registerWithCode({ email: 'a@b.co', password: 'x' });
    expect(r).toEqual({ kind: 'error', text: SEND_FAILED_TEXT, retryAfterSeconds: undefined });
  });

  it('a 500 whose body is "{}" is still a sentence, never "{}"', async () => {
    reply(500, {});
    const r = await registerWithCode({ email: 'a@b.co', password: 'x' });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') { expect(r.text).toBe(SEND_FAILED_TEXT); expect(r.text).not.toContain('{}'); }
  });

  it('a 429 carries the wait the server asked for', async () => {
    reply(429, { ok: false, code: 'too_early', error: 'Please wait 40 seconds before asking for another code.', retryAfterSeconds: 40 });
    expect(await registerWithCode({ email: 'a@b.co', password: 'x' })).toEqual({ kind: 'error', text: 'Please wait 40 seconds before asking for another code.', retryAfterSeconds: 40 });
  });

  it('no network is a sentence', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await registerWithCode({ email: 'a@b.co', password: 'x' })).toEqual({ kind: 'error', text: NETWORK_TEXT });
  });
});

describe('verify and resend', () => {
  it('the right code returns the account id so the page can finish (provision the org, accept the invite)', async () => {
    reply(200, { ok: true, userId: 'u-1', passwordSet: true });
    expect(await verifyRegistrationCodeRequest({ email: 'a@b.co', code: '123456', password: 'Correct-Horse-9!' })).toEqual({ kind: 'ok', userId: 'u-1', passwordSet: true, warning: undefined });
  });

  it('a wrong code keeps the server sentence with the attempts left', async () => {
    reply(400, { ok: false, code: 'wrong_code', error: "That code didn't work. 4 attempts left.", attemptsLeft: 4 });
    expect(await verifyRegistrationCodeRequest({ email: 'a@b.co', code: '000000', password: 'x' })).toMatchObject({ kind: 'error', text: "That code didn't work. 4 attempts left.", wrongCode: true, needsNewCode: false });
  });

  it('the fifth wrong code needs a new one', async () => {
    reply(400, { ok: false, code: 'new_code_required', error: 'That was the last attempt for this code. Please request a new one.' });
    expect(await verifyRegistrationCodeRequest({ email: 'a@b.co', code: '000000', password: 'x' })).toMatchObject({ kind: 'error', needsNewCode: true });
  });

  it('resend: ok, and a refusal as a sentence', async () => {
    reply(200, { ok: true, resendAfterSeconds: 60 });
    expect(await resendRegistrationCode('a@b.co')).toEqual({ kind: 'sent', resendAfterSeconds: 60 });
    reply(503, { ok: false, code: 'send_failed', error: SEND_FAILED_TEXT });
    expect(await resendRegistrationCode('a@b.co')).toMatchObject({ kind: 'error', text: SEND_FAILED_TEXT });
  });
});

describe('reportAuthEmailFailure', () => {
  it('sends the action and what Supabase answered, and never throws', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await reportAuthEmailFailure({ email: 'a@b.co', action: 'recover', error: Object.assign(new Error('{}'), { status: 500, code: 'unexpected_failure' }) });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth-failures/report');
    expect(sentBody()).toEqual({ email: 'a@b.co', action: 'recover', status: 500, code: 'unexpected_failure', message: '{}' });
    fetchMock.mockImplementation(() => { throw new Error('boom'); });
    await expect(reportAuthEmailFailure({ email: 'a@b.co', action: 'signup', error: {} })).resolves.toBeUndefined();
    fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    await expect(reportAuthEmailFailure({ email: 'a@b.co', action: 'signup', error: {} })).resolves.toBeUndefined();
  });
});
