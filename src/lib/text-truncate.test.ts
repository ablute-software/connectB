import { describe, expect, it } from 'vitest';
import { truncateAtWord } from './text-truncate';

describe('truncateAtWord', () => {
  it('returns undefined for undefined/empty input', () => {
    expect(truncateAtWord(undefined, 10)).toBeUndefined();
    expect(truncateAtWord('', 10)).toBeUndefined();
  });

  it('returns the text unchanged when already within the limit', () => {
    expect(truncateAtWord('short text', 300)).toBe('short text');
  });

  it('cuts at the last word boundary within the limit, never mid-word', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    // Limit lands inside "jumps" (index 24) — must back up to "fox".
    expect(truncateAtWord(text, 24)).toBe('The quick brown fox…');
  });

  it('falls back to a mid-word cut only when there is no space at all within the limit', () => {
    expect(truncateAtWord('Supercalifragilisticexpialidocious', 10)).toBe('Supercalif…');
  });
});
