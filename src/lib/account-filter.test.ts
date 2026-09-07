import { describe, expect, it } from 'vitest';
import { matchesAccountFilter } from './account-filter';

describe('matchesAccountFilter', () => {
  const active = { moderationStatus: 'active' as const, isInternal: false };
  const suspended = { moderationStatus: 'suspended' as const, isInternal: false };
  const deleted = { moderationStatus: 'deleted' as const, isInternal: false };
  const internalActive = { moderationStatus: 'active' as const, isInternal: true };

  it("'all' matches every status", () => {
    expect(matchesAccountFilter('all', active)).toBe(true);
    expect(matchesAccountFilter('all', suspended)).toBe(true);
    expect(matchesAccountFilter('all', deleted)).toBe(true);
  });

  it("'active' matches only moderationStatus active", () => {
    expect(matchesAccountFilter('active', active)).toBe(true);
    expect(matchesAccountFilter('active', suspended)).toBe(false);
    expect(matchesAccountFilter('active', deleted)).toBe(false);
  });

  it("'suspended' matches suspended AND deleted — both are off the active roster", () => {
    expect(matchesAccountFilter('suspended', suspended)).toBe(true);
    expect(matchesAccountFilter('suspended', deleted)).toBe(true);
    expect(matchesAccountFilter('suspended', active)).toBe(false);
  });

  it("'internal' matches on isInternal regardless of moderation status", () => {
    expect(matchesAccountFilter('internal', internalActive)).toBe(true);
    expect(matchesAccountFilter('internal', active)).toBe(false);
  });
});
