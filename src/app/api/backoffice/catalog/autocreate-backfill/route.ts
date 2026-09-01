// Prompt 510 — the one-off half of the prompt: run the SAME auto-create
// function over every entity that has no shared-catalog counterpart yet,
// closing the gap that already exists rather than only stopping it growing.
//
// Why a platform-admin route and not a scripts/*.mjs one, which is where
// backfills usually live here: the prompt's own requirement is that this run
// "a mesma função" as the live path. Scripts in this repo are plain Node ESM
// and cannot import the TypeScript module (no ts-node/tsx dependency), so a
// script would have to reimplement domain-first/unique-name matching in
// JavaScript — a second copy of exactly the logic this prompt exists to
// centralise, and one that could drift from the real one silently. A route
// calls the real function, with no duplication at all.
//
// Idempotent twice over: catalog_entities.source_entity_id is UNIQUE and
// catalog_deliveries is unique on (org_id, catalog_id), and
// ensureCatalogEntriesForEntities reads both before writing. Re-running
// reports 'already_linked' rather than creating anything.
//
// Dry-run by default. A caller must pass { apply: true } to write, so an
// accidental GET-like POST cannot mutate the catalog.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import {
  ensureCatalogEntriesForEntities, type CatalogLinkResult, type EntityForCatalog,
} from '@/lib/entity-catalog-autocreate';

const ENTITY_COLUMNS =
  'id, org_id, name, website, type, hq_city, hq_country, sectors, stage_min, stage_max, '
  + 'check_min_eur, check_max_eur, invests_in_geographies';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json().catch(() => ({})) as { apply?: boolean };
  const apply = body.apply === true;

  // Every entity that has no catalog_deliveries row. Read in full rather
  // than joined: PostgREST cannot express "not exists" across the join, and
  // at this size (hundreds of rows) the diff is cheaper in JS than a view.
  const { data, error: entityErr } = await admin.from('entities').select(ENTITY_COLUMNS);
  if (entityErr) return NextResponse.json({ ok: false, error: entityErr.message }, { status: 500 });
  // supabase-js can only infer row shape from a LITERAL select string; the
  // column list here is a shared constant, so it falls back to
  // GenericStringError. The cast is the shape the query actually returns.
  const entityRows = (data ?? []) as unknown as Record<string, unknown>[];

  const { data: deliveryRows, error: deliveryErr } = await admin
    .from('catalog_deliveries').select('entity_id').not('entity_id', 'is', null);
  if (deliveryErr) return NextResponse.json({ ok: false, error: deliveryErr.message }, { status: 500 });

  const linkedEntityIds = new Set((deliveryRows ?? []).map((d) => d.entity_id as string));
  const unlinked = entityRows.filter((e) => !linkedEntityIds.has(e.id as string));

  if (!apply) {
    return NextResponse.json({
      ok: true, dryRun: true, totalEntities: entityRows.length, unlinked: unlinked.length,
      byOrg: countByOrg(unlinked),
      sample: unlinked.slice(0, 20).map((e) => ({ id: e.id, name: e.name, website: e.website })),
    });
  }

  // Grouped by org because catalog_deliveries is scoped to an org: the
  // "is this already linked?" question has a different answer per org, and
  // the function reads that set once per call.
  const byOrg = new Map<string, EntityForCatalog[]>();
  for (const e of unlinked) {
    const orgId = e.org_id as string;
    if (!byOrg.has(orgId)) byOrg.set(orgId, []);
    byOrg.get(orgId)!.push({
      id: e.id as string, name: e.name as string, website: e.website as string | null,
      type: e.type as string | null, hq_city: e.hq_city as string | null,
      hq_country: e.hq_country as string | null, sectors: e.sectors as string[] | null,
      stage_min: e.stage_min as string | null, stage_max: e.stage_max as string | null,
      check_min_eur: e.check_min_eur as number | null, check_max_eur: e.check_max_eur as number | null,
      invests_in_geographies: e.invests_in_geographies as string[] | null,
    });
  }

  const results: CatalogLinkResult[] = [];
  for (const [orgId, entities] of byOrg) {
    results.push(...await ensureCatalogEntriesForEntities(admin, orgId, entities));
  }

  const report = {
    processed: results.length,
    created: results.filter((r) => r.outcome === 'created').length,
    matched: results.filter((r) => r.outcome === 'matched').length,
    alreadyLinked: results.filter((r) => r.outcome === 'already_linked').length,
    skipped: results.filter((r) => r.outcome === 'skipped').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
    enqueued: results.filter((r) => r.enqueued).length,
    // Named, not just counted: a silent failure count is the thing that
    // makes a backfill look complete when it isn't.
    failures: results.filter((r) => r.outcome === 'failed')
      .map((r) => ({ entityId: r.entityId, reason: r.reason })),
  };

  await logAdminAction(admin, {
    adminUserId: userId, action: 'catalog_autocreate_backfill', subjectType: 'catalog_entities',
    detail: report,
  });

  return NextResponse.json({ ok: true, dryRun: false, ...report });
}

function countByOrg(rows: Record<string, unknown>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const orgId = r.org_id as string;
    out[orgId] = (out[orgId] ?? 0) + 1;
  }
  return out;
}
