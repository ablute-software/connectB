// SherlockDeal_Metricas_BackOffice_V1, Section 13 — one centralized write
// path for analytics_events, so "a mesma definição de evento" is enforced
// by construction (13.2: "As definições das métricas devem estar
// centralizadas"). Server-only, always via the service-role client callers
// already hold — this never runs client-side.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// The exact 23 fields from Section 13.1, minus id/created_at (row
// metadata, not spec fields). Every field beyond the four required ones is
// optional PER EVENT — an event only fills the dimensions it actually has,
// never a fabricated value for the ones it doesn't.
export interface AnalyticsEvent {
  organizationId: string;
  organizationType: 'startup' | 'investor';
  eventType: string;
  eventTimestamp?: string; // defaults to now() in the DB if omitted
  planAtEventTime?: string | null;
  billingFrequencyAtEventTime?: string | null;
  countryAtEventTime?: string | null;
  sectorAtEventTime?: string | null;
  stageAtEventTime?: string | null;
  relatedStartupId?: string | null;
  relatedInvestorId?: string | null;
  pipelineRelationId?: string | null;
  investorSource?: string | null;
  acquisitionSource?: string | null;
  featureSource?: string | null;
  automationId?: string | null;
  campaignOrThreadId?: string | null;
  result?: string | null;
  status?: string | null;
  failureCategory?: string | null;
  sourceOfAction?: 'manual' | 'automatic' | 'system_generated' | null;
  promoCodeId?: string | null;
  partnerId?: string | null;
  dataRoomAccessLevel?: string | null;
}

// Fire-and-forget by design (same pattern as regenerateNowSummary's own
// .catch(() => {})): a metrics write must never be the reason a real user
// action fails. Callers await this for ordering, not for error handling.
export async function logEvent(admin: SupabaseClient, e: AnalyticsEvent): Promise<void> {
  try {
    await admin.from('analytics_events').insert({
      organization_id: e.organizationId,
      organization_type: e.organizationType,
      event_type: e.eventType,
      event_timestamp: e.eventTimestamp ?? new Date().toISOString(),
      plan_at_event_time: e.planAtEventTime ?? null,
      billing_frequency_at_event_time: e.billingFrequencyAtEventTime ?? null,
      country_at_event_time: e.countryAtEventTime ?? null,
      sector_at_event_time: e.sectorAtEventTime ?? null,
      stage_at_event_time: e.stageAtEventTime ?? null,
      related_startup_id: e.relatedStartupId ?? null,
      related_investor_id: e.relatedInvestorId ?? null,
      pipeline_relation_id: e.pipelineRelationId ?? null,
      investor_source: e.investorSource ?? null,
      acquisition_source: e.acquisitionSource ?? null,
      feature_source: e.featureSource ?? null,
      automation_id: e.automationId ?? null,
      campaign_or_thread_id: e.campaignOrThreadId ?? null,
      result: e.result ?? null,
      status: e.status ?? null,
      failure_category: e.failureCategory ?? null,
      source_of_action: e.sourceOfAction ?? null,
      promo_code_id: e.promoCodeId ?? null,
      partner_id: e.partnerId ?? null,
      data_room_access_level: e.dataRoomAccessLevel ?? null,
    });
  } catch {
    // Never break the caller's real action over a metrics write.
  }
}

// Section 3 — "excluir utilizadores internos, organizações de teste,
// contas de demonstração, eventos de testes". This schema has no is_test/
// is_demo column on orgs or catalog_entities (checked directly), so
// exclusion is by naming convention: every fabricated fixture this session
// (and the sessions before it) has used a "ZZ-TEST" name prefix precisely
// so it stays mechanically distinguishable, plus the one known fixed QA
// fixture (the "ablute_ — Internal QA" catalog entity, migration 0063).
// Deliberately does NOT exclude ablute_'s own real org — despite also
// being in platform_admins, it is a real production tenant (CLAUDE.md:
// "Built for ablute_ ... but designed as multi-tenant"), not test data.
// Applied at READ time only (metrics queries), never at write time — the
// event log itself keeps everything, per Section 0's "recolher tudo".
//
// Prompt 303 — the comparison itself must be case-insensitive, not just
// this constant's own casing. CLAUDE.md documents the real convention as
// lowercase "zz-test-" and says so explicitly ("case-insensitive"), and the
// server-side enforcement this same convention has elsewhere (migration
// 0183's verification_* functions, scripts/_lib/verification-write.mjs)
// already uses ilike/~*/a /i regex — case-insensitive by construction. This
// function was the one place still comparing case-sensitively
// (String.prototype.startsWith), so a fixture named with the lowercase
// prefix the convention itself asks for silently was NOT excluded here,
// even though every other layer already treated it as a test fixture.
// Confirmed empirically (2026-08-21) that this was a latent defect, not yet
// a live incident: no org or catalog_entity in production matches
// "zz-test" in any capitalization today, so nothing has actually leaked
// into a real aggregate — but the next verification fixture created under
// the documented convention would have, silently.
export const TEST_ORG_NAME_PREFIX = 'ZZ-TEST';
export const QA_FIXTURE_ENTITY_NAME = 'ablute_ — Internal QA';

export function isExcludedOrgName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.toLowerCase().startsWith(TEST_ORG_NAME_PREFIX.toLowerCase()) || name === QA_FIXTURE_ENTITY_NAME;
}
