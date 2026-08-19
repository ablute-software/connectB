import { describe, expect, it } from 'vitest';
import { parseKeyPeopleText } from './key-people-parse';

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
