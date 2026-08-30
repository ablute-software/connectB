// Prompt 470 §A — required tests, same format as 468's own
// (market-portrait.test.ts): exercised against the pure classifier rather
// than a rendered component (no DOM-testing infrastructure in this
// codebase — see market-portrait.ts's own header for the full reasoning).
import { describe, expect, it } from 'vitest';
import { classifySectionResponse, TIMEOUT_MESSAGE } from './market-research-outcome';

describe('classifySectionResponse — the unreadable-response case (Prompt 470 §A)', () => {
  it('body === null classifies as an error carrying the timeout message, never as the route\'s own error', () => {
    const outcome = classifySectionResponse('growth', null);
    expect(outcome).toEqual({ kind: 'error', section: 'growth', message: TIMEOUT_MESSAGE });
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
