// Prompt 919 B — the plain-language summary of the analysis already on file: the ONLY charged part of website health (2 credits,
// `website_summary`). The Google analysis is free and was done before; this only reads it aloud, in words a founder who is not an engineer
// can act on.
//
// ORDER (proved in website-health-run.test.ts and again over this route in website-health-routes.test.ts): everything that can refuse
// without costing anything comes first (no analysis on file, a summary already exists, no API key), then the wallet is charged, and only
// then the model is called. A wallet that cannot cover it answers 402 and NOTHING else happens — the analysis stays exactly as it was and
// the card keeps showing the button. A summary that already exists is returned, never charged again (a new analysis starts a new one).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { withActingOrg, resolveActingOrg } from '@/lib/acting-org';
import { chargeAiAction } from '@/lib/ai-credits';
import { logAiCall } from '@/lib/ai-cost-log';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import { websiteHealthAvailable } from '@/lib/website-health-capability';
import { runWebsiteSummary } from '@/lib/website-health-run';
import { FOUNDER_ROW_COLUMNS, buildFounderState } from '@/lib/website-health-state';
import { WEBSITE_SUMMARY_MODEL, readStoredSummary, serializeSummary } from '@/lib/website-health-summary';
import { latestByStrategy, normalizeWebsiteUrl, primaryRow, readStoredAudits, type StoredRowLike } from '@/lib/website-health';

export const maxDuration = 60;

const ROUTE = '/api/website-health/summary';
const NOT_CONFIGURED_MSG = 'The plain-language summary isn’t available in your workspace yet.';

export const POST = withActingOrg(async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = acting.orgId as string;

  if (!(await websiteHealthAvailable())) return NextResponse.json({ ok: false, available: false, error: 'Website health is not available in your workspace yet.' }, { status: 503 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: org } = await admin.from('orgs').select('website, website_score_visible').eq('id', orgId).maybeSingle();
  const website = normalizeWebsiteUrl((org?.website as string | null | undefined) ?? '');
  const loadRows = async () => {
    const { data } = await admin.from('org_website_audits').select(FOUNDER_ROW_COLUMNS).eq('org_id', orgId).order('fetched_at', { ascending: false }).limit(30);
    return (data ?? []) as unknown as StoredRowLike[];
  };
  const stateOf = (rows: StoredRowLike[]) => buildFounderState({ website: (org?.website as string | null | undefined) ?? null, visible: org?.website_score_visible as boolean | null | undefined, rows, now: new Date() });

  // Nothing that can be refused for free is left for after the charge.
  const rows = await loadRows();
  const primary = website ? primaryRow(latestByStrategy(rows.filter((r) => r.url === website))) : null;
  if (!website || !primary) return NextResponse.json({ ok: false, error: 'Run the website check first — the summary reads its result.' }, { status: 400 });
  if (readStoredSummary(primary.summary)) return NextResponse.json({ ...stateOf(rows), alreadyDone: true });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, message: NOT_CONFIGURED_MSG });

  const stored = readStoredAudits(primary.audits);
  const cls = typeof primary.cls === 'string' ? Number(primary.cls) : primary.cls ?? null;
  const since = new Date(Date.now() - 60_000).toISOString();

  try {
    const outcome = await runWebsiteSummary(
      {
        website, strategy: primary.strategy,
        scores: { performance: primary.score_performance, seo: primary.score_seo, accessibility: primary.score_accessibility, bestPractices: primary.score_best_practices },
        metrics: { lcpMs: primary.lcp_ms ?? null, cls: Number.isFinite(cls as number) ? (cls as number) : null, inpMs: primary.inp_ms ?? null },
        findings: stored.findings,
      },
      {
        // The wallet's own RPC, with the request-scoped session: its is_org_member() check needs a real auth.uid() (see ai-credits.ts).
        charge: () => chargeAiAction(sb, orgId, 'website_summary'),
        callModel: async (body) => {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(providerErrorMessage('[website-health/summary]', await res.text()));
          const data = await res.json();
          return { content: (data.content as unknown[]) ?? [], usage: data.usage };
        },
        // Awaited on purpose (Prompt 469 §B): ai_call_log is used as an acceptance criterion, and logAiCall swallows its own errors.
        logUsage: (usage) => logAiCall({ route: ROUTE, purpose: 'website_summary', model: WEBSITE_SUMMARY_MODEL, usage: usage as never, orgId }),
        chargedCredits: async () => {
          const { data } = await admin.from('ai_credit_charges').select('credits_charged').eq('org_id', orgId).eq('action_key', 'website_summary')
            .gte('created_at', since).order('created_at', { ascending: false }).limit(1);
          return (data?.[0]?.credits_charged as number | undefined) ?? 0;
        },
      },
    );

    if (outcome.kind === 'refused') {
      // 402: nothing ran — no model call, no write, and nothing was charged. The analysis is exactly as it was.
      return NextResponse.json({ ok: false, error: outcome.error, insufficientCredits: true }, { status: 402 });
    }
    if (outcome.kind === 'unusable') {
      return NextResponse.json({ ok: false, error: 'The summary could not be produced this time. Your scores are untouched — you can ask for it again.' }, { status: 502 });
    }

    const { error } = await admin.from('org_website_audits')
      .update({ summary: serializeSummary(outcome.summary), summary_model: outcome.model, summary_credits: outcome.credits })
      .eq('id', primary.id as string).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json(stateOf(await loadRows()));
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
});
