import { describe, expect, it } from 'vitest';
import { findMatchingMarketCompany } from './market-companies-dedup';

const EXISTING = [
  { id: 'a', name: 'Acme Health', domain: 'acmehealth.com' },
  { id: 'b', name: 'Beta Diagnostics', domain: null },
];

describe('findMatchingMarketCompany — procurar antes de criar', () => {
  it('encontra por domínio primeiro, case-insensitive', () => {
    expect(findMatchingMarketCompany({ name: 'Acme Health Inc.', domain: 'AcmeHealth.com' }, EXISTING)?.id).toBe('a');
  });

  it('sem domínio a bater, encontra por nome, case-insensitive', () => {
    expect(findMatchingMarketCompany({ name: 'beta diagnostics' }, EXISTING)?.id).toBe('b');
  });

  it('domínio bate uma linha diferente do nome — o domínio ganha', () => {
    const existing = [...EXISTING, { id: 'c', name: 'Acme Health', domain: 'acme-health-rebrand.com' }];
    expect(findMatchingMarketCompany({ name: 'Acme Health', domain: 'acmehealth.com' }, existing)?.id).toBe('a');
  });

  it('nada bate — null, nunca inventa uma correspondência', () => {
    expect(findMatchingMarketCompany({ name: 'Totally New Co', domain: 'newco.example' }, EXISTING)).toBeNull();
  });
});
