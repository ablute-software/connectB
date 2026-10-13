// Prompt 911 (B.1) — no authentication screen may ever show an object, JSON or `{}`. Every shape of error that reaches the
// screens is fed through the one function that writes the sentence.
import { describe, expect, it } from 'vitest';
import {
  AUTH_SUPPORT_EMAIL, EXPIRED_CODE_TEXT, GENERIC_TEXT, NETWORK_TEXT, RATE_LIMITED_TEXT, SEND_FAILED_TEXT, WRONG_CODE_TEXT,
  authErrorText, clipForLog, describeAuthError,
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
  it('an email that could not be sent: try again in a few minutes, and who to write to', () => {
    for (const e of [SMTP_500, SMTP_500_REAL, { status: 500 }, { code: 'unexpected_failure' }, new Error('gomail: could not send email 1: 550')]) {
      const info = describeAuthError(e);
      expect(info.kind).toBe('send_failed');
      expect(info.text).toBe(SEND_FAILED_TEXT);
    }
    expect(SEND_FAILED_TEXT).toContain('try again in a few minutes');
    expect(SEND_FAILED_TEXT).toContain(AUTH_SUPPORT_EMAIL);
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
    expect(authErrorText({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }, { serverText: 'Invalid login credentials' })).toBe('Invalid login credentials');
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
