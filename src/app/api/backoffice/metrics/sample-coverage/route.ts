// Prompt 124 Block B (§3) — the full sample & coverage doctrine, built
// once the C1-C5 sensors exist to measure it (Prompt 124's own ordering:
// A → C6+C7 → C1-C5 → B). Block A's version (this file, before this
// change) only had sample composition; this adds coverage-vs-known-
// universe, sensor-quality tracking, and declared biases.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { investorOrgRows } from '@/lib/backoffice-metrics';
import { isRegisteredInvestorAccount } from '@/lib/investor-account-filter';
import { isExcludedOrgName } from '@/lib/analytics-events';
import { acquisitionSourceAvailable } from '@/lib/acquisition-source-capability';
import { ABLUTE_ORG_ID } from '@/lib/ablute-org';

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

// Portugal-registered-startup count, the only external benchmark cited
// here — real, sourced, dated, never silently updated without checking
// the source again. Source: APDC / Startup Portugal, reported by Jornal
// de Negócios (2025): "5.091 startups ativas em Portugal", +8% vs 2024's
// 4.719 (ECO, Oct 2024). This is a PORTUGAL-ONLY figure — coverage below
// is computed only against the PT-based slice of our own sample, never
// against the whole sample, since no equivalent figure for other
// countries was found or is cited here.
const PT_STARTUP_UNIVERSE_ESTIMATE = 5091;
const PT_STARTUP_UNIVERSE_SOURCE = 'APDC / Startup Portugal via Jornal de Negócios, 2025';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const acquisitionAvailable = await acquisitionSourceAvailable();

  const [
    { data: orgs }, orgRows, { data: members }, { data: catalogEntities },
    { count: confirmedGrantsCount }, { data: viewsWithGrant },
    { data: allEntities },
  ] = await Promise.all([
    admin.from('orgs').select('id, stage, sectors, country, created_at, name'),
    investorOrgRows(admin),
    admin.from('matchdeal_investor_members').select('catalog_entity_id, created_at').eq('status', 'active'),
    admin.from('catalog_entities').select('id, type'),
    admin.from('access_grants').select('id', { count: 'exact', head: true }).not('confirmed_at', 'is', null),
    admin.from('document_views').select('grant_id').not('grant_id', 'is', null),
    admin.from('entities').select('org_id, source'),
  ]);
  // Separate query, only attempted once the column is confirmed to exist —
  // orgs.acquisition_source is migration 0122, PROPOSE ONLY, and a bare
  // select on a missing column would 500 the entire route otherwise.
  const orgsWithAcquisitionSource = acquisitionAvailable
    ? (await admin.from('orgs').select('id', { count: 'exact', head: true }).not('acquisition_source', 'is', null)).count
    : null;

  const byStage: Record<string, number> = {};
  const bySector: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  const startupCohortByMonth: Record<string, number> = {};
  for (const o of orgs ?? []) {
    const stage = (o.stage as string | null) ?? 'unknown';
    byStage[stage] = (byStage[stage] ?? 0) + 1;
    const country = (o.country as string | null) ?? 'unknown';
    byCountry[country] = (byCountry[country] ?? 0) + 1;
    for (const s of (o.sectors as string[] | null) ?? []) bySector[s] = (bySector[s] ?? 0) + 1;
    startupCohortByMonth[monthKey(o.created_at as string)] = (startupCohortByMonth[monthKey(o.created_at as string)] ?? 0) + 1;
  }

  const registeredEntityIds = new Set(orgRows.filter((r) => isRegisteredInvestorAccount(r.seatsLinked)).map((r) => r.entityId));
  const typeByEntity = new Map((catalogEntities ?? []).map((c) => [c.id as string, c.type as string]));
  const investorsByType: Record<string, number> = {};
  for (const entityId of registeredEntityIds) {
    const type = typeByEntity.get(entityId) ?? 'unknown';
    investorsByType[type] = (investorsByType[type] ?? 0) + 1;
  }
  const earliestByEntity = new Map<string, string>();
  for (const m of members ?? []) {
    if (!registeredEntityIds.has(m.catalog_entity_id as string)) continue;
    const existing = earliestByEntity.get(m.catalog_entity_id as string);
    const createdAt = m.created_at as string;
    if (!existing || createdAt < existing) earliestByEntity.set(m.catalog_entity_id as string, createdAt);
  }
  const investorCohortByMonth: Record<string, number> = {};
  for (const iso of earliestByEntity.values()) investorCohortByMonth[monthKey(iso)] = (investorCohortByMonth[monthKey(iso)] ?? 0) + 1;

  // Coverage estimate — PT-only, per this file's header note. orgs.country
  // is free text (the signup form's own plain input), so matched
  // tolerantly rather than against a fixed enum.
  const ptOrgsCount = (orgs ?? []).filter((o) => {
    const c = (o.country as string | null)?.trim().toLowerCase();
    return c === 'portugal' || c === 'pt';
  }).length;
  const ptCoveragePct = PT_STARTUP_UNIVERSE_ESTIMATE > 0 ? Math.round((ptOrgsCount / PT_STARTUP_UNIVERSE_ESTIMATE) * 1000) / 10 : null;

  // Sensor quality — literally measures M1/M3/M4's rollout, per §3's own
  // instruction ("o painel que mede M1–M4 e mostra o progresso da
  // instrumentação"). M2 (page_view) has no percentage-of-what to show
  // (a page view isn't attached to an "account" the way these three are),
  // so it's not included here — its own progress is visible directly as
  // app_events row counts once queried, not a %.
  const totalOrgs = (orgs ?? []).length;
  const acquisitionSourcePct = acquisitionAvailable && totalOrgs > 0 ? Math.round(((orgsWithAcquisitionSource ?? 0) / totalOrgs) * 1000) / 10 : null;
  const grantIds = new Set((viewsWithGrant ?? []).map((v) => v.grant_id));
  const documentViewsPct = (confirmedGrantsCount ?? 0) > 0 ? Math.round((grantIds.size / (confirmedGrantsCount ?? 1)) * 1000) / 10 : null;
  const entitiesTotal = (allEntities ?? []).length;
  const entitiesWithSpecificSource = (allEntities ?? []).filter((e) => e.source && e.source !== 'manual').length;
  const investorSourceCategoryPct = entitiesTotal > 0 ? Math.round((entitiesWithSpecificSource / entitiesTotal) * 1000) / 10 : null;

  // Declared biases — ablute_'s share of pipeline RELATIONS (not org
  // count: ablute_ is 1 org among many, but its imported CRM carries most
  // of the platform's entities — the actual dominance M10 flagged, e.g.
  // "718 fundraising-funnel rows ≈ 757 from ablute_ alone"). Computed, not
  // asserted; self-selection/geography stay written prose
  // (SampleCoverageTab.tsx), not a number.
  const realOrgIds = new Set((orgs ?? []).filter((o) => !isExcludedOrgName(o.name as string)).map((o) => o.id as string));
  const realEntities = (allEntities ?? []).filter((e) => realOrgIds.has(e.org_id as string));
  const abluteEntities = realEntities.filter((e) => e.org_id === ABLUTE_ORG_ID).length;
  const abluteDominancePct = realEntities.length > 0 ? Math.round((abluteEntities / realEntities.length) * 1000) / 10 : null;

  return NextResponse.json({
    ok: true,
    startups: { total: totalOrgs, byStage, bySector, byCountry, cohortByMonth: startupCohortByMonth },
    investors: { total: registeredEntityIds.size, byType: investorsByType, cohortByMonth: investorCohortByMonth },
    coverage: {
      ptSampleCount: ptOrgsCount, ptUniverseEstimate: PT_STARTUP_UNIVERSE_ESTIMATE, ptUniverseSource: PT_STARTUP_UNIVERSE_SOURCE,
      ptCoveragePct,
    },
    sensorQuality: { acquisitionSourcePct, documentViewsPct, investorSourceCategoryPct },
    biases: { abluteDominancePct, realOrgsSampleSize: realOrgIds.size },
  });
}
