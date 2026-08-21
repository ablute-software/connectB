// Prompt 303 — regression test for the case-sensitivity bug in
// isExcludedOrgName: String.prototype.startsWith is case-sensitive, but
// CLAUDE.md documents the real fixture convention as lowercase "zz-test-"
// and says so explicitly ("case-insensitive"). A fixture named with that
// exact documented convention must be excluded, in any capitalization.
import { describe, expect, it } from 'vitest';
import { isExcludedOrgName, TEST_ORG_NAME_PREFIX, QA_FIXTURE_ENTITY_NAME } from './analytics-events';

describe('isExcludedOrgName', () => {
  it('excludes the exact-case prefix (pre-existing behavior)', () => {
    expect(isExcludedOrgName(`${TEST_ORG_NAME_PREFIX}-whatever`)).toBe(true);
  });

  it('excludes the documented lowercase convention — the bug this fixes', () => {
    expect(isExcludedOrgName('zz-test-p296-revenue-check')).toBe(true);
  });

  it('excludes any other capitalization variant too', () => {
    expect(isExcludedOrgName('Zz-Test-some-fixture')).toBe(true);
    expect(isExcludedOrgName('ZZ-test-MixedCase')).toBe(true);
  });

  it('excludes the fixed QA fixture entity by exact match', () => {
    expect(isExcludedOrgName(QA_FIXTURE_ENTITY_NAME)).toBe(true);
  });

  it('never excludes a real org name that merely contains "test" elsewhere', () => {
    expect(isExcludedOrgName('Testimony Ventures')).toBe(false);
    expect(isExcludedOrgName('ablute_')).toBe(false);
  });

  it('handles null/undefined without throwing', () => {
    expect(isExcludedOrgName(null)).toBe(false);
    expect(isExcludedOrgName(undefined)).toBe(false);
  });
});
