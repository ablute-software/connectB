// Prompt 919 E — the back office's side of website health, for one startup (Ficha do cliente): the latest analysis of each strategy with
// the RAW reason when one failed (a founder only ever reads the founder-safe sentence), whether PAGESPEED_API_KEY is set on this
// deployment, and "Force re-check", which ignores the 7-day limit. The only way to run a check outside the founder's own request, and
// only on a platform admin's click — there is no cron, no sweep over orgs (Prompt 919 F). Every forced check is written to the audit log.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { websiteHealthAvailable } from '@/lib/website-health-capability';
import { fetchPageSpeedAnalysis, pageSpeedApiKey } from '@/lib/website-health-psi';
import { runWebsiteCheck } from '@/lib/website-health-run';
import {
  checkAllowance, hasScores, latestByStrategy, normalizeWebsiteUrl, readStoredAudits, type StoredRowLike, type WebsiteStrategy,
} from '@/lib/website-health';

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: { orgId: string } | Promise<{ orgId: string }> };
const COLUMNS = 'id, url, strategy, score_performance, score_seo, score_accessibility, score_best_practices, lcp_ms, cls, inp_ms, audits, fetched_at';

function summarise(rows: StoredRowLike[], website: string | null) {
  const latest = latestByStrategy(website ? rows.filter((r) => r.url === website) : []);
  const one = (r: StoredRowLike | null) => {
    if (!r) return null;
    const stored = readStoredAudits(r.audits);
    return {
      fetchedAt: r.fetched_at, url: r.url, ok: hasScores(r), findings: stored.findings.length,
      scores: { performance: r.score_performance, seo: r.score_seo, accessibility: r.score_accessibility, bestPractices: r.score_best_practices },
      error: stored.error,
    };
  };
  return { mobile: one(latest.mobile), desktop: one(latest.desktop) } as Record<WebsiteStrategy, ReturnType<typeof one>>;
}

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  const { orgId } = await ctx.params;
  if (!UUID.test(orgId)) return NextResponse.json({ ok: false, error: 'Bad org id.' }, { status: 400 });
  if (!(await websiteHealthAvailable())) return NextResponse.json({ ok: true, available: false });

  const [{ data: org }, { data: rows }] = await Promise.all([
    admin.from('orgs').select('name, website, website_score_visible').eq('id', orgId).maybeSingle(),
    admin.from('org_website_audits').select(COLUMNS).eq('org_id', orgId).order('fetched_at', { ascending: false }).limit(30),
  ]);
  if (!org) return NextResponse.json({ ok: false, error: 'Startup not found.' }, { status: 404 });
  const website = normalizeWebsiteUrl((org.website as string | null) ?? '');
  const list = (rows ?? []) as unknown as StoredRowLike[];
  return NextResponse.json({
    ok: true, available: true, orgName: org.name, rawWebsite: org.website ?? null, website,
    keyConfigured: !!pageSpeedApiKey(), visibleToInvestors: org.website_score_visible === true,
    latest: summarise(list, website), allowance: checkAllowance(list, website, new Date()),
  });
}

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  const { orgId } = await ctx.params;
  if (!UUID.test(orgId)) return NextResponse.json({ ok: false, error: 'Bad org id.' }, { status: 400 });
  if (!(await websiteHealthAvailable())) return NextResponse.json({ ok: false, available: false, error: 'Website health is not applied in this database yet.' }, { status: 503 });

  // Prompt 919 addendum (19/10/2026) — no Google key: nothing is sent (a keyless request can only answer quota 0, and storing that as a row
  // would put "quota" on a founder's card for a configuration gap that is ours), nothing is audited, and the admin is told exactly what to do.
  const apiKey = pageSpeedApiKey();
  if (!apiKey) {
    return NextResponse.json({
      ok: false, keyConfigured: false,
      error: 'PAGESPEED_API_KEY is not set on this deployment, so Google would refuse every request (quota 0) — nothing was sent. Set it in Vercel (docs/ops/CONFIG_REGISTRY.md §1.4b), redeploy, then force the check.',
    }, { status: 503 });
  }

  const { data: org } = await admin.from('orgs').select('name, website').eq('id', orgId).maybeSingle();
  if (!org) return NextResponse.json({ ok: false, error: 'Startup not found.' }, { status: 404 });

  const outcome = await runWebsiteCheck({ orgId, website: (org.website as string | null) ?? null, force: true }, {
    now: () => new Date(),
    loadRows: async () => [],
    analyse: (target, strategy) => fetchPageSpeedAnalysis(target, strategy, { apiKey }),
    insertRows: async (toInsert) => {
      const { error } = await admin.from('org_website_audits').insert(toInsert);
      return { error: error?.message ?? null };
    },
  });
  if (outcome.kind === 'blocked') {
    return NextResponse.json({ ok: false, reason: outcome.reason, error: outcome.reason === 'no_website' ? 'This startup has no website on file.' : 'The website on file is not a public web address.' }, { status: 400 });
  }
  if (outcome.kind === 'storage_failed') return NextResponse.json({ ok: false, error: outcome.error }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'website_health_forced', subjectType: 'org', subjectId: orgId,
    detail: { orgName: org.name, website: outcome.url, results: outcome.results.map((r) => ({ strategy: r.strategy, ok: r.ok, error: r.error?.kind ?? null })), keyConfigured: !!apiKey },
  });
  const { data: rows } = await admin.from('org_website_audits').select(COLUMNS).eq('org_id', orgId).order('fetched_at', { ascending: false }).limit(30);
  return NextResponse.json({
    ok: true, anyOk: outcome.anyOk, keyConfigured: !!apiKey,
    latest: summarise((rows ?? []) as unknown as StoredRowLike[], outcome.url),
  });
}
