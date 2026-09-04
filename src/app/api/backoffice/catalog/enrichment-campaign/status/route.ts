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
import { catalogEntitySectorFit, type SectorFitResult } from '@/lib/catalog-sector-fit';

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
    admin.from('catalog_deliveries').select('catalog_id, org_id'),
    admin.from('catalog_person_affiliations').select('entity_id, catalog_people(hook_status)'),
  ]);
  if (entitiesErr) return NextResponse.json({ ok: false, error: entitiesErr.message }, { status: 500 });

  const real = (entities ?? []).filter((e) => !e.is_test);

  const deliveredCount = new Map<string, number>();
  // Prompt 281 §1 — which org(s) a row was delivered to, not just the
  // count: needed below to know whose `sectors` to judge fit against.
  const orgIdsByCatalog = new Map<string, Set<string>>();
  for (const d of deliveries ?? []) {
    deliveredCount.set(d.catalog_id, (deliveredCount.get(d.catalog_id) ?? 0) + 1);
    const set = orgIdsByCatalog.get(d.catalog_id) ?? new Set<string>();
    set.add(d.org_id as string);
    orgIdsByCatalog.set(d.catalog_id, set);
  }
  const deliveredOrgIds = [...new Set((deliveries ?? []).map((d) => d.org_id as string))];
  // Deliberately NOT filtered by orgs.is_test — but not for the reason this
  // comment used to give.
  //
  // It claimed ablute_'s org row is is_test = true and that filtering would
  // drop the only org whose sectors matter. Prompt 568: ablute_ is
  // is_test = FALSE, deliberately and correctly. The team's own account is
  // meant to behave as a real org so the full flow can be validated before
  // launch, and every gate that reads is_test (monthly delivery, automation
  // rules, catalog_outreach_supply, pipeline tracking) is supposed to be live
  // for it. The old comment also cited catalog-sector-fit.ts and
  // scripts/_pilot_run.mjs as corroboration; neither says it — the first does
  // not contain the string is_test at all.
  //
  // The conclusion survives on its own merits: this is a back-office lookup of
  // org sectors for rows that have ALREADY been delivered, not a business
  // metric. Excluding a test org here would leave its delivered catalog rows
  // with no sector to judge fit against, which is worse than including it.
  // (Business metrics are a different matter — backoffice-metrics.ts's
  // realOrgs() does filter is_test, since Prompt 569.)
  const { data: deliveredOrgs } = deliveredOrgIds.length
    ? await admin.from('orgs').select('id, sectors').in('id', deliveredOrgIds)
    : { data: [] as { id: string; sectors: string[] | null }[] };
  const orgSectorsById = new Map((deliveredOrgs ?? []).map((o) => [o.id as string, (o.sectors as string[] | null) ?? []]));

  function deliveredOrgsSectorsFor(catalogId: string): string[][] {
    return [...(orgIdsByCatalog.get(catalogId) ?? [])].map((orgId) => orgSectorsById.get(orgId) ?? []);
  }

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
  //
  // Prompt 281 §1 — the €1.25 run that enriched GapMinder (AI/Deeptech/
  // SaaS B2B, zero healthtech overlap) is what this fixes: "delivered" and
  // "cheapest to finish" both said GO on that row; nothing before this ever
  // asked whether it was worth showing to ablute_ at all. Fit is now the
  // TOP-level sort key, ABOVE delivered/verified/completeness — a fund with
  // real fit but zero deliveries still loses to a delivered-but-mismatched
  // one only because 'fit' requires having been delivered somewhere to
  // judge against in the first place (see catalog-sector-fit.ts); it never
  // outranks a delivered low-fit row on some other, unrelated basis.
  // Everything else in the existing chain becomes the tiebreak WITHIN the
  // same fit tier, exactly as asked ("nunca acima dele").
  // Prompt 544 Part E — the rows a real founder is stuck on, first.
  //
  // Everything below this line is a platform-wide judgement: sector fit,
  // delivery count, completeness. None of it asks "is a founder sitting in
  // front of this row right now, unable to contact anyone?" — which is the
  // whole reason the campaign exists. catalog_outreach_supply answers that
  // per active founder org, and a row in someone's top-20 with readiness
  // below 40 is the one whose enrichment turns an unusable pipeline row into
  // a usable one today.
  //
  // Deliberately ABOVE fit: fit decides whether a row is worth showing at
  // all, and these rows are already BEING shown. Enriching them is not a bet
  // on future relevance, it is finishing something already delivered.
  //
  // Never fatal — if the RPC fails the queue keeps its previous order rather
  // than the page failing.
  //
  // Prompt 560 §A — two tiers, not one. catalog_outreach_supply used to see
  // only UNDELIVERED candidates, because it was built on catalog_top_matches,
  // which excludes anything already delivered. So the row a founder is
  // actually staring at today — delivered, in their pipeline, and unusable —
  // could not appear here at all, and the queue prioritised rows nobody has
  // been shown yet over finishing what was already promised. Delivered-and-
  // stuck now ranks above undelivered-and-stuck, which still ranks above
  // everything else.
  const stuckDelivered = new Set<string>();
  const stuckCandidates = new Set<string>();
  try {
    const { data: supply } = await admin.rpc('catalog_outreach_supply', { p_top: 20 });
    for (const r of (supply ?? []) as Record<string, unknown>[]) {
      if (((r.readiness as number) ?? 0) >= 40) continue;
      (r.delivered ? stuckDelivered : stuckCandidates).add(r.catalog_id as string);
    }
  } catch { /* ordering falls back to the pre-544 chain */ }
  const stuckCatalogIds = new Set<string>([...stuckDelivered, ...stuckCandidates]);
  const stuckRank = (id: string) => (stuckDelivered.has(id) ? 2 : stuckCandidates.has(id) ? 1 : 0);

  const fitRank = (f: SectorFitResult) => (f === 'fit' ? 1 : 0);
  const candidates = pending
    .filter((e) => !chronicFailures.has(e.id))
    .map((e) => ({
      id: e.id, name: e.name, verified: e.verification_status === 'verified',
      deliveredCount: deliveredCount.get(e.id) ?? 0, existingFields: existingFieldCount(e),
      fit: catalogEntitySectorFit(e.sectors, e.thesis, deliveredOrgsSectorsFor(e.id)),
      // Prompt 544 Part E — "a founder is stuck on this row today".
      blockingFounder: stuckCatalogIds.has(e.id),
    }))
    .sort((a, b) =>
      stuckRank(b.id) - stuckRank(a.id)
      || fitRank(b.fit) - fitRank(a.fit)
      || (b.deliveredCount > 0 ? 1 : 0) - (a.deliveredCount > 0 ? 1 : 0)
      || (b.verified ? 1 : 0) - (a.verified ? 1 : 0)
      || b.deliveredCount - a.deliveredCount
      || b.existingFields - a.existingFields
      || a.name.localeCompare(b.name));

  const chronicFailureList = pending
    .filter((e) => chronicFailures.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, ...chronicFailures.get(e.id)! }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Prompt 281 §3 — standalone Layer 2 candidates: catalog_people reset
  // back to hook_status='to_research' (Maschmeyer + the 4 GapMinder people,
  // both violating 280's language rule and/or 281's hook-usability
  // criterion) whose ENTITY is already enrichment_status='enriched'. The
  // normal Layer-1-driven flow (collect-entity-layer1-result's own
  // peopleNeedingLayer2) only ever re-surfaces a person the moment THEIR
  // entity's Layer 1 finishes — an already-enriched entity never re-enters
  // `candidates` above (it's not 'pending'), so without this list these 5
  // people would sit at hook_status='to_research' with no path back into
  // the campaign at all — silently stuck, not genuinely "in the queue" as
  // Prompt 281 §3 asks. Same fit gate as entity candidates, computed from
  // the PERSON's own entity's sectors/thesis (fit is entity-level data).
  const { data: layer2Raw } = await admin.from('catalog_people')
    .select('id, full_name, hook_status, entity_id, catalog_entities!inner(id, name, sectors, thesis, enrichment_status, is_test)')
    .eq('hook_status', 'to_research');
  const layer2Candidates = (layer2Raw ?? [])
    .map((p) => ({ ...p, entity: p.catalog_entities as unknown as { id: string; name: string; sectors: string[] | null; thesis: string | null; enrichment_status: string; is_test: boolean } }))
    .filter((p) => !p.entity.is_test && p.entity.enrichment_status === 'enriched')
    .map((p) => ({
      id: p.id as string, name: p.full_name as string, entityName: p.entity.name,
      fit: catalogEntitySectorFit(p.entity.sectors, p.entity.thesis, deliveredOrgsSectorsFor(p.entity.id)),
    }))
    .sort((a, b) => fitRank(b.fit) - fitRank(a.fit) || a.name.localeCompare(b.name));

  return NextResponse.json({
    ok: true, counts: { ...counts, chronicFetchFailures: chronicFailures.size }, candidates, chronicFailures: chronicFailureList, layer2Candidates,
  });
}
