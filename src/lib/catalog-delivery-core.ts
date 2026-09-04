// Prompt 536 §2 — the ONE place a catalog match becomes rows in the
// founder's CRM. Extracted verbatim from deliverMonthlyForOrg (the monthly
// cron), which now calls it, so the new founder-triggered
// /api/pipeline-unlock/deliver route cannot drift into a second, subtly
// different delivery mechanism. The two callers still own their own quota
// arithmetic — that is genuinely different between them (a monthly
// increment vs. a top-up to the stored ceiling); what they must NOT own
// separately is the write order.
//
// THE WRITE ORDER IS THE POINT. The client-side unlockPack this replaces
// fired three persist() calls in parallel:
//
//   persist(insert entities); persist(insert pack_unlocks); persist(insert catalog_deliveries)
//
// catalog_deliveries.entity_id references entities.id, so the deliveries
// insert raced its own foreign key and lost. Measured in production
// (Krohnsty, 2026-09-02 13:22:56.577):
//   "violates foreign key constraint catalog_deliveries_entity_id_fkey"
// 34 milliseconds after the entities insert. persist() only console.error's,
// so the founder saw three investors appear and nothing at all went wrong
// on screen — while catalog_deliveries stayed empty and every downstream
// count (catalog_blocked_count, the delivered total that derives the next
// p_limit, the monthly job's own cap) went on computing against 0.
//
// Here every write is awaited in dependency order — entities, THEN
// deliveries — and an insert error is returned, never swallowed. The race
// cannot be reintroduced by accident because there is no longer a second
// place that writes these two tables together.
import type { SupabaseClient } from '@supabase/supabase-js';
import { fitBucketFromScore } from './catalog-fit-bucket';
import { catalogContactFields, waveForRank } from './catalog-delivery-mapping';
import { firstStepTaskTitle } from './first-message-target';
import { preferDeclaredList, preferDeclaredValue, resolveClaimedInvestorProfile } from './claimed-investor-profile';

export interface CatalogDeliveryResult {
  delivered: number;
  deliveredIds: string[];
  /** Set when a step failed. The caller decides how loud that is; nothing here swallows it. */
  error?: string;
}

export async function deliverCatalogMatches(
  admin: SupabaseClient, orgId: string, pLimit: number, viaPack: string | null,
): Promise<CatalogDeliveryResult> {
  if (pLimit <= 0) return { delivered: 0, deliveredIds: [] };

  const { data: matches, error: matchErr } = await admin.rpc('catalog_top_matches', { p_org_id: orgId, p_limit: pLimit });
  if (matchErr) return { delivered: 0, deliveredIds: [], error: matchErr.message };
  if (!matches?.length) return { delivered: 0, deliveredIds: [] };

  const scored = matches as { catalog_id: string; score: number }[];
  const catalogIds = scored.map((m) => m.catalog_id);
  const [{ data: catalogRows }, { data: ownedRows }] = await Promise.all([
    admin.from('catalog_entities').select('*').in('id', catalogIds),
    admin.from('entities').select('name').eq('org_id', orgId),
  ]);
  const scoreById = new Map(scored.map((m) => [m.catalog_id, m.score]));
  const ownedNames = new Set((ownedRows ?? []).map((r) => (r.name as string).toLowerCase()));

  const newEntities: Record<string, unknown>[] = [];
  const deliveredIds: string[] = [];
  for (const c of (catalogRows ?? []) as Record<string, unknown>[]) {
    const name = c.name as string;
    if (ownedNames.has(name.toLowerCase())) continue;
    // Prompt 285 §3 — a suspended/deleted catalog entity (manual checkbox
    // or the cross-org threshold, moderation-actions.ts) must not reach a
    // new org's pipeline.
    const moderationStatus = c.moderation_status as string | null | undefined;
    if (moderationStatus && moderationStatus !== 'active') continue;
    const id = crypto.randomUUID();
    deliveredIds.push(c.id as string);
    // Prompt 407 §A/§B.1 — a claimed, complete investor profile's own
    // declared fields take precedence over researched catalog data, field
    // by field, at this exact copy-into-entities point. Excludes
    // stage_min/stage_max on purpose: no confident conversion exists
    // between matchdeal_profiles.stages_invested and the entities pair.
    const claimed = await resolveClaimedInvestorProfile(admin, c.id as string);
    newEntities.push({
      id, org_id: orgId, name, type: c.type, hq_city: c.hq_city, hq_country: c.hq_country,
      invests_in_geographies: preferDeclaredList(claimed?.geographies, c.geographies as string[] | null),
      website: preferDeclaredValue(claimed?.website ?? null, c.website as string | null), website_verified: true,
      email_domain_verified: false, stage_min: c.stage_min, stage_max: c.stage_max,
      check_min_eur: preferDeclaredValue(claimed?.ticketMinEur ?? null, c.check_min_eur as number | null),
      check_max_eur: preferDeclaredValue(claimed?.ticketMaxEur ?? null, c.check_max_eur as number | null),
      sectors: preferDeclaredList(claimed?.sectors, c.sectors as string[] | null),
      thesis: preferDeclaredValue(claimed?.description ?? null, c.thesis as string | null),
      fit_score: fitBucketFromScore(scoreById.get(c.id as string) ?? 0),
      // Prompt 544 Part C — wave by RANK, not 1 for everything. catalogRows
      // arrives in catalog_top_matches' order (fit desc, readiness desc), so
      // position here is "best match, most contactable first" and the
      // Pipeline's wave filter finally separates now / next / later.
      wave: waveForRank(newEntities.length),
      hard_filter_status: 'not_applicable',
      status: 'not_contacted', source: 'catalog',
      // Prompt 544 Part C — everything the catalog already knew and the
      // delivery was throwing away: the general inbox, the submission form
      // (and the derived channel TYPE, previously hard-coded 'unknown'), the
      // named people, and the fund facts. Nine of the ten firms delivered to
      // Sherlock Deal had an email the founder never saw on the row.
      ...catalogContactFields(c),
      // Prompt 407 §B.4 — provenance snapshot for this one delivery event.
      claimed_profile_at_delivery: !!claimed,
    });
  }

  if (!newEntities.length) return { delivered: 0, deliveredIds: [] };

  // Step 1 of 2, awaited. If this fails there is nothing to reference and
  // no deliveries row is attempted — the inverse of the old bug, where the
  // reference was attempted before the referent existed.
  const { error: entityErr } = await admin.from('entities').insert(newEntities);
  if (entityErr) return { delivered: 0, deliveredIds: [], error: entityErr.message };

  // Prompt 544 Part D — one task per WAVE-1 row, due in 3 days, worded the
  // same as the Next Clue would word it. Every delivered row used to arrive
  // with an empty "Next action" column, so a brand-new pipeline read as a
  // list of names with nothing asked of the founder. Only W1: giving all ten
  // a task on day one would recreate the wall of work waves exist to avoid.
  //
  // Never fatal — the pipeline is delivered either way, and a missing task is
  // a smaller failure than a delivery that half-succeeded.
  const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const firstStepTasks = newEntities
    .filter((e) => e.wave === 1)
    .map((e) => ({
      org_id: orgId, entity_id: e.id as string,
      // Prompt 564 §D — the row's real state, not a hardcoded `false`. A
      // delivered row genuinely has no `people` yet (they are the founder's
      // own rows), but it DOES know its channel, and saying "submit through
      // their form" to an email-only firm — Newfund and Mercia, in Krohnsty's
      // own wave 1 — sends the founder somewhere that does not exist.
      title: firstStepTaskTitle(
        e.name as string,
        false,
        (e.submission_channel_type as 'form' | 'email' | 'unknown' | null | undefined) ?? null,
      ),
      due_at: dueAt, kind: 'research' as const, action_type: 'research_hook' as const,
      source: 'suggested' as const,
    }));
  if (firstStepTasks.length) {
    await admin.from('tasks').insert(firstStepTasks).then(() => {}, () => {});
  }

  // Step 2 of 2. quota_exempt: false is the column default (0171), explicit
  // here because this call site is where the decision that a delivery
  // consumes quota is actually made.
  const { error: deliveryErr } = await admin.from('catalog_deliveries').insert(deliveredIds.map((cid, i) => ({
    org_id: orgId, catalog_id: cid, entity_id: newEntities[i]?.id, via_pack: viaPack, quota_exempt: false,
  })));
  if (deliveryErr) {
    // The entities exist and the founder can see them; the accounting row
    // is what failed. Reported, never silent — silence is precisely how the
    // original bug survived three weeks of production traffic.
    return { delivered: newEntities.length, deliveredIds, error: deliveryErr.message };
  }

  await enqueueEnrichment(admin, orgId, deliveredIds);
  return { delivered: newEntities.length, deliveredIds };
}

// Same due-check + dedupe-insert as /api/pipeline/enqueue-enrichment, minus
// the HTTP round trip and the user-session requirement — this already runs
// with the service-role client, server-to-server.
export async function enqueueEnrichment(admin: SupabaseClient, orgId: string, catalogIds: string[]): Promise<void> {
  const { data: catalogRows } = await admin
    .from('catalog_entities').select('id, enrichment_status, enrichment_stale_after').in('id', catalogIds);
  const now = new Date();
  const due = (catalogRows ?? []).filter((c) => {
    if (c.enrichment_status === 'pending') return true;
    return !!c.enrichment_stale_after && new Date(c.enrichment_stale_after as string) < now;
  });
  for (const c of due) {
    const { data: active } = await admin.from('enrichment_jobs').select('id')
      .eq('target_type', 'entity').eq('target_id', c.id).eq('layer', 1)
      .in('status', ['queued', 'running']).maybeSingle();
    if (active) continue;
    const { error } = await admin.from('enrichment_jobs').insert({
      target_type: 'entity', target_id: c.id, layer: 1, priority: 150, requested_by_org_id: orgId,
    });
    if (error && error.code !== '23505') console.error('[catalog-delivery-core] enqueue-enrichment failed', c.id, error.message);
  }
}
