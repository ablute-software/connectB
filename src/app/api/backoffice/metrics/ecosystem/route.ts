// Prompt 122 Block C (F2) — the Ecosystem tab's data. Gated the same way
// every other /api/backoffice/metrics/* route is (requirePlatformAdmin(),
// itself behind middleware.ts's BLOCO 3 gate), PLUS ecosystemFactsAvailable
// — with migration 0116 unapplied this always returns { available: false },
// which is exactly what lets the tab render its "Foundation not applied
// yet" state instead of erroring.
//
// K=8 + >50%-single-org-dominance anonymity is enforced here directly
// (not just inside observatory_query): the heatmap needs a different
// aggregation shape (% of cohort orgs per category x severity cell) than
// observatory_query's generic "percentiles of one metric" contract
// answers, so this route computes it itself, re-using the SAME threshold
// constants observatory_query hard-codes — these two must be kept in sync
// if either ever changes. SRI's headline number DOES go through
// observatory_query (metric='review_score'), since that's exactly the
// shape it was built for.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { ecosystemFactsAvailable } from '@/lib/ecosystem-facts-capability';

const K_THRESHOLD = 8; // must match observatory_query's own constant (migration 0116)
const DOMINANCE_THRESHOLD = 0.5; // must match observatory_query's own constant (migration 0116)
const CATEGORIES = ['product', 'traction', 'team', 'positioning', 'financing', 'regulatory', 'market', 'metrics', 'other'];
const SEVERITIES: { label: string; value: number }[] = [{ label: 'low', value: 1 }, { label: 'medium', value: 2 }, { label: 'high', value: 3 }];

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  if (!(await ecosystemFactsAvailable())) {
    return NextResponse.json({ available: false });
  }

  const { searchParams } = new URL(req.url);
  const country = searchParams.get('country') || undefined;
  const sector = searchParams.get('sector') || undefined;
  const stage = searchParams.get('stage') || undefined;
  const sinceDays = searchParams.get('sinceDays');

  let orgQuery = admin.from('orgs').select('id');
  if (country) orgQuery = orgQuery.eq('country', country);
  if (stage) orgQuery = orgQuery.eq('stage', stage);
  if (sector) orgQuery = orgQuery.contains('sectors', [sector]);
  const { data: cohortOrgs, error: orgErr } = await orgQuery;
  if (orgErr) return NextResponse.json({ available: true, error: orgErr.message }, { status: 500 });

  const cohortOrgIds = (cohortOrgs ?? []).map((o) => o.id as string);
  const cohortN = cohortOrgIds.length;
  if (cohortN === 0) {
    return NextResponse.json({ available: true, cohortN: 0, withheld: true, sri: null, heatmap: [] });
  }

  let factsQuery = admin.from('ecosystem_facts')
    .select('org_id, metric_key, value_numeric, value_category')
    .in('org_id', cohortOrgIds)
    .in('metric_key', ['review_score', 'weakness_prevalence', 'risk_prevalence']);
  if (sinceDays) {
    const since = new Date(Date.now() - Number(sinceDays) * 86400000).toISOString();
    factsQuery = factsQuery.gte('captured_at', since);
  }
  const { data: factRows, error: factsErr } = await factsQuery;
  if (factsErr) return NextResponse.json({ available: true, error: factsErr.message }, { status: 500 });
  const rows = factRows ?? [];

  // Whole-panel anonymity gate (SRI + heatmap share one withheld state,
  // matching the spec's single "Segment below anonymity threshold"
  // message rather than a per-cell partial reveal).
  const distinctOrgs = new Set(rows.map((r) => r.org_id as string));
  const countsByOrg = new Map<string, number>();
  for (const r of rows) countsByOrg.set(r.org_id as string, (countsByOrg.get(r.org_id as string) ?? 0) + 1);
  const maxShare = rows.length > 0 ? Math.max(...countsByOrg.values()) / rows.length : 0;
  const withheld = distinctOrgs.size < K_THRESHOLD || maxShare > DOMINANCE_THRESHOLD;

  let sri: { score: number } | null = null;
  const heatmap: { category: string; severity: string; pctOfCohort: number }[] = [];

  if (!withheld) {
    const scores = rows.filter((r) => r.metric_key === 'review_score' && r.value_numeric != null).map((r) => r.value_numeric as number);
    if (scores.length > 0) {
      const sorted = [...scores].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      sri = { score: Math.round(median) };
    }

    const findingRows = rows.filter((r) => r.metric_key === 'weakness_prevalence' || r.metric_key === 'risk_prevalence');
    for (const category of CATEGORIES) {
      for (const sev of SEVERITIES) {
        const orgsWithCell = new Set(
          findingRows.filter((r) => r.value_category === category && r.value_numeric === sev.value).map((r) => r.org_id as string),
        );
        if (orgsWithCell.size === 0) continue;
        heatmap.push({ category, severity: sev.label, pctOfCohort: Math.round((orgsWithCell.size / cohortN) * 100) });
      }
    }
  }

  return NextResponse.json({ available: true, cohortN, withheld, sri, heatmap });
}
