'use client';
// Prompt 687 §3 — the investor `/portal` shell had TWO real callers of
// GET /api/portal/pipeline firing on every page open: InvestorWorkspaceShell
// mounts useInvestorActions() unconditionally (for the sidebar's "Actions
// required" badge, which needs pending-decision cards), and PipelinePanel
// fetches the SAME endpoint whenever the Pipeline tab is the one open —
// which, opening straight into /portal?tab=pipeline, is simultaneously.
// Not React StrictMode (confirmed live, it doesn't run in production) —
// two genuinely separate callers.
//
// A tiny in-flight-request cache, not a context/provider: PipelinePanel and
// useInvestorActions each keep their own local state shaped for their own
// purpose (a full Card[] vs. a stripped {orgId,name,status,isArchived}[]) —
// sharing a context would mean reshaping one of them for no benefit. This
// just makes two near-simultaneous callers share the SAME network request
// instead of firing two, which is the actual, narrow thing that was slow.
//
// `force: true` is for the many call sites that call this AFTER a mutation
// (Express interest, Pass, Archive, a reminder, …) — those must never reuse
// a cached response from before the action, or the investor's own change
// wouldn't show up. The plain (no-force) call is only ever the initial
// mount-time load, which is exactly when deduping against a sibling
// caller's simultaneous mount-time load is actually useful.
let inFlight: Promise<unknown> | null = null;
let startedAt = 0;
const DEDUPE_WINDOW_MS = 2000;

export function fetchPipelineShared<T = unknown>(opts?: { force?: boolean }): Promise<T> {
  const now = Date.now();
  if (!opts?.force && inFlight && now - startedAt < DEDUPE_WINDOW_MS) return inFlight as Promise<T>;
  startedAt = now;
  inFlight = fetch('/api/portal/pipeline').then((r) => r.json());
  return inFlight as Promise<T>;
}

// Test-only: this module's cache is deliberately a singleton (every real
// caller in the app must share the same one) — a test file needs a way to
// start each case with a clean slate instead.
export function __resetForTests() {
  inFlight = null;
  startedAt = 0;
}
