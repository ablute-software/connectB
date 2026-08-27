import { describe, expect, it } from 'vitest';
import { preferDeclaredList, preferDeclaredValue } from './claimed-investor-profile';

describe('preferDeclaredValue', () => {
  it('prefers the declared value when present', () => {
    expect(preferDeclaredValue('https://declared.vc', 'https://researched.vc')).toBe('https://declared.vc');
  });

  it('falls back to researched when declared is null', () => {
    expect(preferDeclaredValue(null, 'https://researched.vc')).toBe('https://researched.vc');
  });

  it('falls back to researched when declared is undefined', () => {
    expect(preferDeclaredValue(undefined, 'https://researched.vc')).toBe('https://researched.vc');
  });

  it('treats an empty/whitespace declared string as not declared', () => {
    expect(preferDeclaredValue('', 'https://researched.vc')).toBe('https://researched.vc');
    expect(preferDeclaredValue('   ', 'https://researched.vc')).toBe('https://researched.vc');
  });

  it('returns null when neither side has a value', () => {
    expect(preferDeclaredValue(null, null)).toBeNull();
    expect(preferDeclaredValue('', undefined)).toBeNull();
  });

  it('works for numeric fields (ticket size) — zero is a real declared value, not empty', () => {
    expect(preferDeclaredValue(0, 50000)).toBe(0);
    expect(preferDeclaredValue(250000, 50000)).toBe(250000);
    expect(preferDeclaredValue(null, 50000)).toBe(50000);
  });
});

describe('preferDeclaredList', () => {
  it('prefers the declared list when non-empty', () => {
    expect(preferDeclaredList(['fintech'], ['healthtech', 'deeptech'])).toEqual(['fintech']);
  });

  it('falls back to researched when declared is an empty array', () => {
    expect(preferDeclaredList([], ['healthtech', 'deeptech'])).toEqual(['healthtech', 'deeptech']);
  });

  it('falls back to researched when declared is null/undefined', () => {
    expect(preferDeclaredList(null, ['healthtech'])).toEqual(['healthtech']);
    expect(preferDeclaredList(undefined, ['healthtech'])).toEqual(['healthtech']);
  });

  it('returns an empty array when neither side has anything', () => {
    expect(preferDeclaredList(null, null)).toEqual([]);
    expect(preferDeclaredList([], undefined)).toEqual([]);
  });
});
