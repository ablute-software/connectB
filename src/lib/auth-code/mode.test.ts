// Prompt 904 Part B — the switch in front of the routes. Default must be closed.
import { describe, expect, it } from 'vitest';
import { authCodeAllows, authCodeMode, authCodeTestEmails } from './mode';
import { codeSentMessage, isValidCode, isValidEmailShape, normalizeEmail, readProfile, sanitizeCodeInput } from './policy';

describe('AUTH_CODE_MODE', () => {
  it('is off when unset, empty or unrecognised — and off allows nobody', () => {
    for (const v of [undefined, '', 'maybe', 'true', 'onn']) {
      const env = { AUTH_CODE_MODE: v };
      expect(authCodeMode(env)).toBe('off');
      expect(authCodeAllows('anyone@example.com', env)).toBe(false);
    }
  });

  it('tolerates case and stray spaces in the value', () => {
    expect(authCodeMode({ AUTH_CODE_MODE: ' ON ' })).toBe('on');
    expect(authCodeMode({ AUTH_CODE_MODE: 'Allowlist' })).toBe('allowlist');
  });

  it('allowlist lets in only the listed emails, case-insensitively', () => {
    const env = { AUTH_CODE_MODE: 'allowlist', AUTH_CODE_TEST_EMAILS: ' Nuno@Example.com , other@example.com ' };
    expect(authCodeTestEmails(env)).toEqual(['nuno@example.com', 'other@example.com']);
    expect(authCodeAllows('NUNO@example.com', env)).toBe(true);
    expect(authCodeAllows('stranger@example.com', env)).toBe(false);
  });

  it('an empty allowlist lets nobody in', () => {
    expect(authCodeAllows('a@example.com', { AUTH_CODE_MODE: 'allowlist' })).toBe(false);
  });

  it('on lets everybody in', () => {
    expect(authCodeAllows('a@example.com', { AUTH_CODE_MODE: 'on' })).toBe(true);
  });
});

describe('input rules', () => {
  it('normalises and validates emails', () => {
    expect(normalizeEmail('  A@B.com ')).toBe('a@b.com');
    expect(normalizeEmail(42)).toBe('');
    expect(isValidEmailShape('a@b.co')).toBe(true);
    for (const bad of ['', 'a', 'a@b', 'a b@c.com', '@c.com']) expect(isValidEmailShape(bad)).toBe(false);
  });

  it('a code is exactly six digits', () => {
    expect(isValidCode('123456')).toBe(true);
    for (const bad of ['12345', '1234567', '12 456', 'abcdef', 123456, null]) expect(isValidCode(bad)).toBe(false);
  });

  it('the code box keeps digits only (a pasted "123 456" works) and caps at six', () => {
    expect(sanitizeCodeInput('123 456')).toBe('123456');
    expect(sanitizeCodeInput('12-34-56-78')).toBe('123456');
  });

  it('trims and caps profile fields', () => {
    expect(readProfile({ fullName: '  Ana ', startup: 'S', country: 'PT', role: 'x'.repeat(500) }).role).toHaveLength(120);
    expect(readProfile({}).fullName).toBe('');
  });

  it('the confirmation sentence is the one the spec asks for', () => {
    expect(codeSentMessage('a@b.com')).toBe('We sent a code to a@b.com.');
  });
});
