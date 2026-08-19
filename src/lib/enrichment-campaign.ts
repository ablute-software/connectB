// Prompt 274 — shared server-side helpers for the catalog enrichment
// campaign runner. This does NOT reimplement the Prompt 137 worker
// (supabase/functions/enrichment-worker/index.ts) — it only enqueues into
// its existing `enrichment_jobs` queue and reads back what it wrote. The
// worker's own provenance rules (anchor-verified bios, code-picked-not-
// model-picked URLs, no-hook-without-a-read-source) are untouched; nothing
// here writes to catalog_entities/catalog_people/catalog_people_research
// directly.
//
// Correction to how this campaign was originally briefed, confirmed by
// reading the schema/worker directly (not assumed): catalog_entities has
// no fit_score — that's an Entity-only column (the org-private, post-
// delivery pipeline). The catalog-side equivalent, catalog_match_score(),
// is a per-(org, catalog_entity) computed score — there is no single
// global "fit" for a catalog row shared across every org, so "fit High
// first" has no literal meaning at the campaign's (platform-wide) level.
// campaignPriority() below substitutes the two ingredients that DO exist
// globally and match the prompt's own stated intent ("os que os founders
// veem primeiro" / "já entregues antes dos nunca entregues"): already
// delivered to at least one org, and verification_status='verified' (skip
// spending AI budget on pending/rejected junk). Flagged explicitly in the
// campaign panel's own copy, not silently substituted.
//
// Also corrects a second premise: the catalog worker does NOT write via
// `contributions`/confidence-routing — that system is exclusively for the
// OTHER (org-private entities) enrichment path. The catalog worker has its
// own, stricter, binary (verified-or-empty) provenance discipline; nothing
// here needs to route through contributions, and doing so would be
// inventing a flow that doesn't exist rather than reusing the real one.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export const CAMPAIGN_JOB_PRIORITY = 1; // lower than every other enqueuer (50/100/150) — campaign jobs claim first.

export type EnqueueResult =
  | { ok: true; skip: true; reason: string }
  | { ok: true; skip: false; jobId: string; alreadyQueued: boolean };

// Mirrors scripts/_prompt137_queue_fill.mjs's enqueue() exactly (idempotent:
// respects enrichment_jobs' partial unique index on (target_type, target_id,
// layer) where status in ('queued','running') — a plain insert would
// conflict on a re-run instead of returning the existing job).
export async function enqueueJob(
  admin: SupabaseClient, targetType: 'entity' | 'person', targetId: string, layer: 1 | 2,
): Promise<{ jobId: string; alreadyQueued: boolean }> {
  const { data: activeJob } = await admin.from('enrichment_jobs').select('id')
    .eq('target_type', targetType).eq('target_id', targetId).eq('layer', layer)
    .in('status', ['queued', 'running']).maybeSingle();
  if (activeJob) return { jobId: activeJob.id, alreadyQueued: true };

  const { data: created, error } = await admin.from('enrichment_jobs')
    .insert({ target_type: targetType, target_id: targetId, layer, priority: CAMPAIGN_JOB_PRIORITY, requested_by_org_id: null })
    .select('id').single();
  if (error || !created) throw new Error(`Failed to enqueue ${targetType}/${targetId} layer ${layer}: ${error?.message}`);
  return { jobId: created.id, alreadyQueued: false };
}

export interface JobCost { eur: number; tokensIn: number; tokensOut: number; webCalls: number }
export interface JobRow { status: string; reason: string | null; attempts: number; cost: JobCost }

// Read back what the worker itself wrote for one job (never trust the
// caller's own invoke-response alone — the worker's HTTP response never
// carries cost, and a requeued-for-retry job's true status only lives here).
export async function readJob(admin: SupabaseClient, jobId: string): Promise<JobRow> {
  const { data } = await admin.from('enrichment_jobs')
    .select('status, last_error, attempts, cost_eur, tokens_in, tokens_out, web_calls').eq('id', jobId).single();
  return {
    status: data?.status ?? 'unknown', reason: data?.last_error ?? null, attempts: data?.attempts ?? 0,
    cost: { eur: data?.cost_eur ?? 0, tokensIn: data?.tokens_in ?? 0, tokensOut: data?.tokens_out ?? 0, webCalls: data?.web_calls ?? 0 },
  };
}
