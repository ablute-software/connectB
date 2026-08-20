import { describe, it, expect } from 'vitest';
import { hasDomainMismatch, emailDomainOf, suggestDomainFix } from './domain-mismatch';

describe('hasDomainMismatch', () => {
  it('is true when email_domain does not appear in website (Nalka case)', () => {
    expect(hasDomainMismatch('https://nalka.com', 'nalkainvest.com')).toBe(true);
  });

  it('is false when email_domain appears as a substring of website', () => {
    expect(hasDomainMismatch('https://bynd.vc', 'bynd.vc')).toBe(false);
    expect(hasDomainMismatch('https://www.bynd.vc/team', 'bynd.vc')).toBe(false);
  });

  it('is false when either side is missing', () => {
    expect(hasDomainMismatch(null, 'nalkainvest.com')).toBe(false);
    expect(hasDomainMismatch('https://nalka.com', null)).toBe(false);
    expect(hasDomainMismatch(undefined, undefined)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(hasDomainMismatch('https://Nalka.COM', 'NALKA.com')).toBe(false);
  });
});

describe('emailDomainOf', () => {
  it('extracts the domain after @', () => {
    expect(emailDomainOf('info@33n.vc')).toBe('33n.vc');
    expect(emailDomainOf('pitch@ipqcap.com')).toBe('ipqcap.com');
  });

  it('returns null for missing, malformed, or trailing-@ input', () => {
    expect(emailDomainOf(null)).toBeNull();
    expect(emailDomainOf(undefined)).toBeNull();
    expect(emailDomainOf('not-an-email')).toBeNull();
    expect(emailDomainOf('user@')).toBeNull();
  });
});

describe('suggestDomainFix', () => {
  it('suggests the email domain when it disagrees with email_domain (33N case)', () => {
    // 33N: email_domain wrongly set to gmail.com, but the real email is info@33n.vc.
    expect(suggestDomainFix('info@33n.vc', 'gmail.com')).toEqual({ kind: 'suggest_domain', domain: '33n.vc' });
  });

  it('flags probably_intentional when email domain matches email_domain (Crista Galli case)', () => {
    // Crista Galli: pitch@ipqcap.com, email_domain already ipqcap.com — agrees with
    // each other even though neither matches the entity's own website.
    expect(suggestDomainFix('pitch@ipqcap.com', 'ipqcap.com')).toEqual({ kind: 'probably_intentional' });
    expect(suggestDomainFix('pitch@IPQCap.com', 'ipqcap.com')).toEqual({ kind: 'probably_intentional' });
  });

  it('has no suggestion when there is no email to compare against', () => {
    expect(suggestDomainFix(null, 'capitalt.com')).toEqual({ kind: 'none' });
    expect(suggestDomainFix(undefined, 'capitalt.com')).toEqual({ kind: 'none' });
  });
});
