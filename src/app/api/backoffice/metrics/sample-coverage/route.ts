// Prompt 124 Block A (§2.3) — minimal REAL content for the new "Sample &
// coverage" placeholder, so it's never an empty "coming soon". This is
// deliberately not yet the full §3 doctrine (coverage-vs-external-universe
// estimate, sensor-quality %s, declared biases) — those need the C1-C5
// sensors to exist first (see the prompt's own ordering: A → C6+C7 →
// C1-C5 → B). What's here is real today: sample composition only.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { investorOrgRows } from '@/lib/backoffice-metrics';
import { isRegisteredInvestorAccount } from '@/lib/investor-account-filter';

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [{ data: orgs }, orgRows, { data: members }, { data: catalogEntities }] = await Promise.all([
    admin.from('orgs').select('stage, sectors, country, created_at'),
    investorOrgRows(admin),
    admin.from('matchdeal_investor_members').select('catalog_entity_id, created_at').eq('status', 'active'),
    admin.from('catalog_entities').select('id, type'),
  ]);

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

  return NextResponse.json({
    ok: true,
    startups: { total: (orgs ?? []).length, byStage, bySector, byCountry, cohortByMonth: startupCohortByMonth },
    investors: { total: registeredEntityIds.size, byType: investorsByType, cohortByMonth: investorCohortByMonth },
  });
}
