import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './blocked-emails';

describe('normalizeEmail', () => {
  it('trims whitespace', () => {
    expect(normalizeEmail('  a@b.com  ')).toBe('a@b.com');
  });
  it('lowercases the whole address', () => {
    expect(normalizeEmail('Foo.Bar@Example.COM')).toBe('foo.bar@example.com');
  });
  it('does not attempt provider-specific alias folding', () => {
    // Documented gap — Gmail's +tag/dots are NOT collapsed. Confirms the
    // limitation stays visible rather than silently "fixed" with a
    // provider-specific heuristic.
    expect(normalizeEmail('a+tag@gmail.com')).toBe('a+tag@gmail.com');
    expect(normalizeEmail('a.b@gmail.com')).toBe('a.b@gmail.com');
  });
});
