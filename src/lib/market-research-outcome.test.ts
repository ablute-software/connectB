// Prompt 470 §A — required tests, same format as 468's own
// (market-portrait.test.ts): exercised against the pure classifier rather
// than a rendered component (no DOM-testing infrastructure in this
// codebase — see market-portrait.ts's own header for the full reasoning).
import { describe, expect, it } from 'vitest';
import { classifySectionResponse, TIMEOUT_MESSAGE } from './market-research-outcome';

describe('classifySectionResponse — the unreadable-response case (Prompt 470 §A / 471 §B)', () => {
  it('body === null classifies as its own "timeout" kind, never as "error" and never as the route\'s own error', () => {
    const outcome = classifySectionResponse('growth', null);
    expect(outcome).toEqual({ kind: 'timeout', section: 'growth' });
  });

  // Prompt 471 §B (Nuno's correction) — the real bug: this used to be
  // `{ kind: 'error', message: TIMEOUT_MESSAGE }`, so MarketThesisSection.tsx's
  // "any kind==='error' paints red" rule painted the timeout message red too
  // — undoing 468 §A's own "never look like failure" reasoning on the very
  // next case. A distinct `kind` is what lets a caller tell them apart
  // without inspecting copy (which changes) — this test is the one that
  // would have caught the original mistake.
  it('the timeout outcome is never classified as kind "error" — that would repaint it red', () => {
    const outcome = classifySectionResponse('growth', null);
    expect(outcome.kind).not.toBe('error');
    expect(outcome.kind).toBe('timeout');
  });

  it('the timeout outcome carries no message field — TIMEOUT_MESSAGE is fixed copy, not server-supplied data, same discipline as BuildError\'s own {kind:"timeout"} in market-portrait.ts', () => {
    const outcome = classifySectionResponse('growth', null);
    expect('message' in outcome).toBe(false);
  });

  it('ok: false with its own error message is unaffected — still that exact message, untouched', () => {
    const outcome = classifySectionResponse('growth', { ok: false, error: 'Not enough hypothesis context.' });
    expect(outcome).toEqual({ kind: 'error', section: 'growth', message: 'Not enough hypothesis context.' });
  });

  it('aiError takes precedence over error, exactly as before this prompt', () => {
    const outcome = classifySectionResponse('players', { ok: true, aiError: 'The model call failed.', error: 'fallback' });
    expect(outcome).toEqual({ kind: 'error', section: 'players', message: 'The model call failed.' });
  });

  it('ok: false with no message falls back to the generic one, still "error" and unrelated to timeout', () => {
    const outcome = classifySectionResponse('sizing', { ok: false });
    expect(outcome).toEqual({ kind: 'error', section: 'sizing', message: 'Could not run this search — try again.' });
  });

  it('a real empty result stays "empty", never misread as an error', () => {
    const outcome = classifySectionResponse('trends', { ok: true, items: [], costEur: 0.01 });
    expect(outcome).toEqual({ kind: 'empty', section: 'trends', costEur: 0.01 });
  });

  it('a real result with items stays "found", with the count and cost carried through', () => {
    const outcome = classifySectionResponse('regulatory', { ok: true, items: [{}, {}, {}], costEur: 0.045 });
    expect(outcome).toEqual({ kind: 'found', section: 'regulatory', costEur: 0.045, count: 3 });
  });
});

describe('TIMEOUT_MESSAGE never claims failure (Prompt 470 §A required test)', () => {
  it('does not contain the word "failed"', () => {
    expect(TIMEOUT_MESSAGE.toLowerCase()).not.toContain('failed');
  });
});

// Prompt 470 §A point 3 (reload before message) — the real mechanism
// (loadSection, MarketThesisSection.tsx) lives in a React component this
// codebase cannot render in tests (no jsdom/@testing-library — see above),
// so this specific ordering is NOT re-verified by a runtime test here. It
// is instead a language-level guarantee, provable by inspection rather
// than execution: the wiring is
// `void loadSection(s).catch(() => {}).then(() => setOutcomeBySection(...))`
// — a `.then()` callback cannot run before the promise it's chained off
// settles, so "the reload attempt completes before the outcome (and
// therefore the message) is set" is true by construction, not by timing
// luck. The `.catch(() => {})` matters here too, caught during this
// prompt's own adversarial pass: loadSection's `fetch` can reject outright
// on a real network failure, and without the catch that rejection would
// propagate through `.then()` and skip setOutcomeBySection entirely — no
// message at all, worse than the fire-and-forget version this replaced.
// Verified by code review at the point this was written; flagged here
// explicitly rather than silently assumed.
