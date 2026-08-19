import { describe, expect, it } from 'vitest';
import { keyPeopleParseNeedsReview, parseKeyPeopleText } from './key-people-parse';

describe('parseKeyPeopleText', () => {
  it('parses the real Karista.vc shape — "Name (Role)", semicolon-separated', () => {
    const raw = 'Olivier Dubuisson (Managing Partner); Catherine Boule (Managing Partner)';
    expect(parseKeyPeopleText(raw)).toEqual([
      { fullName: 'Olivier Dubuisson', role: 'Managing Partner' },
      { fullName: 'Catherine Boule', role: 'Managing Partner' },
    ]);
  });

  it('parses "Name — Role" (em dash), pipe-separated', () => {
    const raw = 'Jane Doe — CEO | John Smith — CTO';
    expect(parseKeyPeopleText(raw)).toEqual([
      { fullName: 'Jane Doe', role: 'CEO' },
      { fullName: 'John Smith', role: 'CTO' },
    ]);
  });

  it('parses a plain hyphen as the role separator too', () => {
    expect(parseKeyPeopleText('Ana Silva - Partner')).toEqual([{ fullName: 'Ana Silva', role: 'Partner' }]);
  });

  it('falls back to name-only when no role marker is present', () => {
    expect(parseKeyPeopleText('Just A Name')).toEqual([{ fullName: 'Just A Name', role: null }]);
  });

  it('drops empty items from stray separators/whitespace', () => {
    expect(parseKeyPeopleText('Jane Doe (CEO);; ; |John Smith (CTO)')).toEqual([
      { fullName: 'Jane Doe', role: 'CEO' },
      { fullName: 'John Smith', role: 'CTO' },
    ]);
  });

  it('returns an empty array for blank input', () => {
    expect(parseKeyPeopleText('')).toEqual([]);
    expect(parseKeyPeopleText('   ')).toEqual([]);
  });

  it('trims whitespace around name and role', () => {
    expect(parseKeyPeopleText('  Jane Doe   (  CEO  )  ')).toEqual([{ fullName: 'Jane Doe', role: 'CEO' }]);
  });
});

describe('keyPeopleParseNeedsReview', () => {
  it('is clean when every person parsed with a role', () => {
    expect(keyPeopleParseNeedsReview(parseKeyPeopleText('Jane Doe (CEO); John Smith (CTO)'))).toBe(false);
  });

  it('flags empty parse results', () => {
    expect(keyPeopleParseNeedsReview([])).toBe(true);
  });

  it('flags the whole entity if even one person has no detected role', () => {
    const parsed = parseKeyPeopleText('Jane Doe (CEO); Some Unparsed Blob Of Text');
    expect(keyPeopleParseNeedsReview(parsed)).toBe(true);
  });

  it('flags an implausibly long "name" (an undetected separator swallowing the whole line)', () => {
    const longBlob = 'A'.repeat(80);
    expect(keyPeopleParseNeedsReview([{ fullName: longBlob, role: 'CEO' }])).toBe(true);
  });

  it('flags an implausibly short name', () => {
    expect(keyPeopleParseNeedsReview([{ fullName: 'X', role: 'CEO' }])).toBe(true);
  });
});
