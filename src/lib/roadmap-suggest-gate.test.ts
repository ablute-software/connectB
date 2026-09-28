// Prompt 892 — a Developer Viewer session must never trigger a new AI
// generation pass (and its credit charge) into the org being viewed. Only
// shouldGenerateNewSuggestions is tested here: it is the one gate standing
// between a plain page load and a real write, and it is pure by design so
// this needs no Supabase client, no network call, and no route invocation.
import { describe, expect, it } from 'vitest';
import { shouldGenerateNewSuggestions } from './roadmap-suggest-gate';

const base = { isViewerSession: false, alreadyRanForThisSignature: false, hasApiKey: true, itemCount: 3 };

describe('shouldGenerateNewSuggestions — Prompt 892', () => {
  it('generates for an ordinary founder session with new knowledge', () => {
    expect(shouldGenerateNewSuggestions(base)).toBe(true);
  });

  it('never generates during a Developer Viewer session, even with everything else true', () => {
    expect(shouldGenerateNewSuggestions({ ...base, isViewerSession: true })).toBe(false);
  });

  it('skips when this knowledge signature already ran (unrelated to viewer mode)', () => {
    expect(shouldGenerateNewSuggestions({ ...base, alreadyRanForThisSignature: true })).toBe(false);
  });

  it('skips when there is no API key configured', () => {
    expect(shouldGenerateNewSuggestions({ ...base, hasApiKey: false })).toBe(false);
  });

  it('skips when there is no knowledge to propose from', () => {
    expect(shouldGenerateNewSuggestions({ ...base, itemCount: 0 })).toBe(false);
  });

  it('viewer mode wins even when every other condition would otherwise allow generation', () => {
    expect(shouldGenerateNewSuggestions({
      isViewerSession: true, alreadyRanForThisSignature: false, hasApiKey: true, itemCount: 10,
    })).toBe(false);
  });
});
