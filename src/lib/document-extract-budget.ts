// Prompt 485 — how many output tokens this route can afford to ask for.
//
// WHAT THE MEASUREMENT SAYS, and it is the opposite of the prompt's own
// hypothesis. Prompt 485 supposed the time was going into READING the PDF
// ("o tempo não está a ser gasto a GERAR uma resposta longa, mas a LER o
// documento em si") and proposed a lower page cap. Two rows of ai_call_log
// from 30/08 rule that out:
//
//   21:52:47.871  document-extract   31,725 in  /  4,000 out
//   21:52:48.590  document-extract  157,444 in  /  4,000 out
//
// Two concurrent calls, a FIVE-fold difference in input, and they finished
// 0.72 seconds apart. If reading the document set the wall clock, the second
// would have finished many seconds after the first.
//
// And the other direction, same evening, same platform, same 60s ceiling:
//
//   21:51:53.074  market-thesis/suggest-from-documents  155,915 in / 652 out
//
// 4.75x the input of the call that times out, and it returns comfortably —
// because it generates 652 tokens instead of 4,000.
//
// So the wall clock is set by the OUTPUT. Lowering MAX_EXTRACTION_PAGES
// would shrink the variable that is not binding. What binds is max_tokens,
// which this route has been hitting EXACTLY (4000/4000/4000/4000 on every
// pass since Prompt 478) — meaning every one of those passes was also
// truncated mid-JSON.
//
// THE RATE. The one clean timing available: storage download 22:18:06.882Z
// to the ai_call_log row at 22:18:47.348Z = 40.5s for 4,000 output tokens,
// so roughly 100 tokens/s at its BEST. Sizing a request against the best
// case observed is precisely what left this route with no headroom and got
// it killed. The rate below is deliberately slower than anything measured,
// so a pass that is having a bad day still comes back with an answer.
export const CONSERVATIVE_OUTPUT_TOKENS_PER_MS = 0.07; // ~70 tok/s, vs ~100 measured at best

// Time-to-first-token, prefilling the document, and the network on both
// legs — everything that is NOT generation. Generous on purpose: this is the
// part that varies with the size of the document, which is exactly what the
// measurements above show does not dominate but does still cost something.
export const TTFT_AND_PREFILL_ALLOWANCE_MS = 12_000;

// Below this a pass is not worth paying for — it could not carry a
// competitive landscape's worth of findings even if it succeeded.
export const MIN_OUTPUT_TOKENS = 1_500;
// Never ask for more than the route asked for before this prompt. Raising it
// would make the call slower, which is the failure being fixed.
export const MAX_OUTPUT_TOKENS = 4_000;

// The smallest model budget at which a call is worth starting at all:
// enough for the allowance plus MIN_OUTPUT_TOKENS at the conservative rate.
// document-extract's MIN_MODEL_WAIT_MS must be at least this, or the route
// would start calls it has already decided are too small to be useful —
// pinned by a test rather than left as a comment.
export const MIN_USEFUL_MODEL_BUDGET_MS =
  TTFT_AND_PREFILL_ALLOWANCE_MS + Math.ceil(MIN_OUTPUT_TOKENS / CONSERVATIVE_OUTPUT_TOKENS_PER_MS);

// Returns the max_tokens to ask for, given what is left of the function's
// budget. Never above MAX_OUTPUT_TOKENS, never below MIN_OUTPUT_TOKENS —
// and a budget too small for MIN_OUTPUT_TOKENS returns MIN_OUTPUT_TOKENS
// rather than something smaller, because the caller is expected to have
// refused to make the call at all by then (MIN_MODEL_WAIT_MS). The clamp is
// a floor on the ASK, never a promise the answer fits.
export function maxOutputTokensForBudget(modelBudgetMs: number): number {
  const generationMs = modelBudgetMs - TTFT_AND_PREFILL_ALLOWANCE_MS;
  const affordable = Math.floor(generationMs * CONSERVATIVE_OUTPUT_TOKENS_PER_MS);
  if (affordable < MIN_OUTPUT_TOKENS) return MIN_OUTPUT_TOKENS;
  if (affordable > MAX_OUTPUT_TOKENS) return MAX_OUTPUT_TOKENS;
  return affordable;
}
