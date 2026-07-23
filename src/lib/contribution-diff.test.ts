import { describe, expect, it } from 'vitest';
import { classifyConflict } from './contribution-diff';

describe('classifyConflict', () => {
  it('treats identical values as cosmetic', () => {
    expect(classifyConflict('Porto', 'Porto')).toBe('cosmetic');
  });
  it('treats a case-only difference as cosmetic', () => {
    expect(classifyConflict('Porto', 'porto')).toBe('cosmetic');
  });
  it('treats a diacritics-only difference as cosmetic', () => {
    expect(classifyConflict('São Paulo', 'Sao Paulo')).toBe('cosmetic');
  });
  it('treats curly vs straight quotes as cosmetic', () => {
    expect(classifyConflict('“Founders First”', '"Founders First"')).toBe('cosmetic');
  });
  it('treats whitespace differences as cosmetic', () => {
    expect(classifyConflict('Deep  Tech', 'Deep Tech')).toBe('cosmetic');
  });
  it('treats a country code vs full name as cosmetic', () => {
    expect(classifyConflict('AT', 'Austria')).toBe('cosmetic');
    expect(classifyConflict('pt', 'Portugal')).toBe('cosmetic');
  });
  it('treats a genuinely different value as substantive', () => {
    expect(classifyConflict('Porto', 'Lisbon')).toBe('substantive');
    expect(classifyConflict(500000, 250000)).toBe('substantive');
  });
  it('treats a presence change (null vs value) as substantive', () => {
    expect(classifyConflict(null, 'Porto')).toBe('substantive');
    expect(classifyConflict('Porto', null)).toBe('substantive');
  });
});
