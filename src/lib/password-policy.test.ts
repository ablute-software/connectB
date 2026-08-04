import { describe, expect, it } from 'vitest';
import { checkPassword, PASSWORD_MIN_LENGTH } from './password-policy';

describe('checkPassword', () => {
  it('rejects a password missing every requirement', () => {
    const r = checkPassword('short');
    expect(r).toEqual({ minLength: false, hasUpper: false, hasLower: true, hasDigit: false, hasSpecial: false, valid: false });
  });

  it('flags length correctly at the boundary', () => {
    expect(checkPassword('A1!aaaaaaa').minLength).toBe(true); // exactly 10
    expect(checkPassword('A1!aaaaaa').minLength).toBe(false); // 9
  });

  it('requires at least one of each character class', () => {
    expect(checkPassword('alllowercase123!').hasUpper).toBe(false);
    expect(checkPassword('ALLUPPERCASE123!').hasLower).toBe(false);
    expect(checkPassword('NoDigitsHere!!!!').hasDigit).toBe(false);
    expect(checkPassword('NoSpecial1234567').hasSpecial).toBe(false);
  });

  it('accepts a password meeting every requirement', () => {
    const r = checkPassword('Str0ng!Passw0rd');
    expect(r.valid).toBe(true);
    expect(r).toEqual({ minLength: true, hasUpper: true, hasLower: true, hasDigit: true, hasSpecial: true, valid: true });
  });

  it('exports the documented minimum length', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
  });
});
