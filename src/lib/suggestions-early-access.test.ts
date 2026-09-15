import { describe, expect, it } from 'vitest';
import { EARLY_ACCESS_COMPANY_LIMIT, isAmongFirstCompanies, rankCompaniesByCreation, type CompanyCreationRecord } from './suggestions-early-access';

describe('rankCompaniesByCreation — pure ranking (Prompt 703)', () => {
  it('sorts oldest first, across both kinds together', () => {
    const records: CompanyCreationRecord[] = [
      { kind: 'org', id: 'o2', createdAt: '2026-08-10T00:00:00Z' },
      { kind: 'investor', id: 'i1', createdAt: '2026-07-01T00:00:00Z' },
      { kind: 'org', id: 'o1', createdAt: '2026-07-21T00:00:00Z' },
    ];
    expect(rankCompaniesByCreation(records).map((r) => r.id)).toEqual(['i1', 'o1', 'o2']);
  });

  it('does not mutate its input', () => {
    const records: CompanyCreationRecord[] = [
      { kind: 'org', id: 'o2', createdAt: '2026-08-10T00:00:00Z' },
      { kind: 'org', id: 'o1', createdAt: '2026-07-21T00:00:00Z' },
    ];
    const copy = [...records];
    rankCompaniesByCreation(records);
    expect(records).toEqual(copy);
  });
});

describe('isAmongFirstCompanies (Prompt 703)', () => {
  const ranked: CompanyCreationRecord[] = rankCompaniesByCreation([
    { kind: 'org', id: 'o1', createdAt: '2026-07-01T00:00:00Z' },
    { kind: 'investor', id: 'i1', createdAt: '2026-07-02T00:00:00Z' },
    { kind: 'org', id: 'o2', createdAt: '2026-07-03T00:00:00Z' },
  ]);

  it('true for a company inside the limit', () => {
    expect(isAmongFirstCompanies(ranked, { kind: 'org', id: 'o1' }, 2)).toBe(true);
  });

  it('false for a company at or past the limit', () => {
    expect(isAmongFirstCompanies(ranked, { kind: 'org', id: 'o2' }, 2)).toBe(false);
  });

  it('false for a company not in the list at all', () => {
    expect(isAmongFirstCompanies(ranked, { kind: 'org', id: 'not-there' }, 100)).toBe(false);
  });

  it('an org and an investor firm sharing the same uuid never collide — kind is part of identity', () => {
    const collision: CompanyCreationRecord[] = [
      { kind: 'org', id: 'same-id', createdAt: '2026-07-01T00:00:00Z' },
    ];
    expect(isAmongFirstCompanies(collision, { kind: 'investor', id: 'same-id' }, 100)).toBe(false);
  });

  it('the default limit is 100, per Nuno\'s own instruction', () => {
    expect(EARLY_ACCESS_COMPANY_LIMIT).toBe(100);
  });
});
