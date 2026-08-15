import { describe, expect, it } from 'vitest';
import { canInvestorMessage, resolveFounderEntityToEligibleFirm, type FounderMessageEligibleFirm } from './deal-messages';

describe('canInvestorMessage', () => {
  it('refuses a card that does not exist (not in this investor\'s Pipeline)', () => {
    expect(canInvestorMessage(null)).toBe(false);
    expect(canInvestorMessage(undefined)).toBe(false);
  });

  it('refuses a bare discovery match — no interest expressed, no grant', () => {
    expect(canInvestorMessage({ status: 'open', hasDataRoomAccess: false })).toBe(false);
  });

  it('refuses a passed relationship with no active grant', () => {
    expect(canInvestorMessage({ status: 'passed', hasDataRoomAccess: false })).toBe(false);
  });

  it('allows once interest has been expressed, even without a data-room grant', () => {
    expect(canInvestorMessage({ status: 'interested', hasDataRoomAccess: false })).toBe(true);
  });

  it('allows with an active data-room grant, even before any decision', () => {
    expect(canInvestorMessage({ status: 'open', hasDataRoomAccess: true })).toBe(true);
  });
});

describe('resolveFounderEntityToEligibleFirm', () => {
  const eligible: FounderMessageEligibleFirm[] = [
    { investorCatalogEntityId: 'cat-1', name: 'Point Nine Capital', website: 'https://pointninecap.com' },
    { investorCatalogEntityId: 'cat-2', name: 'Balderton Capital', website: null },
  ];

  it('matches by website domain first, regardless of protocol/www', () => {
    const entity = { name: 'Point Nine (my own CRM name for them)', website: 'www.pointninecap.com' };
    expect(resolveFounderEntityToEligibleFirm(entity, eligible)?.investorCatalogEntityId).toBe('cat-1');
  });

  it('matches a subdomain of the eligible firm\'s own domain', () => {
    const entity = { name: 'unrelated name', website: 'https://vc.pointninecap.com/team' };
    expect(resolveFounderEntityToEligibleFirm(entity, eligible)?.investorCatalogEntityId).toBe('cat-1');
  });

  it('falls back to an exact normalized name match when there is no website', () => {
    const entity = { name: 'balderton capital', website: null };
    expect(resolveFounderEntityToEligibleFirm(entity, eligible)?.investorCatalogEntityId).toBe('cat-2');
  });

  it('falls back to name when the website does not match any eligible firm', () => {
    const entity = { name: 'Balderton Capital', website: 'https://some-unrelated-domain.com' };
    expect(resolveFounderEntityToEligibleFirm(entity, eligible)?.investorCatalogEntityId).toBe('cat-2');
  });

  it('returns null when neither website nor name resolves to an eligible firm', () => {
    const entity = { name: 'Some Random Angel', website: 'https://not-tracked-anywhere.com' };
    expect(resolveFounderEntityToEligibleFirm(entity, eligible)).toBeNull();
  });

  it('returns null against an empty eligible list', () => {
    expect(resolveFounderEntityToEligibleFirm({ name: 'Anyone', website: null }, [])).toBeNull();
  });
});
