// Prompt 274 — counts + prioritized candidate list for the enrichment
// campaign panel. Read-only, no queue writes. is_test rows are excluded
// from every count (same "never counted in real business metrics"
// convention this codebase already applies everywhere else), so these
// numbers may not exactly match a raw `select count(*)` — that's
// intentional, not a bug.
//
// No aggregate view/RPC exists for any of these four counts (confirmed by
// reading the schema first) — 529 catalog_entities is a small enough table
// to fetch whole and count in-memory, same pattern api/backoffice/catalog
// already uses for aliases/contacts.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

// Prompt 279 — real numbers measured after the first campaign run
// (commit 7b987c0): 33N Ventures/A/O PropTech/Atomico all failed the
// same fetch (404/403/429) and would otherwise reappear at the TOP of
// every future run (still enrichment_status='pending', same delivered+
// verified priority tier), burning 3 of the next run's cap slots for a
// guaranteed repeat of the same zero-cost, zero-progress outcome.
//
// Approach (confirmed against the real enrichment_jobs schema before
// writing this — no schema change, worker untouched, matches its own
// "read whole table, count in-memory" precedent above): a catalog_
// entities row is excluded from `candidates` (never from the counts, and
// never written to enrichment_status — this is a selection-time filter
// only) once its most recent Layer-1 jobs show >= CHRONIC_FAILURE_
// THRESHOLD consecutive terminal rows, all fetch-related, with no 'done'
// in between. "Consecutive" and "fetch-related" both matter: a single
// enqueueJob() row only tracks the worker's OWN internal retries (capped
// at 3) before going terminal — the real history spans MULTIPLE rows
// across campaign runs, since enqueueJob() inserts a fresh row once the
// prior one is no longer 'queued'/'running'. And only fetch-stage
// failures should count — extraction_validation_failed/anthropic_5xx/
// entity_not_found are unrelated to whether the SITE is reachable and
// must not poison this streak.
//
// Not silently hidden forever: excluded rows are surfaced back in
// `chronicFailures` (name + streak + last reason) rather than dropped
// from the response, and nothing here ever touches enrichment_status —
// a direct POST to enqueue-entity-layer1 for that same id still works
// (it has zero knowledge of this list), and the streak resets itself the
// moment a real 'done' row appears (the site got fixed).
const FETCH_RELATED_REASON = /^(http_[4-5]\d\d|fetch_error\b|invalid_website_url)/;
const CHRONIC_FAILURE_THRESHOLD = 2;

// Prompt 279 — priority WITHIN the same delivered/verified tier: a row
// that already has more of these 8 fields filled in is cheaper to
// finish and gives a visible result faster than starting from an empty
// one (Nuno's own reasoning). Deliberately NOT a reuse of
// manualEntityCompleteness/entityCompleteness (src/lib/completeness.ts)
// — same class of mismatch Prompt 276 already reasoned through for why
// those two aren't interchangeable: catalog_entities has its own
// snake-case shape (no hqCity/hqCountry/contactCount, but DOES have
// thesis, which manualEntityCompleteness never checks), and this route
// only ever needs a sort-comparable count, never a displayed grade — a
// fourth exported completeness function for one route's tiebreaker
// would be over-abstraction, not consistency (confirmed by reading
// completeness.ts first, not assumed).
function existingFieldCount(e: {
  website: string | null; sectors: string[] | null; thesis: string | null;
  stage_min: string | null; stage_max: string | null;
  check_min_eur: number | null; check_max_eur: number | null; geographies: string[] | null;
}): number {
  return [
    !!e.website, (e.sectors?.length ?? 0) > 0, !!e.thesis, !!e.stage_min, !!e.stage_max,
    e.check_min_eur != null, e.check_max_eur != null, (e.geographies?.length ?? 0) > 0,
  ].filter(Boolean).length;
}

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [{ data: entities, error: entitiesErr }, { data: deliveries }, { data: affiliations }] = await Promise.all([
    admin.from('catalog_entities')
      .select('id, name, verification_status, is_test, website, sectors, thesis, stage_min, stage_max, check_min_eur, check_max_eur, geographies, enrichment_status'),
    admin.from('catalog_deliveries').select('catalog_id'),
    admin.from('catalog_person_affiliations').select('entity_id, catalog_people(hook_status)'),
  ]);
  if (entitiesErr) return NextResponse.json({ ok: false, error: entitiesErr.message }, { status: 500 });

  const real = (entities ?? []).filter((e) => !e.is_test);

  const deliveredCount = new Map<string, number>();
  for (const d of deliveries ?? []) deliveredCount.set(d.catalog_id, (deliveredCount.get(d.catalog_id) ?? 0) + 1);

  const entitiesWithPeople = new Set<string>();
  const entitiesWithHooks = new Set<string>();
  for (const a of affiliations ?? []) {
    entitiesWithPeople.add(a.entity_id as string);
    const person = a.catalog_people as unknown as { hook_status: string } | null;
    if (person?.hook_status === 'researched') entitiesWithHooks.add(a.entity_id as string);
  }

  const counts = {
    total: real.length,
    pending: real.filter((e) => e.enrichment_status === 'pending').length,
    withCheckSize: real.filter((e) => e.check_min_eur != null || e.check_max_eur != null).length,
    withPeople: real.filter((e) => entitiesWithPeople.has(e.id)).length,
    withHooks: real.filter((e) => entitiesWithHooks.has(e.id)).length,
  };

  const pending = real.filter((e) => e.enrichment_status === 'pending');
  const pendingIds = pending.map((e) => e.id);

  // One query for every pending candidate's Layer-1 history — not one per
  // candidate (bounded by candidates x campaign runs, same "fetch whole,
  // count in-memory" reasoning as the rest of this route).
  const { data: layer1History } = pendingIds.length
    ? await admin.from('enrichment_jobs')
        .select('target_id, status, last_error, created_at')
        .eq('target_type', 'entity').eq('layer', 1)
        .in('target_id', pendingIds)
        .order('created_at', { ascending: false })
    : { data: [] as { target_id: string; status: string; last_error: string | null }[] };

  const byTarget = new Map<string, { status: string; last_error: string | null }[]>();
  for (const row of layer1History ?? []) {
    if (row.status === 'queued' || row.status === 'running') continue; // in-flight, not a concluded attempt
    const list = byTarget.get(row.target_id as string);
    if (list) list.push(row); else byTarget.set(row.target_id as string, [row]);
  }
  const chronicFailures = new Map<string, { streak: number; lastError: string }>();
  for (const [targetId, rows] of byTarget) {
    // rows are newest-first, since the query itself was ordered created_at desc
    let streak = 0, lastError = '';
    for (const row of rows) {
      if (row.status === 'done') break; // a success in the tail means not chronic
      if ((row.status === 'failed' || row.status === 'skipped') && FETCH_RELATED_REASON.test(row.last_error ?? '')) {
        streak++; lastError = row.last_error ?? lastError;
      } else break; // a different kind of failure breaks the streak
    }
    if (streak >= CHRONIC_FAILURE_THRESHOLD) chronicFailures.set(targetId, { streak, lastError });
  }

  // Prompt 274 — priority substitute for "fit High first" (see
  // src/lib/enrichment-campaign.ts header for why fit_score isn't
  // available here): delivered-to-at-least-one-org first (these are the
  // rows a real founder is looking at right now with empty columns —
  // exactly the case that prompted this campaign), then verified over
  // pending (don't spend AI budget enriching unverified/junk rows), then
  // more deliveries = more founders affected. Prompt 279 — a completeness
  // tiebreaker now sits ahead of the final name-alphabetical fallback:
  // within the same tier, whichever row already has more of the 8 fields
  // filled in goes first (cheaper to finish, visible result sooner).
  const candidates = pending
    .filter((e) => !chronicFailures.has(e.id))
    .map((e) => ({
      id: e.id, name: e.name, verified: e.verification_status === 'verified',
      deliveredCount: deliveredCount.get(e.id) ?? 0, existingFields: existingFieldCount(e),
    }))
    .sort((a, b) =>
      (b.deliveredCount > 0 ? 1 : 0) - (a.deliveredCount > 0 ? 1 : 0)
      || (b.verified ? 1 : 0) - (a.verified ? 1 : 0)
      || b.deliveredCount - a.deliveredCount
      || b.existingFields - a.existingFields
      || a.name.localeCompare(b.name));

  const chronicFailureList = pending
    .filter((e) => chronicFailures.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, ...chronicFailures.get(e.id)! }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    ok: true, counts: { ...counts, chronicFetchFailures: chronicFailures.size }, candidates, chronicFailures: chronicFailureList,
  });
}
