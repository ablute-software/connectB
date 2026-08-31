import { describe, expect, it } from 'vitest';
import {
  CONSERVATIVE_OUTPUT_TOKENS_PER_MS,
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  MIN_USEFUL_MODEL_BUDGET_MS,
  TTFT_AND_PREFILL_ALLOWANCE_MS,
  maxOutputTokensForBudget,
} from './document-extract-budget';

describe('maxOutputTokensForBudget — Prompt 485', () => {
  it('the budget that was actually failing now asks for well under the old flat 4000', () => {
    // The real shape of a pass: 60s ceiling, 12s reserved for the writes that
    // follow, a few seconds already spent downloading and probing. Prompt 484
    // called that ~45s and the call still did not come back, because it was
    // asking for 4000 tokens — about 40s of generation at the best rate ever
    // measured here, and there is no such thing as a best rate every time.
    const asked = maxOutputTokensForBudget(45_000);
    expect(asked).toBeLessThan(4_000);
    // And it is not a magic number: it is what fits at the conservative rate.
    expect(asked).toBe(Math.floor((45_000 - TTFT_AND_PREFILL_ALLOWANCE_MS) * CONSERVATIVE_OUTPUT_TOKENS_PER_MS));
  });

  it('what it asks for fits the time it has, at the conservative rate', () => {
    for (const budgetMs of [35_000, 40_000, 45_000, 48_000]) {
      const asked = maxOutputTokensForBudget(budgetMs);
      const generationMs = asked / CONSERVATIVE_OUTPUT_TOKENS_PER_MS;
      expect(generationMs + TTFT_AND_PREFILL_ALLOWANCE_MS).toBeLessThanOrEqual(budgetMs);
    }
  });

  it('never asks for more than the route asked for before — a bigger ask is a slower call', () => {
    expect(maxOutputTokensForBudget(600_000)).toBe(MAX_OUTPUT_TOKENS);
    expect(maxOutputTokensForBudget(Number.MAX_SAFE_INTEGER)).toBe(MAX_OUTPUT_TOKENS);
  });

  it('never asks for less than the floor', () => {
    expect(maxOutputTokensForBudget(0)).toBe(MIN_OUTPUT_TOKENS);
    expect(maxOutputTokensForBudget(-10_000)).toBe(MIN_OUTPUT_TOKENS);
    expect(maxOutputTokensForBudget(TTFT_AND_PREFILL_ALLOWANCE_MS)).toBe(MIN_OUTPUT_TOKENS);
  });

  it('MIN_USEFUL_MODEL_BUDGET_MS is exactly the budget at which the floor becomes affordable', () => {
    // This is the value document-extract uses as MIN_MODEL_WAIT_MS. One below
    // it, the floor is being clamped up — i.e. the route would be asking for
    // more than it can afford. At it, the two agree exactly.
    expect(maxOutputTokensForBudget(MIN_USEFUL_MODEL_BUDGET_MS)).toBe(MIN_OUTPUT_TOKENS);
    const generationMs = MIN_OUTPUT_TOKENS / CONSERVATIVE_OUTPUT_TOKENS_PER_MS;
    expect(MIN_USEFUL_MODEL_BUDGET_MS).toBeGreaterThanOrEqual(generationMs + TTFT_AND_PREFILL_ALLOWANCE_MS);
  });

  it('the rate is slower than the one measured in production, on purpose', () => {
    // Measured: 4000 output tokens in ~40.5s => ~0.099 tokens/ms at best.
    // Sizing against the best case is what broke this route.
    expect(CONSERVATIVE_OUTPUT_TOKENS_PER_MS).toBeLessThan(4_000 / 40_500);
  });

  it('is monotonic — more time never buys fewer tokens', () => {
    let previous = 0;
    for (let budgetMs = 0; budgetMs <= 120_000; budgetMs += 2_500) {
      const asked = maxOutputTokensForBudget(budgetMs);
      expect(asked).toBeGreaterThanOrEqual(previous);
      previous = asked;
    }
  });
});
