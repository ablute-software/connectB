import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('writes a header and rows for the given columns, in order', () => {
    const csv = toCsv([{ name: 'ablute_', score: 92 }], ['name', 'score']);
    expect(csv).toBe('name,score\r\nablute_,92');
  });

  it('quotes and escapes fields containing commas, quotes, or newlines', () => {
    const csv = toCsv([{ note: 'Says "hi", then leaves\nnext line' }], ['note']);
    expect(csv).toBe('note\r\n"Says ""hi"", then leaves\nnext line"');
  });

  it('renders null/undefined as an empty field, not the string "null"', () => {
    const csv = toCsv([{ a: null, b: undefined }], ['a', 'b']);
    expect(csv).toBe('a,b\r\n,');
  });
});
