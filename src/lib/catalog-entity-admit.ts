// Prompt 560 §A — "this catalog firm becomes an entity in this org's
// pipeline", extracted so there is one of it.
//
// The body below is Prompt 318's `admitInvestorIntoReferredOrgPipeline`
// verbatim, which in turn mirrors matchdeal_record_interest_notification's
// entity-creation shape (migration 0171) field for field. It moved here
// because Prompt 560 adds a THIRD caller ("Add to pipeline" on a registered
// recipient's row) and three hand-copied versions of a mapper that decides
// quota exemption, identity evidence and `source` is how they drift.
//
// The two decisions inside it that are not obvious, kept from 318's own
// comment because they are the reason this shape exists:
//
//   * `quota_exempt: true` is what actually exempts the delivery —
//     catalog_deliveries_enforce_quota's trigger skips the count for an
//     exempt row. Setting it is the exemption; nothing else is.
//   * `source: 'investor_invite'` — allowed by entities_source_check since
//     migration 0122, and the honest value here: the founder did not choose
//     this firm off a list ('manual'), and no MatchDeal swipe happened
//     ('match_deal'). An investor they invited turned out to have an
//     account. No migration is needed for it.
//
// Idempotent by catalog_deliveries: a firm already delivered to this org is
// returned, never delivered twice.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AdmitResult =
  | { ok: true; entityId: string; created: boolean }
  | { ok: false; reason: 'catalog_entity_not_found' | 'entity_insert_failed'; error?: string };

export async function admitCatalogEntityIntoPipeline(
  admin: SupabaseClient, orgId: string, catalogEntityId: string,
): Promise<AdmitResult> {
  const { data: existingDelivery } = await admin.from('catalog_deliveries')
    .select('entity_id').eq('org_id', orgId).eq('catalog_id', catalogEntityId).maybeSingle();
  if (existingDelivery?.entity_id) {
    return { ok: true, entityId: existingDelivery.entity_id as string, created: false };
  }

  const { data: catalogEntity } = await admin.from('catalog_entities').select('*').eq('id', catalogEntityId).maybeSingle();
  if (!catalogEntity) return { ok: false, reason: 'catalog_entity_not_found' };

  const emailDomain = catalogEntity.email ? (String(catalogEntity.email).split('@')[1]?.toLowerCase() ?? null) : null;
  // Migration 0049's identity-evidence rule: an entity with nothing that
  // identifies a real organisation is marked a stub rather than refused.
  const hasEvidence = !!(catalogEntity.website || emailDomain || catalogEntity.phone || catalogEntity.address);

  const { data: newEntity, error: entityError } = await admin.from('entities').insert({
    org_id: orgId, name: catalogEntity.name, type: catalogEntity.type,
    hq_city: catalogEntity.hq_city, hq_country: catalogEntity.hq_country,
    website: catalogEntity.website, website_verified: !!catalogEntity.website,
    email: catalogEntity.email, email_domain: emailDomain, phone: catalogEntity.phone, address: catalogEntity.address,
    unverified_stub_at: hasEvidence ? null : new Date().toISOString(),
    stage_min: catalogEntity.stage_min, stage_max: catalogEntity.stage_max,
    check_min_eur: catalogEntity.check_min_eur, check_max_eur: catalogEntity.check_max_eur,
    sectors: catalogEntity.sectors, thesis: catalogEntity.thesis, fit_score: 'high', wave: 1,
    submission_channel_type: 'unknown', hard_filter_status: 'not_applicable', status: 'not_contacted',
    source: 'investor_invite',
  }).select('id').single();
  if (entityError || !newEntity) {
    return { ok: false, reason: 'entity_insert_failed', error: entityError?.message };
  }

  const { error: deliveryError } = await admin.from('catalog_deliveries').insert({
    org_id: orgId, catalog_id: catalogEntityId, entity_id: newEntity.id, via_pack: null, quota_exempt: true,
  });
  // The entity exists and is usable; a missing delivery row only costs the
  // "already in this pipeline" check next time, so it is logged, not fatal.
  if (deliveryError) console.error('[catalog-entity-admit] delivery row failed:', deliveryError.message);

  return { ok: true, entityId: newEntity.id as string, created: true };
}
