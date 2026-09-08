import { describe, expect, it } from 'vitest';
import { normalizeLinkedInUrl, toStorableLinkedInUrl } from './linkedin-url';

const CANONICAL = 'https://www.linkedin.com/in/nunomarujo';

describe('normalizeLinkedInUrl (Prompt 613 §C.2)', () => {
  it('repairs the value that was actually in production', () => {
    // `linkedin.com\nunomarujo` — a backslash instead of /in/. Every reader in
    // the app treated this row as having no LinkedIn at all.
    expect(normalizeLinkedInUrl('linkedin.com\\nunomarujo')).toEqual({
      ok: true, url: CANONICAL, handle: 'nunomarujo',
    });
  });

  it('accepts every shape a person actually pastes', () => {
    for (const input of [
      'https://www.linkedin.com/in/nunomarujo/',
      'https://linkedin.com/in/nunomarujo',
      'http://pt.linkedin.com/in/nunomarujo',
      'www.linkedin.com/in/nunomarujo',
      'linkedin.com/in/nunomarujo',
      '  https://www.linkedin.com/in/NunoMarujo/?originalSubdomain=pt  ',
    ]) {
      expect(normalizeLinkedInUrl(input)).toEqual({ ok: true, url: CANONICAL, handle: 'nunomarujo' });
    }
  });

  it('gives one canonical form, so the same person compares equal', () => {
    const a = normalizeLinkedInUrl('https://www.linkedin.com/in/NunoMarujo/');
    const b = normalizeLinkedInUrl('linkedin.com\\nunomarujo');
    expect(a.ok && b.ok && a.url === b.url).toBe(true);
  });

  it('refuses with a reason instead of storing something no reader can use', () => {
    expect(normalizeLinkedInUrl('')).toMatchObject({ ok: false });
    expect(normalizeLinkedInUrl(null)).toMatchObject({ ok: false });
    expect(normalizeLinkedInUrl('nuno marujo')).toMatchObject({ ok: false });
    expect(normalizeLinkedInUrl('https://twitter.com/in/nunomarujo')).toMatchObject({
      ok: false, reason: 'That is not a linkedin.com address.',
    });
    expect(normalizeLinkedInUrl('https://www.linkedin.com/company/ablute')).toMatchObject({
      ok: false, reason: 'That is a company page, not a person’s profile.',
    });
    expect(normalizeLinkedInUrl('https://www.linkedin.com/')).toMatchObject({ ok: false });
  });

  it('does not accept a lookalike host', () => {
    for (const bad of ['https://linkedin.com.evil.tld/in/x', 'https://notlinkedin.com/in/x', 'https://evil.tld/linkedin.com/in/x']) {
      expect(normalizeLinkedInUrl(bad)).toMatchObject({ ok: false });
    }
  });

  it('toStorableLinkedInUrl is the write path: normalised value or null, never the raw text', () => {
    expect(toStorableLinkedInUrl('linkedin.com\\nunomarujo')).toBe(CANONICAL);
    expect(toStorableLinkedInUrl('nonsense')).toBeNull();
  });
});
