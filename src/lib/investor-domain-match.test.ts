import { describe, expect, it } from 'vitest';
import { checkInvestorDomainMatch, domainMatchesEntity, isAutoEligible, resolveClaimedEntity } from './investor-domain-match';
import type { CatalogRow } from './catalog-dedupe';

const LINCE: CatalogRow = { id: 'e1', name: 'Lince Capital', website: 'https://www.lincecp.com' };
const NO_WEBSITE: CatalogRow = { id: 'e2', name: 'Stealth Fund', website: null };
const ENTITIES = [LINCE, NO_WEBSITE];

describe('domainMatchesEntity', () => {
  it('matches an exact domain', () => {
    expect(domainMatchesEntity('lincecp.com', 'lincecp.com')).toBe(true);
  });
  it('matches a subdomain of the entity root domain', () => {
    expect(domainMatchesEntity('investors.lincecp.com', 'lincecp.com')).toBe(true);
  });
  it('rejects an unrelated domain', () => {
    expect(domainMatchesEntity('gmail.com', 'lincecp.com')).toBe(false);
  });
  it('does not match the entity domain being a subdomain of the email domain (one-directional)', () => {
    expect(domainMatchesEntity('cp.com', 'lincecp.com')).toBe(false);
  });
});

describe('resolveClaimedEntity', () => {
  it('resolves an exact (normalized) name match', () => {
    expect(resolveClaimedEntity('Lince Capital', ENTITIES)?.id).toBe('e1');
  });
  it('is case/diacritic/legal-suffix insensitive via normalizeName', () => {
    expect(resolveClaimedEntity('lince', ENTITIES)?.id).toBe('e1');
  });
  it('returns null for no match', () => {
    expect(resolveClaimedEntity('Totally Unknown Firm', ENTITIES)).toBeNull();
  });
  it('returns null for an empty/blank firm name', () => {
    expect(resolveClaimedEntity('  ', ENTITIES)).toBeNull();
    expect(resolveClaimedEntity(null, ENTITIES)).toBeNull();
  });
  it('returns null when two distinct entities normalize to the same name (ambiguous)', () => {
    const dup = [LINCE, { id: 'e3', name: 'Lince Capital', website: 'https://other.example' }];
    expect(resolveClaimedEntity('Lince Capital', dup)).toBeNull();
  });
});

describe('checkInvestorDomainMatch', () => {
  it('positive case: email on the claimed entity\'s domain → match, auto-eligible', () => {
    const v = checkInvestorDomainMatch({ email: 'nuno.ber@lincecp.com', firmName: 'Lince Capital', entities: ENTITIES });
    expect(v).toEqual({ kind: 'match', entityId: 'e1', entityName: 'Lince Capital', entityDomain: 'lincecp.com', emailDomain: 'lincecp.com' });
    expect(isAutoEligible(v)).toBe(true);
  });

  it('positive case: subdomain of the entity domain also matches', () => {
    const v = checkInvestorDomainMatch({ email: 'nuno@investors.lincecp.com', firmName: 'Lince Capital', entities: ENTITIES });
    expect(v.kind).toBe('match');
    expect(isAutoEligible(v)).toBe(true);
  });

  it('negative case: Gmail address → generic_email, never auto-eligible', () => {
    const v = checkInvestorDomainMatch({ email: 'nuno.ber@gmail.com', firmName: 'Lince Capital', entities: ENTITIES });
    expect(v).toEqual({ kind: 'generic_email', emailDomain: 'gmail.com' });
    expect(isAutoEligible(v)).toBe(false);
  });

  it('negative case: real-looking but wrong company domain → mismatch, manual review', () => {
    const v = checkInvestorDomainMatch({ email: 'nuno@othercompany.com', firmName: 'Lince Capital', entities: ENTITIES });
    expect(v).toEqual({ kind: 'mismatch', entityId: 'e1', entityName: 'Lince Capital', entityDomain: 'lincecp.com', emailDomain: 'othercompany.com' });
    expect(isAutoEligible(v)).toBe(false);
  });

  it('entity has no website on file → no_entity_website, always manual (never passes by omission)', () => {
    const v = checkInvestorDomainMatch({ email: 'someone@stealthfund.com', firmName: 'Stealth Fund', entities: ENTITIES });
    expect(v).toEqual({ kind: 'no_entity_website', entityId: 'e2', entityName: 'Stealth Fund', emailDomain: 'stealthfund.com' });
    expect(isAutoEligible(v)).toBe(false);
  });

  it('firm name does not resolve to any catalog entity → no_entity_match, manual review', () => {
    const v = checkInvestorDomainMatch({ email: 'someone@example.com', firmName: 'Nonexistent Ventures', entities: ENTITIES });
    expect(v.kind).toBe('no_entity_match');
    expect(isAutoEligible(v)).toBe(false);
  });

  it('resolves an alias to its entity before comparing domains', () => {
    const aliases = [{ catalog_id: 'e1', alias: 'LinceCP' }];
    const v = checkInvestorDomainMatch({ email: 'x@lincecp.com', firmName: 'LinceCP', entities: ENTITIES, aliases });
    expect(v.kind).toBe('match');
  });
});
