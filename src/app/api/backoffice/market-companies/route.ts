// Prompt 574 §D — "Competitor intel: é uma fila ou uma vista?" Diagnosed
// directly before writing anything: the backoffice's existing "Competitor
// intel" tab (CompetitorIntelTab.tsx) is entirely about investor_investments
// (which fund invested in which company) — it never reads or writes
// org_competitors at all. A repo-wide search for org_competitors (17 files)
// found zero backoffice/admin surface touching it either — every usage is
// founder-side market research (src/lib/market-competition.ts and friends).
// So there is no review action to move OUT of Review; this is a genuinely
// new, additive, read-only aggregation — "which orgs list this company as
// competitor (n)" — not a relocation of existing admin functionality.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { orgCompetitorsAvailable } from '@/lib/market-data-capability';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  if (!(await orgCompetitorsAvailable())) return NextResponse.json({ ok: true, companies: [] });

  const { data: rows, error } = await admin.from('org_competitors')
    .select('market_company_id, org_id, relation, positioning, competitor_type, orgs(name)');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const companyIds = [...new Set((rows ?? []).map((r) => r.market_company_id as string))];
  const { data: companies } = companyIds.length
    ? await admin.from('market_companies').select('id, name, domain, company_type, sectors, life_status').in('id', companyIds)
    : { data: [] as { id: string; name: string; domain: string | null; company_type: string | null; sectors: string[] | null; life_status: string | null }[] };
  const companyById = new Map((companies ?? []).map((c) => [c.id, c]));

  const grouped = new Map<string, { orgNames: string[]; relations: string[]; positionings: string[]; competitorTypes: string[] }>();
  for (const r of rows ?? []) {
    const id = r.market_company_id as string;
    const g = grouped.get(id) ?? { orgNames: [], relations: [], positionings: [], competitorTypes: [] };
    const orgName = (r.orgs as unknown as { name: string } | null)?.name;
    if (orgName) g.orgNames.push(orgName);
    if (r.relation) g.relations.push(r.relation as string);
    if (r.positioning) g.positionings.push(r.positioning as string);
    if (r.competitor_type) g.competitorTypes.push(r.competitor_type as string);
    grouped.set(id, g);
  }

  const result = [...grouped.entries()]
    .map(([companyId, g]) => {
      const company = companyById.get(companyId);
      return {
        companyId, companyName: company?.name ?? '(unknown company)', domain: company?.domain ?? null,
        companyType: company?.company_type ?? null, sectors: company?.sectors ?? [], lifeStatus: company?.life_status ?? null,
        orgCount: g.orgNames.length, orgNames: g.orgNames,
        relations: [...new Set(g.relations)], positionings: [...new Set(g.positionings)], competitorTypes: [...new Set(g.competitorTypes)],
      };
    })
    .sort((a, b) => b.orgCount - a.orgCount);

  return NextResponse.json({ ok: true, companies: result });
}
