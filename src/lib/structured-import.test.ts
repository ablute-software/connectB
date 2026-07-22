import { describe, expect, it } from 'vitest';
import { looksLikePersonName } from './structured-import';

describe('looksLikePersonName', () => {
  it('flags a real reported case: a solo angel imported with no website/domain', () => {
    expect(looksLikePersonName('António Gama Amaral', false, false)).toBe(true);
  });

  it('does not flag a real fund name, even with no website on file yet', () => {
    expect(looksLikePersonName('Armilar Venture Partners', false, false)).toBe(false);
    expect(looksLikePersonName('Adara Ventures', false, false)).toBe(false);
  });

  it('does not flag a person-shaped name once a website or domain is known', () => {
    expect(looksLikePersonName('António Gama Amaral', true, false)).toBe(false);
    expect(looksLikePersonName('António Gama Amaral', false, true)).toBe(false);
  });

  it('does not flag a single-word or acronym-style name', () => {
    expect(looksLikePersonName('Northzone', false, false)).toBe(false);
    expect(looksLikePersonName('COREangels Porto', false, false)).toBe(false);
  });
});
