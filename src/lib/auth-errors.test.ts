// Prompt 911 (B.1) — no authentication screen may ever show an object, JSON or `{}`. Every shape of error that reaches the
// screens is fed through the one function that writes the sentence.
import { describe, expect, it } from 'vitest';
import {
  CONTACT_PATH, CONTACT_PHRASE, EXPIRED_CODE_TEXT, GENERIC_TEXT, NETWORK_TEXT, RATE_LIMITED_TEXT, SEND_FAILED_TEXT, WRONG_CODE_TEXT,
  authErrorText, clipForLog, describeAuthError, EMAIL_INCOMPLETE_TEXT, NEW_CODE_NOTE, emailProblem, newReference, rateLimitedText,
} from './auth-errors';

// What supabase-js hands back when the Auth SMTP refuses (12/10/2026): an AuthApiError-shaped object.
const SMTP_500 = Object.assign(new Error('{}'), { name: 'AuthApiError', status: 500, code: 'unexpected_failure' });
const SMTP_500_REAL = Object.assign(new Error('Error sending confirmation email'), { name: 'AuthApiError', status: 500, code: 'unexpected_failure' });

/** Everything a screen could be handed. */
const SHAPES: [string, unknown][] = [
  ['an AuthApiError whose message is "{}"', SMTP_500],
  ['an AuthApiError with the real text', SMTP_500_REAL],
  ['the gomail text from the Auth logs', new Error('gomail: could not send email 1: 550 "The sherlockdeal.com domain is not verified."')],
  ['an empty object', {}],
  ['the string "{}"', '{}'],
  ['an object whose error is an object', { error: {} }],
  ['an object whose error is { message: "" }', { error: { message: '' } }],
  ['null', null],
  ['undefined', undefined],
  ['a number', 500],
  ['an array', []],
  ['"[object Object]"', '[object Object]'],
  ['a 429', { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }],
  ['a network failure', new TypeError('Failed to fetch')],
];

describe('never a raw object', () => {
  it.each(SHAPES)('%s becomes a sentence', (_name, err) => {
    const t = authErrorText(err);
    expect(typeof t).toBe('string');
    expect(t.length).toBeGreaterThan(10);
    expect(t).not.toContain('{}');
    expect(t).not.toContain('[object');
    expect(t).not.toMatch(/gomail|550|resend\.com|undefined|null/);
  });
});

describe('the sentences (spec B.1)', () => {
  it('an email that could not be sent: try again in a few minutes, and contact us (a link to the form, never an address)', () => {
    for (const e of [SMTP_500, SMTP_500_REAL, { status: 500 }, { code: 'unexpected_failure' }, new Error('gomail: could not send email 1: 550')]) {
      const info = describeAuthError(e);
      expect(info.kind).toBe('send_failed');
      expect(info.text).toBe(SEND_FAILED_TEXT);
    }
    expect(SEND_FAILED_TEXT).toContain('try again in a few minutes');
    expect(SEND_FAILED_TEXT).toBe("We couldn't send the email right now. Please try again in a few minutes. If it keeps failing, contact us.");
    expect(SEND_FAILED_TEXT).toContain(CONTACT_PHRASE);
    expect(CONTACT_PATH).toBe('/contact');
    // The platform has no public support address, and the owner's inbox must never reach a user.
    expect(SEND_FAILED_TEXT).not.toMatch(/@/);
  });

  it('too many requests: wait a few minutes', () => {
    expect(describeAuthError({ status: 429 })).toMatchObject({ kind: 'rate_limited', text: RATE_LIMITED_TEXT });
    expect(describeAuthError({ code: 'over_email_send_rate_limit' }).kind).toBe('rate_limited');
    expect(RATE_LIMITED_TEXT).toBe('Too many attempts. Please wait a few minutes.');
  });

  it('a wrong or expired code keeps the 904 sentence when the server wrote one', () => {
    const server = "That code didn't work. 3 attempts left.";
    expect(describeAuthError({ code: 'wrong_code' }, { serverText: server })).toMatchObject({ kind: 'wrong_code', text: server });
    expect(describeAuthError({ code: 'wrong_code' }).text).toBe(WRONG_CODE_TEXT);
    expect(describeAuthError({ code: 'otp_expired' }).text).toBe(EXPIRED_CODE_TEXT);
    expect(describeAuthError({ code: 'new_code_required' }, { serverText: 'This code can no longer be used. Please request a new one.' }).text).toContain('no longer be used');
  });

  it('anything else: a generic sentence with the code in small print, never the raw body', () => {
    const t = describeAuthError({ status: 400, code: 'weak_password', message: '' });
    expect(t.kind).toBe('generic');
    expect(t.text).toBe(`${GENERIC_TEXT} (weak_password)`);
    expect(authErrorText({})).toBe(GENERIC_TEXT);
  });

  it('a specific sentence a screen already has (a wrong password, say) is kept, not replaced by the generic one', () => {
    expect(authErrorText({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }, { serverText: 'Invalid login credentials' })).toBe("That email and password don't match. Check them and try again.");
    expect(authErrorText({ status: 400, message: 'Password should be at least 8 characters.' }, { serverText: 'Password should be at least 8 characters.' })).toBe('Password should be at least 8 characters.');
  });

  it('a network failure says so', () => {
    expect(describeAuthError(new TypeError('Failed to fetch'))).toMatchObject({ kind: 'network', text: NETWORK_TEXT });
  });

  it('an empty "{}" serverText is not a sentence', () => {
    expect(authErrorText({ status: 400 }, { serverText: '{}' })).not.toContain('{}');
  });
});

describe('clipForLog', () => {
  it('truncates long provider bodies and drops empties', () => {
    expect(clipForLog('x'.repeat(1000), 10)).toBe('xxxxxxxxxx…');
    expect(clipForLog('  ')).toBeNull();
    expect(clipForLog(undefined)).toBeNull();
  });
});

// Prompt 918 (27/10/2026) — "Set a new password" with no session shows a sentence about the LINK, not Supabase's "Auth session missing!".
describe('a missing session (the recovery link expired or was opened in another browser)', () => {
  it('is recognised however it arrives, and says what happened and what to do', async () => {
    const { isSessionMissing, LINK_EXPIRED_TEXT } = await import('./auth-errors');
    const AuthSessionMissing = Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError', status: 400 });
    expect(isSessionMissing(AuthSessionMissing)).toBe(true);
    expect(isSessionMissing({ message: 'Auth session missing!' })).toBe(true);
    expect(isSessionMissing('auth session missing')).toBe(true);
    expect(isSessionMissing(new Error('Password should be at least 8 characters'))).toBe(false);
    expect(isSessionMissing(null)).toBe(false);
    expect(LINK_EXPIRED_TEXT).toBe('This link has expired or was opened in a different browser. Request a new link.');
    expect(LINK_EXPIRED_TEXT).not.toMatch(/session missing/i);
  });
  it('the page shows that sentence with a button to ask for another link, and leaves every other error as it was', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(`${process.cwd()}/src/app/reset-password/page.tsx`, 'utf8');
    expect(src).toContain('isSessionMissing(error)');
    expect(src).toContain('setMsg(LINK_EXPIRED_TEXT)');
    expect(src).toContain('href="/forgot-password"');
    expect(src).toContain('Request a new link');
    expect(src).toContain('setMsg(authErrorText(error, { serverText: error.message }))');          // everything else: unchanged
  });
});

// Prompt 923 (C) — the messages of the email code, in the person's own words: the wait is counted, an expired or replaced code says what to do, an address that can never work is refused before a code is asked for,
// and a failure nobody can fix carries a reference that is also written to the server's log.
describe('Prompt 923 (C): the messages of the code', () => {
  it('429 over_email_send_rate_limit: "For security, wait N seconds before asking for a new code." with N read from the provider\'s own sentence', () => {
    const err = { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 219 seconds.' };
    expect(describeAuthError(err)).toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 219, text: 'For security, wait 219 seconds before asking for a new code.' });
    expect(rateLimitedText(1)).toBe('For security, wait 1 second before asking for a new code.');
    expect(describeAuthError({ status: 429, retryAfterSeconds: 42 }).text).toBe('For security, wait 42 seconds before asking for a new code.');
    expect(describeAuthError({ status: 429, code: 'over_email_send_rate_limit' }).kind).toBe('rate_limited');                  // no number given: the old sentence, still a rate limit
  });
  it('403 otp_expired: "This code has expired or was replaced by a newer one…"', () => {
    expect(describeAuthError({ status: 403, code: 'otp_expired', message: 'Email link is invalid or has expired' })).toMatchObject({ kind: 'expired_code', text: 'This code has expired or was replaced by a newer one. Use the latest code we sent, or request a new one.' });
    expect(NEW_CODE_NOTE).toContain('replaces the previous one');
  });
  it('an email that cannot be an address: "Check the email address — it looks incomplete." — on the client BEFORE sending and for the provider\'s 500 "Invalid recipient address"', () => {
    for (const bad of ['sherlockdeal.com+aval1@gmail.c', 'nobody', 'a@b', '', '  ', 'two words@x.com', 'a@@b.com', null, undefined, 42]) expect(emailProblem(bad), String(bad)).toBe(EMAIL_INCOMPLETE_TEXT);
    for (const good of ['ana@ablute.pt', ' Ana.Meira+test@Gmail.com ', 'a@b.co']) expect(emailProblem(good), good).toBeNull();
    expect(describeAuthError({ status: 500, code: 'unexpected_failure', message: 'failed to send email: Invalid recipient address' })).toMatchObject({ kind: 'invalid_email', text: EMAIL_INCOMPLETE_TEXT });
    expect(describeAuthError({ status: 400, code: 'email_address_invalid', message: 'Email address "x@y.c" is invalid' }).kind).toBe('invalid_email');
  });
  it('anything else: "Something went wrong. Try again in a minute." with a reference, never the raw body', () => {
    const ref = newReference();
    expect(ref).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(newReference()).not.toBe(ref);
    expect(describeAuthError({ status: 418, message: 'I am a teapot with raw provider text' }, { ref })).toMatchObject({ kind: 'generic', text: `Something went wrong. Try again in a minute. (ref ${ref})`, ref });
    expect(describeAuthError({ status: 418, message: 'raw provider text' }, { ref }).text).not.toContain('raw provider text');
  });
  it('the server route refuses an incomplete address with the same sentence (400), before any code is spent', async () => {
    const { registrationProblem } = await import('./auth-code/policy');
    expect(registrationProblem('x@gmail.c', { fullName: 'Ana', startup: 'Acme', country: 'PT', role: 'CEO' }, 'Abcdef1!xyz')).toBe(EMAIL_INCOMPLETE_TEXT);
  });
});
