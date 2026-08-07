import { describe, it, expect } from 'vitest';
import { registrableDomain, domainsMatch, evaluateClaimDomain, isFreemailDomain, isRoleMailboxEmail } from './investor-entity-claims';

describe('registrableDomain', () => {
  it('resolves a bare domain to itself', () => {
    expect(registrableDomain('northbridge.com')).toBe('northbridge.com');
  });
  it('resolves a subdomain to its eTLD+1', () => {
    expect(registrableDomain('mail.northbridge.com')).toBe('northbridge.com');
    expect(registrableDomain('https://www.northbridge.com/about')).toBe('northbridge.com');
  });
  it('handles multi-label public suffixes correctly (co.uk)', () => {
    expect(registrableDomain('https://someone.co.uk')).toBe('someone.co.uk');
    expect(registrableDomain('https://a.b.someone.co.uk')).toBe('someone.co.uk');
  });
  it('returns null for garbage input', () => {
    expect(registrableDomain(null)).toBeNull();
    expect(registrableDomain('')).toBeNull();
    expect(registrableDomain('not a url')).toBeNull();
  });
});

describe('domainsMatch — exact equality only, never a substring check', () => {
  it('matches identical registrable domains', () => {
    expect(domainsMatch('northbridge.com', 'northbridge.com')).toBe(true);
  });
  it('rejects two different domains', () => {
    expect(domainsMatch('northbridge.com', 'southbridge.com')).toBe(false);
  });
  it('never matches on null', () => {
    expect(domainsMatch(null, 'northbridge.com')).toBe(false);
    expect(domainsMatch('northbridge.com', null)).toBe(false);
    expect(domainsMatch(null, null)).toBe(false);
  });
});

// The test the prompt itself names as the one that decides whether item 1
// passes: "x@evilnorthbridge.com" against catalog entity "northbridge.com"
// must NOT match. A naive `emailDomain.endsWith(entityDomain)` (no dot
// prefix) would incorrectly say yes — "xnorthbridge.com".endsWith("northbridge.com")
// is true in plain JS. This suite proves the actual implementation used
// here (eTLD+1 via psl + exact ===) doesn't make that mistake.
describe('the endsWith impersonation vulnerability — must not reproduce it', () => {
  it('a domain that merely ends with the target string is NOT a match', () => {
    const verdict = evaluateClaimDomain({
      claimantEmail: 'x@evilnorthbridge.com',
      entityWebsite: 'https://northbridge.com',
      entityEmail: null,
    });
    expect(verdict.claimantDomain).toBe('evilnorthbridge.com');
    expect(verdict.entityDomain).toBe('northbridge.com');
    expect(verdict.domainMatch).toBe(false);
  });
  it('a naive endsWith on the raw strings would have said yes (sanity check the attack is real)', () => {
    expect('xnorthbridge.com'.endsWith('northbridge.com')).toBe(true);
  });
  it('a real subdomain of the target DOES match (eTLD+1 equality, not a coincidence)', () => {
    const verdict = evaluateClaimDomain({
      claimantEmail: 'partner@deals.northbridge.com',
      entityWebsite: 'https://northbridge.com',
      entityEmail: null,
    });
    expect(verdict.domainMatch).toBe(true);
    expect(verdict.claimantDomain).toBe('northbridge.com');
  });
});

describe('evaluateClaimDomain', () => {
  it('falls back to entity email domain when website is missing', () => {
    const verdict = evaluateClaimDomain({
      claimantEmail: 'jane@realbridge.vc',
      entityWebsite: null,
      entityEmail: 'partners@realbridge.vc',
    });
    expect(verdict.entityDomain).toBe('realbridge.vc');
    expect(verdict.domainMatch).toBe(true);
  });
  it('never matches when the entity domain on file is a freemail provider, even if the claimant uses the same one', () => {
    const verdict = evaluateClaimDomain({
      claimantEmail: 'someone@gmail.com',
      entityWebsite: null,
      entityEmail: 'firm@gmail.com',
    });
    expect(verdict.entityDomainIsFreemail).toBe(true);
    expect(verdict.domainMatch).toBe(false);
  });
  it('flags a role-mailbox local part even when the domain matches', () => {
    const verdict = evaluateClaimDomain({
      claimantEmail: 'info@northbridge.com',
      entityWebsite: 'https://northbridge.com',
      entityEmail: null,
    });
    expect(verdict.domainMatch).toBe(true);
    expect(verdict.roleMailbox).toBe(true);
  });
  it('no entity domain on file at all → no match, not a crash', () => {
    const verdict = evaluateClaimDomain({ claimantEmail: 'jane@realbridge.vc', entityWebsite: null, entityEmail: null });
    expect(verdict.domainMatch).toBe(false);
    expect(verdict.entityDomain).toBeNull();
  });
});

describe('isFreemailDomain / isRoleMailboxEmail', () => {
  it('recognizes common freemail providers', () => {
    expect(isFreemailDomain('gmail.com')).toBe(true);
    expect(isFreemailDomain('northbridge.com')).toBe(false);
  });
  it('recognizes role-mailbox local parts case-insensitively', () => {
    expect(isRoleMailboxEmail('Info@Northbridge.com')).toBe(true);
    expect(isRoleMailboxEmail('jane.doe@northbridge.com')).toBe(false);
  });
});
