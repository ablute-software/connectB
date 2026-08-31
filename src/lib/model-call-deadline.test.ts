import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Prompt 484 — a source-level guard, same shape and same honest limits as
// no-fire-and-forget.test.ts, for an invariant nothing else can hold.
//
// WHAT HAPPENED. On 31/08 Nuno ran "Read my documents" twice over
// Competitive_Landscape_and_Moat.docx.pdf and got "Could not read those
// documents — try again." both times, with ZERO new rows in ai_call_log.
// The Supabase edge logs show the route ran to completion up to the model
// call on both attempts — the PDF downloaded 200 OK (05:09:30.323Z and
// 05:14:16.275Z), the market_facts capability probe and the
// market_research_items signature query ran immediately after — and then
// nothing at all. The model call never came back inside the platform's 60s
// function ceiling, so Vercel killed the function: no JSON body for the
// panel to read, and no logAiCall, which is why the one artifact that would
// have proved a pass happened was missing.
//
// WHY IT COULD NOT FAIL GRACEFULLY. The fetch to api.anthropic.com carried
// no signal. A request with no deadline of its own cannot lose to anything
// except the platform, and losing to the platform means losing the whole
// process — the response, the log line, and the telemetry with it. The fix
// is not a bigger ceiling (60s IS the Hobby ceiling; maxDuration cannot be
// raised without changing plan) but a deadline the ROUTE owns, comfortably
// inside it, so the route is always the one that decides how the request
// ends.
//
// WHAT THIS TEST IS NOT. It reads source text. It cannot prove the signal is
// wired to the right fetch, that the catch does anything useful, or that the
// reserve is generous enough in practice. It proves what a future edit would
// silently undo: that the call still declares a deadline; that the deadline is
// still DERIVED from the handler's own clock rather than a flat number counted
// from the fetch (a flat number bounds nothing, because the download and the
// probes have already spent part of the budget by then — that was the first
// draft of this very fix, and it was wrong); that MAX_DURATION_MS still agrees
// with the maxDuration Next reads; and that real room is still reserved for
// the writes that happen after the model answers.
//
// SCOPE, stated rather than implied: only this route. Other routes calling
// api.anthropic.com have the same exposure and are NOT covered here —
// widening the guard means giving each of them a deadline first, which is
// its own change and its own decision about what each one should wait.
const ROUTE_PATH = join(process.cwd(), 'src/app/api/market-data/document-extract/route.ts');

function routeSource(): string {
  return readFileSync(ROUTE_PATH, 'utf8');
}

describe('document-extract: the model call must own its own deadline', () => {
  it('passes a signal to the Anthropic fetch', () => {
    const src = routeSource();
    const call = src.slice(src.indexOf("fetch('https://api.anthropic.com/v1/messages'"));
    expect(call).not.toBe('');
    // The signal must appear before the request body ends — i.e. inside the
    // init object of this call, not somewhere else in the file.
    const init = call.slice(0, call.indexOf('    });'));
    expect(init).toMatch(/signal:\s*AbortSignal\.timeout\(/);
  });

  it('the deadline is what is LEFT of the budget, not a fixed number counted from the fetch', () => {
    const src = routeSource();
    // The first draft of this fix used a flat 45s measured at the fetch.
    // That guarantees nothing — the download and the probes have already
    // spent part of the 60s by then. The signal must be fed a value derived
    // from the handler's own clock.
    expect(src).toMatch(/const startedAt = Date\.now\(\);/);
    expect(src).toMatch(/const modelBudgetMs = MAX_DURATION_MS - POST_MODEL_RESERVE_MS - spentMs;/);
    expect(src).toMatch(/signal:\s*AbortSignal\.timeout\(modelBudgetMs\)/);
  });

  it('MAX_DURATION_MS agrees with the maxDuration Next actually reads', () => {
    const src = routeSource();
    // maxDuration has to be a literal for Next to read it statically, so the
    // two cannot be derived from one another. This is the check that keeps
    // them honest: raising one and forgetting the other would silently give
    // the model a budget the platform does not grant.
    const maxDurationMs = /const MAX_DURATION_MS = ([\d_]+);/.exec(src);
    const maxDuration = /export const maxDuration = (\d+);/.exec(src);
    expect(maxDurationMs, 'MAX_DURATION_MS is gone').not.toBeNull();
    expect(maxDuration, 'maxDuration is gone — nothing bounds the function').not.toBeNull();
    expect(Number(maxDurationMs![1].replace(/_/g, ''))).toBe(Number(maxDuration![1]) * 1000);
  });

  it('leaves real room for the writes that happen after the model answers', () => {
    const src = routeSource();
    const reserve = /const POST_MODEL_RESERVE_MS = ([\d_]+);/.exec(src);
    const minWait = /const MIN_MODEL_WAIT_MS = ([\d_]+);/.exec(src);
    expect(reserve, 'POST_MODEL_RESERVE_MS is gone').not.toBeNull();
    expect(minWait, 'MIN_MODEL_WAIT_MS is gone').not.toBeNull();
    // logAiCall, the typed-facts writes and one to three queries per proposal
    // all run after the model answers. A reserve near zero passes every other
    // check here and still loses everything that comes after the response.
    expect(Number(reserve![1].replace(/_/g, ''))).toBeGreaterThanOrEqual(10_000);
    // And a floor below which starting a call is just paying for an answer
    // that cannot arrive.
    expect(Number(minWait![1].replace(/_/g, ''))).toBeGreaterThan(0);
  });

  it('a failed model call returns JSON instead of letting the function die', () => {
    const src = routeSource();
    // The fetch is wrapped, and the catch answers with a body. Without this,
    // an abort would throw out of the handler and Next would answer with an
    // error page — which is byte-for-byte the failure being fixed.
    const call = src.slice(src.indexOf("fetch('https://api.anthropic.com/v1/messages'"));
    const afterCall = call.slice(0, 2000);
    expect(afterCall).toMatch(/catch \(e\)/);
    expect(afterCall).toMatch(/NextResponse\.json\(\{\s*\n?\s*ok: false/);
  });

  it('a response cut off at max_tokens is recorded, not treated as complete', () => {
    // Every pass since Prompt 478 returned exactly 4000 output tokens — the
    // ceiling — which means every one was truncated mid-JSON and said so
    // nowhere. This pins the check that noticed it.
    expect(routeSource()).toMatch(/stop_reason === 'max_tokens'/);
  });
});
