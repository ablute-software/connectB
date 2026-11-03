import { describe, it, expect } from 'vitest';
import { shouldGateTerms, isDuplicateAcceptance, getTermsMarkdown, TERMS_VERSION, TERMS_DISPLAY_VERSION } from './terms';

describe('shouldGateTerms', () => {
  it('demo mode (no Supabase configured) never gates', () => {
    expect(shouldGateTerms({ supabaseConfigured: false, signedIn: true, acceptedVersion: null })).toBe(false);
    expect(shouldGateTerms({ supabaseConfigured: false, signedIn: false, acceptedVersion: null })).toBe(false);
  });

  it('a signed-out visitor is never gated', () => {
    expect(shouldGateTerms({ supabaseConfigured: true, signedIn: false, acceptedVersion: null })).toBe(false);
  });

  it('gate appears for a signed-in user with no acceptance row', () => {
    expect(shouldGateTerms({ supabaseConfigured: true, signedIn: true, acceptedVersion: null })).toBe(true);
  });

  it('gate disappears once the row matches the current version', () => {
    expect(shouldGateTerms({ supabaseConfigured: true, signedIn: true, acceptedVersion: '1.0' }, '1.0')).toBe(false);
  });

  it('a version bump requires re-acceptance — an old row no longer satisfies the new version', () => {
    expect(shouldGateTerms({ supabaseConfigured: true, signedIn: true, acceptedVersion: '1.0' }, '2.0')).toBe(true);
  });
});

describe('isDuplicateAcceptance', () => {
  it('treats a unique-violation as an already-satisfied acceptance, not an error', () => {
    expect(isDuplicateAcceptance('23505')).toBe(true);
  });

  it('does not treat other error codes as duplicates', () => {
    expect(isDuplicateAcceptance('23503')).toBe(false);
    expect(isDuplicateAcceptance(undefined)).toBe(false);
    expect(isDuplicateAcceptance(null)).toBe(false);
  });
});

describe('getTermsMarkdown', () => {
  it('returns the current version verbatim by default, with the header filled in and no placeholder dot left (Nuno, 03/11/2026)', () => {
    const text = getTermsMarkdown();
    expect(text).toContain(`Version ${TERMS_DISPLAY_VERSION} — Nov 2026`);
    expect(text).not.toContain('[●]');
    expect(text).not.toContain('share capital of');
    expect(text).toContain('Exotictarget');
  });

  it('the displayed version is not the acceptance key: a header fix must not make everyone accept again', () => {
    expect(TERMS_VERSION).toBe('3.0');
    expect(TERMS_DISPLAY_VERSION).toBe('3.12');
  });

  it('falls back to the current version for an unknown version string', () => {
    expect(getTermsMarkdown('99.0')).toBe(getTermsMarkdown(TERMS_VERSION));
  });
});
