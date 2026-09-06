'use client';
// Prompt 274/581 — shared browser->Edge-Function client for the
// enrichment worker. Extracted out of EnrichmentCampaignPanel.tsx (its
// original, only caller) because Prompt 581 §C.3 needs the exact same
// "enqueue then invoke until terminal" flow for the dossier's own
// individual Research-now button — two copies of retry/timeout logic this
// sensitive would drift.
//
// Direct browser -> Edge Function call, not routed through a Next.js API
// route: a single worker invocation can legitimately run for 1-3+ minutes
// (Layer 2's own web-search step has a 120s timeout inside the edge
// function), well past a Vercel Hobby-plan serverless function's allowed
// runtime. Authenticated with the calling platform admin's own session
// (the worker's auth explicitly supports this — only pg_cron's
// service-role key or an is_platform_admin() session may call it) —
// never the service-role key, which must never reach the browser.
import { SUPABASE_URL } from '@/lib/supabase';

export async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

// 170s client-side timeout — generous above the worker's own internal
// 120s Layer-2 search timeout plus overhead, so a genuinely stuck call
// still fails visibly instead of hanging forever.
async function invokeWorker(accessToken: string, layer: 1 | 2): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 170_000);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/enrichment-worker`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ maxJobs: 1, layer }),
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export type WorkerOutcome =
  | { kind: 'abort'; message: string }
  | { kind: 'error'; message: string }
  // Prompt 581 §A.2 — found live: the original version of this function
  // (EnrichmentCampaignPanel.tsx, pre-extraction) returned the SAME shape
  // whether the job reached a real terminal status or simply exhausted 4
  // attempts still 'queued' (worker never claimed it) — its one caller
  // (researchPerson) couldn't tell the difference and reported "No usable
  // hook found" for a job that never actually ran, after 2 real
  // none_found jobs had already cost €0.25-0.33 each for nothing. 'stuck'
  // is a third, distinct outcome so a caller can say so honestly instead
  // of fabricating a result.
  | { kind: 'stuck'; collected: Record<string, unknown> }
  | { kind: 'terminal'; collected: Record<string, unknown> };

// Bug found live during this campaign's own first supervised trial
// (2026-08-19): a job the worker requeues for retry keeps its ORIGINAL
// created_at, so it stays at the front of its (priority, created_at)
// queue position — a naive "invoke once per candidate, then move to the
// next" loop just kept re-claiming the SAME stuck job instead of ever
// reaching later candidates. Fix: for one target, keep invoking until ITS
// OWN job reaches a terminal status (done/skipped/failed) — bounded at 4
// tries, one more than the worker's own 3-attempt cap so a final requeue
// still gets read back correctly instead of stopping one short — before
// ever moving to the next target. Shared by both Layer 1 (entity) and
// Layer 2 (person) call sites.
export async function invokeUntilTerminal(
  accessToken: string, layer: 1 | 2, collect: () => Promise<Record<string, unknown>>,
): Promise<WorkerOutcome> {
  let collected: Record<string, unknown> = { status: 'queued' };
  let attempt = 0;
  for (; attempt < 4 && collected.status === 'queued'; attempt++) {
    let invoked: Record<string, unknown>;
    try {
      invoked = await invokeWorker(accessToken, layer);
    } catch (e) {
      return { kind: 'error', message: `Worker call failed: ${(e as Error).message}` };
    }
    if (invoked.skipped) return { kind: 'abort', message: `Enrichment is disabled server-side (${invoked.reason}).` };
    if (invoked.stopped) return { kind: 'abort', message: `Daily AI cost cap reached (€${Number(invoked.spentToday ?? 0).toFixed(2)} of €${invoked.cap}) — stopping here for today.` };
    collected = await collect();
    if (!collected.ok) return { kind: 'error', message: String(collected.error ?? 'Unknown error.') };
  }
  return collected.status === 'queued' ? { kind: 'stuck', collected } : { kind: 'terminal', collected };
}
