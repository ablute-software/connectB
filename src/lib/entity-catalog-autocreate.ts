// Prompt 510 — when a founder adds a firm to their private pipeline
// (`entities`) that has no counterpart in the shared catalog, create the
// catalog row instead of letting the gap persist.
//
// Why this exists at all, measured before it was written: `catalog_entities`
// only ever grew through three manual/admin paths (POST
// /api/backoffice/catalog, .../catalog/promote, and manual-entities review).
// Nothing created a catalog row automatically. Meanwhile EIGHT call sites
// insert into `entities`, and `matchEntityToCatalog` — which already knows
// how to resolve an entity to its catalog row — was called from only two
// READ paths (the entity page's prefill and captureReopenSnapshot), never at
// creation time. So every import quietly widened the hole.
//
// ONE function, called by every creation path, deliberately — the same
// reasoning as applyInvestorTierToFirm: eight copies of this logic would
// drift, and the drift would be invisible (a missing catalog row looks
// exactly like a firm nobody has researched yet).
//
// Two things this must never do:
//   1. Write verification_status = 'verified'. Rows born here are 'pending',
//      which is what makes this safe by construction: the `catalog_read`
//      policy is `verification_status = 'verified' OR is_platform_admin()`,
//      verified against production while writing this, so a pending row is
//      invisible to every other org until a human verifies it. The founder
//      who triggered it still sees it, through their own catalog_deliveries
//      row (point 4 of the prompt).
//   2. Invent data. Only fields the private entity already carries are
//      copied across. No synthesis, no external lookup — enrichment is the
//      existing Layer 1 worker's job, and it has its own proven doctrine
//      (the firm's own site, source + confidence, never aggregators).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { matchEntityToCatalog } from './entity-catalog-prefill';
import { enqueueJob } from './enrichment-campaign';
import type { CatalogEntity } from './types';

// Deliberately NOT a new source value. A session that was lost before it
// could commit (same failure mode as Prompt 507) had already run the
// backfill half of this prompt against production on 2026-09-01 01:04:07Z,
// creating 231 rows under exactly this string — verified by SQL while
// writing this, along with their 231 catalog_deliveries and 231 Layer 1
// jobs. Minting a synonym like 'founder_pipeline' would split one concept
// across two buckets forever and break the "has this already been
// auto-created?" question that both the backfill and any future audit
// needs to answer. 'startup_submitted' was the prompt's own suggested
// reuse, but it is wrong here: that value means a founder deliberately
// SUBMITTED a firm to the catalog, which carries a promotion workflow this
// path does not go through.
export const AUTO_CATALOG_SOURCE = 'pipeline_auto';

// The subset of an `entities` row this needs. Kept structural rather than
// importing Entity so the API-route callers can pass the object they are
// about to insert, before it has been read back with every column.
export interface EntityForCatalog {
  id: string;
  name: string;
  website?: string | null;
  type?: string | null;
  hq_city?: string | null;
  hq_country?: string | null;
  sectors?: string[] | null;
  stage_min?: string | null;
  stage_max?: string | null;
  check_min_eur?: number | null;
  check_max_eur?: number | null;
  invests_in_geographies?: string[] | null;
}

export type CatalogLinkOutcome =
  | 'created'         // no match existed; a new pending catalog row was created
  | 'matched'         // a catalog row already existed; only the link was missing
  | 'already_linked'  // catalog row and catalog_deliveries link both already there
  | 'skipped'         // nothing to do (no usable name)
  | 'failed';         // bookkeeping failed; the entity itself is unaffected

export interface CatalogLinkResult {
  entityId: string;
  catalogId: string | null;
  outcome: CatalogLinkOutcome;
  enqueued: boolean;
  reason?: string;
}

// A catalog row shaped enough for matchEntityToCatalog, which only reads
// name and website. Kept narrow on purpose: this function is called on the
// hot path of every import, and selecting the full catalog row (thesis,
// notes, key_people…) for a name/domain comparison would be wasteful.
type CatalogCandidate = Pick<CatalogEntity, 'id' | 'name' | 'website'>;

function isTestName(name: string): boolean {
  return name.trim().toLowerCase().startsWith('zz-test-');
}

/**
 * Ensure every given entity has a shared-catalog counterpart and a link to
 * it, creating the catalog row when none exists.
 *
 * Idempotent: running it twice over the same entities produces
 * 'already_linked' the second time and never a duplicate row.
 *
 * NEVER throws. Catalog bookkeeping is secondary to the founder's own
 * pipeline write — if this fails, the entity the founder just added must
 * still exist. Failures come back as 'failed' results for the caller to log.
 */
export async function ensureCatalogEntriesForEntities(
  admin: SupabaseClient,
  orgId: string,
  entities: EntityForCatalog[],
): Promise<CatalogLinkResult[]> {
  if (!entities.length) return [];

  try {
    // One read of the catalog per batch, not per entity. `matchEntityToCatalog`
    // is reused exactly as-is (domain first, then a UNIQUE normalized-name
    // fallback) rather than reimplemented — its uniqueness requirement is a
    // deliberate safety property: an ambiguous name match would attach one
    // firm's thesis to another firm's dossier.
    const { data: catalogRows, error: catalogErr } = await admin
      .from('catalog_entities').select('id, name, website');
    if (catalogErr) {
      return entities.map((e) => ({
        entityId: e.id, catalogId: null, outcome: 'failed' as const, enqueued: false,
        reason: `catalog read failed: ${catalogErr.message}`,
      }));
    }
    // Mutable: a row created for entity #1 must be visible to entity #2 in
    // the SAME batch, or an import containing the same firm twice (two
    // spellings, one domain) would create two catalog rows for it.
    const catalog = (catalogRows ?? []) as CatalogCandidate[];

    const { data: deliveryRows } = await admin
      .from('catalog_deliveries').select('catalog_id, entity_id').eq('org_id', orgId);
    const linkedCatalogIds = new Set((deliveryRows ?? []).map((d) => d.catalog_id as string));

    // catalog_entities.source_entity_id is UNIQUE (migration 0038, verified
    // against production). That is the real, database-level guarantee that
    // this function can never duplicate a row for an entity it already
    // handled — an insert would raise 23505 rather than succeed. Reading it
    // up front turns that hard stop into an honest 'already_linked' report
    // instead of a 'failed' one, which matters for the backfill: name/domain
    // matching would normally re-find the row, but an entity with no website
    // and a non-unique name would fall through to the insert and fail.
    const { data: bySourceRows } = await admin
      .from('catalog_entities').select('id, source_entity_id')
      .in('source_entity_id', entities.map((e) => e.id));
    const catalogIdBySourceEntity = new Map(
      (bySourceRows ?? []).map((r) => [r.source_entity_id as string, r.id as string]),
    );

    const results: CatalogLinkResult[] = [];
    for (const entity of entities) {
      const already = catalogIdBySourceEntity.get(entity.id);
      if (already) {
        if (linkedCatalogIds.has(already)) {
          results.push({ entityId: entity.id, catalogId: already, outcome: 'already_linked', enqueued: false });
          continue;
        }
        // Row exists but its delivery link does not — a partially-completed
        // earlier run. Repair the link rather than creating anything.
        await insertDelivery(admin, orgId, already, entity.id);
        linkedCatalogIds.add(already);
        results.push({ entityId: entity.id, catalogId: already, outcome: 'matched', enqueued: false });
        continue;
      }
      results.push(await linkOne(admin, orgId, entity, catalog, linkedCatalogIds));
    }
    return results;
  } catch (err) {
    return entities.map((e) => ({
      entityId: e.id, catalogId: null, outcome: 'failed' as const, enqueued: false,
      reason: err instanceof Error ? err.message : String(err),
    }));
  }
}

async function linkOne(
  admin: SupabaseClient,
  orgId: string,
  entity: EntityForCatalog,
  catalog: CatalogCandidate[],
  linkedCatalogIds: Set<string>,
): Promise<CatalogLinkResult> {
  const base = { entityId: entity.id, enqueued: false };
  if (!entity.name?.trim()) {
    return { ...base, catalogId: null, outcome: 'skipped', reason: 'entity has no name' };
  }

  try {
    const match = matchEntityToCatalog(
      { name: entity.name, website: entity.website },
      catalog as CatalogEntity[],
    );

    if (match) {
      // catalog_deliveries is unique on (org_id, catalog_id). So when this
      // org already links that catalog row — including via a DIFFERENT
      // private entity earlier in the same batch (two spellings of one
      // firm) — there is no second link to make. The entity still resolves
      // to the right catalog row through matchEntityToCatalog on read; it
      // just isn't the one holding the delivery row. That is the schema's
      // constraint, not a decision made here.
      if (linkedCatalogIds.has(match.id)) {
        return { ...base, catalogId: match.id, outcome: 'already_linked' };
      }
      const linked = await insertDelivery(admin, orgId, match.id, entity.id);
      linkedCatalogIds.add(match.id);
      // No enqueue on this branch: the row already existed, so whichever
      // path created it already decided about enrichment, and the monthly
      // delivery path re-enqueues on its own staleness rule. Re-queueing
      // here would spend Layer 1 calls on rows that are already enriched.
      return linked
        ? { ...base, catalogId: match.id, outcome: 'matched' }
        : { ...base, catalogId: match.id, outcome: 'already_linked' };
    }

    // No match — create the catalog row. Only fields the private entity
    // already carries; everything absent stays null for the enrichment
    // worker to fill from the firm's own site.
    const { data: created, error: createErr } = await admin
      .from('catalog_entities')
      .insert({
        name: entity.name.trim(),
        type: entity.type ?? 'vc',
        website: entity.website ?? null,
        hq_city: entity.hq_city ?? null,
        hq_country: entity.hq_country ?? null,
        sectors: entity.sectors ?? null,
        stage_min: entity.stage_min ?? null,
        stage_max: entity.stage_max ?? null,
        check_min_eur: entity.check_min_eur ?? null,
        check_max_eur: entity.check_max_eur ?? null,
        geographies: entity.invests_in_geographies ?? null,
        // Never 'verified' from this path — see the header comment.
        verification_status: 'pending',
        source: AUTO_CATALOG_SOURCE,
        source_entity_id: entity.id,
        enrichment_status: 'pending',
        is_test: isTestName(entity.name),
      })
      .select('id, name, website')
      .single();

    if (createErr || !created) {
      return {
        ...base, catalogId: null, outcome: 'failed',
        reason: `catalog insert failed: ${createErr?.message ?? 'no row returned'}`,
      };
    }

    catalog.push(created as CatalogCandidate);
    await insertDelivery(admin, orgId, created.id as string, entity.id);
    linkedCatalogIds.add(created.id as string);

    let enqueued = false;
    try {
      // Same queue, same shape, same worker as the existing Layer 1 paths —
      // this only adds candidates to it, it does not change the worker or
      // its source doctrine.
      const job = await enqueueJob(admin, 'entity', created.id as string, 1);
      enqueued = !job.alreadyQueued;
    } catch {
      // A failed enqueue must not undo a correctly-created catalog row: the
      // row is still right, and the campaign panel can queue it later.
      enqueued = false;
    }

    return { ...base, catalogId: created.id as string, outcome: 'created', enqueued };
  } catch (err) {
    return {
      ...base, catalogId: null, outcome: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// quota_exempt: true, explicitly. catalog_deliveries doubles as the monthly
// delivery ledger, and its unique(org_id, catalog_id) is what makes this
// whole function idempotent. But this link is NOT a delivery the platform
// made to the founder — the founder brought this firm themselves. Counting
// it against their monthly quota would charge them for their own contact.
// Returns false when the row already existed (23505), which is a normal
// idempotent re-run, not an error.
async function insertDelivery(
  admin: SupabaseClient, orgId: string, catalogId: string, entityId: string,
): Promise<boolean> {
  const { error } = await admin.from('catalog_deliveries').insert({
    org_id: orgId, catalog_id: catalogId, entity_id: entityId, via_pack: null, quota_exempt: true,
  });
  return !error;
}

// Several callers (the import commit routes) run under the founder's OWN
// session client, which cannot write catalog_entities: the `catalog_admin_write`
// policy is `is_platform_admin()`, and a founder is not one. Rather than open
// an RLS exception for this path, it uses the service-role client
// server-side — the same option /api/pipeline/enqueue-enrichment already
// chose, for the same reason, and its comment says so explicitly.
//
// Returns null when the service key is absent (demo mode, local dev without
// env vars). Callers must treat null as "skip catalog bookkeeping", never as
// an error — the founder's own entity write has already succeeded by then.
export function catalogAutocreateAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** Single-entity convenience wrapper over the batch function. */
export async function ensureCatalogEntryForEntity(
  admin: SupabaseClient, orgId: string, entity: EntityForCatalog,
): Promise<CatalogLinkResult> {
  const [result] = await ensureCatalogEntriesForEntities(admin, orgId, [entity]);
  return result ?? { entityId: entity.id, catalogId: null, outcome: 'failed', enqueued: false };
}
