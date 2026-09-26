import { describe, expect, it } from 'vitest';
import {
  formatPeriodDate,
  formatPeriodRange,
  formatEvidenceDate,
  portfolioRelationshipPhrase,
  relationKindLabel,
  researchResultLabel,
  researchScopeLabel,
  roleTypeLabel,
} from './dossier-labels';

describe('roleTypeLabel', () => {
  it('maps known role types', () => {
    expect(roleTypeLabel('employment')).toBe('Employment');
    expect(roleTypeLabel('board_advisory')).toBe('Board / advisory');
  });
  it('returns null for no role type — never invents one', () => {
    expect(roleTypeLabel(null)).toBeNull();
    expect(roleTypeLabel(undefined)).toBeNull();
  });
});

describe('relationKindLabel', () => {
  it('maps the three relation kinds and never upgrades an indirect one', () => {
    expect(relationKindLabel('direct_statement')).toBe('their own statement');
    expect(relationKindLabel('professional_experience')).toBe('professional experience');
    expect(relationKindLabel('indirect_responsibility')).toBe('indirect / portfolio');
  });
});

describe('researchScopeLabel / researchResultLabel', () => {
  it('labels a known scope and falls back to the raw value for an unknown one', () => {
    expect(researchScopeLabel('career')).toBe('Career');
    expect(researchScopeLabel('some_future_scope')).toBe('some_future_scope');
  });
  it('labels all three research results distinctly', () => {
    expect(researchResultLabel('found')).toBe('found');
    expect(researchResultLabel('not_found')).toBe('none found');
    expect(researchResultLabel('not_public')).toBe('not public');
  });
});

describe('formatPeriodDate — never renders more precision than the row has', () => {
  it('exact_day shows the full date', () => {
    expect(formatPeriodDate('2022-03-15', 'exact_day')).toBe('2022-03-15');
  });
  it('month precision shows month/year, never a fabricated day', () => {
    expect(formatPeriodDate('2022-03-01', 'month')).toBe('03/2022');
  });
  it('year precision shows only the year', () => {
    expect(formatPeriodDate('2022-01-01', 'year')).toBe('2022');
  });
  it('approximate precision is marked as such, never shown as exact', () => {
    expect(formatPeriodDate('2022-01-01', 'approximate')).toBe('c. 2022');
  });
  it('a null date returns null regardless of precision', () => {
    expect(formatPeriodDate(null, 'year')).toBeNull();
  });
});

describe('formatPeriodRange', () => {
  it('current role shows "<from> – present", never a fabricated end date', () => {
    expect(formatPeriodRange('2020-01-01', 'year', null, null, true)).toBe('2020 – present');
  });
  it('closed role with both ends shows the full range at each end\'s own precision', () => {
    expect(formatPeriodRange('2018-06-01', 'month', '2021-01-01', 'year', false)).toBe('06/2018 – 2021');
  });
  it('no from date at all (only an end) shows "until <to>"', () => {
    expect(formatPeriodRange(null, null, '2019-01-01', 'year', false)).toBe('until 2019');
  });
  it('neither end known — never silently blank, says so explicitly', () => {
    expect(formatPeriodRange(null, null, null, null, false)).toBe('date not confirmed');
  });
});

describe('portfolioRelationshipPhrase', () => {
  it('states a strong (first-party/curated) source as plain fact', () => {
    expect(portfolioRelationshipPhrase('Investment Manager at Acme', 3)).toBe('Investment Manager at Acme');
  });
  it('hedges a weaker source as an association, never an inferred claim', () => {
    expect(portfolioRelationshipPhrase('Acme', 2)).toBe('publicly associated with: Acme');
  });
  it('treats a missing strength as weak by default (never assumes strong)', () => {
    expect(portfolioRelationshipPhrase('Acme', null)).toBe('publicly associated with: Acme');
  });
});

describe('formatEvidenceDate', () => {
  it('returns the plain date string, unchanged, when present', () => {
    expect(formatEvidenceDate('2024-05-01')).toBe('2024-05-01');
  });
  it('returns null rather than an empty-string placeholder', () => {
    expect(formatEvidenceDate(null)).toBeNull();
  });
});
