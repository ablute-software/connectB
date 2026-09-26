import { describe, it, expect } from 'vitest';
import { shouldGateTerms, isDuplicateAcceptance, getTermsMarkdown, TERMS_VERSION } from './terms';

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
  it('returns the current version verbatim by default, unfilled placeholders included', () => {
    const text = getTermsMarkdown();
    expect(text).toContain(`Version ${TERMS_VERSION}`);
    expect(text).toContain('[●]');
    expect(text).toContain('Exotictarget');
  });

  it('falls back to the current version for an unknown version string', () => {
    expect(getTermsMarkdown('99.0')).toBe(getTermsMarkdown(TERMS_VERSION));
  });

  // Prompt 742 §C.1 — the version bump's whole reason: Clause 4.6 covers
  // the in-app viewer's own new measurement (Part D), and an older,
  // already-accepted version must NOT carry it — that is what makes the
  // bump meaningful, not just a version-string change.
  it('the current version (4.0) carries the new Clause 4.6 on investor activity', () => {
    const text = getTermsMarkdown();
    expect(text).toContain('4.6.');
    expect(text).toContain('How investor activity is used');
    expect(text).toContain('how long it is actively viewed and how many pages are seen');
  });

  it('the previous version (3.0) does not carry Clause 4.6', () => {
    expect(getTermsMarkdown('3.0')).not.toContain('How investor activity is used');
  });
});
