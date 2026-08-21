// Prompt 293 §2 — data for the backoffice "AI Costs" tab. Single source:
// ai_call_log (migration 0202) — reads the exact same ledger every
// instrumented route now writes to (see src/lib/ai-cost-log.ts), never
// enrichment_jobs directly (that table still exists for the worker's own
// per-job telemetry/cost caps, but every completed job is ALSO mirrored
// here — see flushTelemetry in the enrichment-worker).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { aiCallLogAvailable } from '@/lib/ai-call-log-capability';

// Prompt 293 §2 — human-readable mechanism names, keyed by the exact
// `purpose` string each instrumented call site logs (see ai-cost-log.ts
// call sites across the app). Kept as one map here rather than scattered
// literals, so a renamed purpose only needs updating in one place.
const MECHANISM_LABEL: Record<string, string> = {
  'review:message_review': 'AI Review — outreach draft',
  'review:deck_review': 'AI Review — deck',
  'review:one_pager_review': 'AI Review — one-pager',
  'review:business_plan_review': 'AI Review — business plan',
  'review:financial_plan_review': 'AI Review — financial plan',
  'review:marketing_plan_review': 'AI Review — marketing plan',
  'review:cap_table_review': 'AI Review — cap table',
  cross_document_review: 'AI Review — cross-document check',
  classify_interaction: 'Classify interaction',
  coaching_feedback: 'Train — coaching feedback',
  field_arbitration: 'Community consensus — field arbitration',
  compose_outreach: 'Compose (message drafts)',
  nda_cross_check: 'NDA match check',
  entity_enrich: 'Enrichment — Entity (founder-triggered)',
  form_questions_extract: 'Form questions extraction',
  form_assist_draft: 'Form assist',
  import_extract_history: 'Import — extract history',
  import_extract_people: 'Import — extract people',
  needs_review_classify: 'Needs-review classification',
  reawakening_evaluate: 'Reawakening — fact evaluator',
  neglect_evaluate: 'Reawakening — neglect evaluator',
  rejection_filter: 'Reawakening — rejection filter',
  investability_report: 'Investability report',
  investor_safe_swot: 'Investability — investor-safe SWOT',
  admin_research: 'Backoffice — AI research',
  'enrichment:entity': 'Enrichment — Entity',
  'enrichment:person': 'Enrichment — Person',
};

function mechanismLabel(purpose: string): string {
  return MECHANISM_LABEL[purpose] ?? purpose;
}

interface CallRow {
  route: string; purpose: string; model: string;
  cost_eur: number; org_id: string | null; created_at: string;
}

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  if (!(await aiCallLogAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 86400_000);
  const since60 = new Date(now.getTime() - 60 * 86400_000);
  const since6mo = new Date(now.getTime());
  since6mo.setMonth(since6mo.getMonth() - 6);

  const [{ data: rows60, error }, { data: rows6mo }] = await Promise.all([
    admin.from('ai_call_log').select('route, purpose, model, cost_eur, org_id, created_at').gte('created_at', since60.toISOString()),
    admin.from('ai_call_log').select('cost_eur, org_id, created_at').gte('created_at', since6mo.toISOString()),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const all60 = (rows60 ?? []) as CallRow[];
  const last30 = all60.filter((r) => new Date(r.created_at) >= since30);
  const prior30 = all60.filter((r) => new Date(r.created_at) < since30);

  const totalSpend30dEur = last30.reduce((s, r) => s + (r.cost_eur ?? 0), 0);
  const totalSpendPrior30dEur = prior30.reduce((s, r) => s + (r.cost_eur ?? 0), 0);

  // Prompt 293 §2 — per-org attribution excludes shared-catalog rows
  // (org_id null) from every per-startup figure; that spend is reported
  // as its own line, never split arbitrarily across orgs.
  const perOrg30d = last30.filter((r) => r.org_id);
  const sharedCatalog30dEur = last30.filter((r) => !r.org_id).reduce((s, r) => s + (r.cost_eur ?? 0), 0);

  const orgIds = Array.from(new Set(perOrg30d.map((r) => r.org_id as string)));
  const { data: orgs } = orgIds.length ? await admin.from('orgs').select('id, name').in('id', orgIds) : { data: [] as { id: string; name: string }[] };
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  const spendByOrg = new Map<string, number>();
  const mechanismSpendByOrg = new Map<string, Map<string, number>>();
  for (const r of perOrg30d) {
    const oid = r.org_id as string;
    spendByOrg.set(oid, (spendByOrg.get(oid) ?? 0) + (r.cost_eur ?? 0));
    if (!mechanismSpendByOrg.has(oid)) mechanismSpendByOrg.set(oid, new Map());
    const m = mechanismSpendByOrg.get(oid)!;
    m.set(r.purpose, (m.get(r.purpose) ?? 0) + (r.cost_eur ?? 0));
  }
  const activeStartupCount = spendByOrg.size;
  const totalPerOrgSpend30dEur = Array.from(spendByOrg.values()).reduce((s, v) => s + v, 0);
  const avgCostPerActiveStartupEur = activeStartupCount > 0 ? totalPerOrgSpend30dEur / activeStartupCount : 0;

  const ranking = Array.from(spendByOrg.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([orgId, amountEur], i) => {
      const mechs = mechanismSpendByOrg.get(orgId)!;
      const topMechanism = Array.from(mechs.entries()).sort((a, b) => b[1] - a[1])[0];
      return {
        rank: i + 1,
        orgId,
        orgName: orgNameById.get(orgId) ?? '(deleted org)',
        amountEur,
        pctOfTotal: totalPerOrgSpend30dEur > 0 ? (amountEur / totalPerOrgSpend30dEur) * 100 : 0,
        topMechanism: topMechanism ? mechanismLabel(topMechanism[0]) : '—',
      };
    });
  const maxRankingAmount = ranking[0]?.amountEur ?? 0;
  const rankingWithBar = ranking.map((r) => ({ ...r, barPct: maxRankingAmount > 0 ? (r.amountEur / maxRankingAmount) * 100 : 0 }));

  // Cost by mechanism — across ALL 30d spend (per-org + shared), since the
  // prompt asks "que ferramentas geram mais custo", not scoped to orgs only.
  const spendByMechanism = new Map<string, number>();
  for (const r of last30) spendByMechanism.set(r.purpose, (spendByMechanism.get(r.purpose) ?? 0) + (r.cost_eur ?? 0));
  const mechanisms = Array.from(spendByMechanism.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([purpose, amountEur]) => ({ name: mechanismLabel(purpose), amountEur }));
  const maxMechanismAmount = mechanisms[0]?.amountEur ?? 0;
  const mechanismsWithPct = mechanisms.map((m) => ({ ...m, pct: maxMechanismAmount > 0 ? (m.amountEur / maxMechanismAmount) * 100 : 0 }));

  const mostExpensiveMechanism = mechanismsWithPct[0]
    ? { name: mechanismsWithPct[0].name, amountEur: mechanismsWithPct[0].amountEur, pctOfTotal: totalSpend30dEur > 0 ? (mechanismsWithPct[0].amountEur / totalSpend30dEur) * 100 : 0 }
    : null;

  // Trend — avg cost per active startup, per calendar month, last 6 months.
  const monthBuckets = new Map<string, { total: number; orgs: Set<string> }>();
  for (const r of (rows6mo ?? []) as { cost_eur: number; org_id: string | null; created_at: string }[]) {
    if (!r.org_id) continue; // trend is per-startup, same shared-catalog exclusion as the ranking
    const monthKey = r.created_at.slice(0, 7);
    if (!monthBuckets.has(monthKey)) monthBuckets.set(monthKey, { total: 0, orgs: new Set() });
    const bucket = monthBuckets.get(monthKey)!;
    bucket.total += r.cost_eur ?? 0;
    bucket.orgs.add(r.org_id);
  }
  const monthKeys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const trend = monthKeys.map((key) => {
    const bucket = monthBuckets.get(key);
    const avg = bucket && bucket.orgs.size > 0 ? bucket.total / bucket.orgs.size : 0;
    const [y, m] = key.split('-');
    const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
    return { month: label, avgCostEur: avg };
  });

  return NextResponse.json({
    ok: true,
    totalSpend30dEur, totalSpendPrior30dEur,
    activeStartupCount, avgCostPerActiveStartupEur,
    mostExpensiveMechanism,
    mechanisms: mechanismsWithPct,
    trend,
    ranking: rankingWithBar,
    sharedCatalog30dEur,
  });
}
