// Prompt 919 A — run the website check: Google's PageSpeed analysis of the founder's own website, mobile and desktop, stored as the
// essentials only. FREE (it never touches the AI wallet) and limited to one per org per 7 days for the same address. A POST, never a GET:
// a GET that calls out and writes is exactly the hidden write the Developer Viewer rules forbid, and withActingOrg answers 403
// viewer_read_only to any POST in a viewer session before this runs.
//
// The two strategies run in parallel inside one function (a Hobby function lives 60 s and Google takes 10–40 s a call). Whatever Google
// says — a score, "your site would not load", "quota", "bad key" — a row is stored, so the card always has something true to show. Failures
// that are OUR side to fix (a wrong or blocked key, an exhausted quota) are logged here, with no key in the line, so they show in the logs.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { withActingOrg, resolveActingOrg } from '@/lib/acting-org';
import { websiteHealthAvailable } from '@/lib/website-health-capability';
import { fetchPageSpeedAnalysis, pageSpeedApiKey } from '@/lib/website-health-psi';
import { runWebsiteCheck } from '@/lib/website-health-run';
import { FOUNDER_ROW_COLUMNS, buildFounderState } from '@/lib/website-health-state';
import { formatCheckedDate, type StoredRowLike } from '@/lib/website-health';

export const maxDuration = 60;

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

  // Prompt 919 addendum (19/10/2026) — no Google key on this deployment: the feature is OFF, exactly as when the migration is not applied. No
  // request goes to Google (a keyless one can only answer quota 0), no row is stored, and the founder is not told to "try again later" for
  // something that will never work until the key is set. The back office sees why (keyConfigured, WebsiteHealthBackofficeCard).
  const apiKey = pageSpeedApiKey();
  if (!apiKey || !(await websiteHealthAvailable())) return NextResponse.json({ ok: false, available: false, error: 'Website health is not available in your workspace yet.' }, { status: 503 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: org } = await admin.from('orgs').select('website, website_score_visible').eq('id', orgId).maybeSingle();

  const outcome = await runWebsiteCheck({ orgId, website: (org?.website as string | null | undefined) ?? null }, {
    now: () => new Date(),
    loadRows: async () => {
      const { data } = await admin.from('org_website_audits').select(FOUNDER_ROW_COLUMNS).eq('org_id', orgId).order('fetched_at', { ascending: false }).limit(30);
      return (data ?? []) as unknown as StoredRowLike[];
    },
    analyse: (target, strategy) => fetchPageSpeedAnalysis(target, strategy, { apiKey }),
    insertRows: async (rows) => {
      const { error } = await admin.from('org_website_audits').insert(rows);
      return { error: error?.message ?? null };
    },
  });

  if (outcome.kind === 'blocked') {
    const copy: Record<string, string> = {
      no_website: 'Add your website in About › Company to run this check.',
      invalid_website: 'The website in About › Company is not a public web address — fix it there and run the check again.',
      too_soon: `Your last check is still current. You can check again on ${formatCheckedDate(outcome.nextCheckAt)}.`,
      cooldown: 'That address just failed to be analysed — give it a few minutes before trying again.',
    };
    const status = outcome.reason === 'too_soon' || outcome.reason === 'cooldown' ? 429 : 400;
    return NextResponse.json({ ok: false, reason: outcome.reason, nextCheckAt: outcome.nextCheckAt ?? null, error: copy[outcome.reason] }, { status });
  }
  if (outcome.kind === 'storage_failed') {
    console.error('[website-health] could not store an analysis', { orgId, error: outcome.error });
    return NextResponse.json({ ok: false, error: 'The check ran but could not be saved. Try again.' }, { status: 500 });
  }

  // What Google refused for OUR reasons (key, quota, an unexpected answer) goes to the logs; a founder's site that will not load does not.
  for (const r of outcome.results) {
    if (!r.ok && r.error && ['key', 'quota', 'unknown', 'network'].includes(r.error.kind)) {
      console.error('[website-health] PageSpeed refused', { orgId, strategy: r.strategy, kind: r.error.kind, httpStatus: r.error.httpStatus ?? null, keyConfigured: !!apiKey });
    }
  }

  const { data: rows } = await admin.from('org_website_audits').select(FOUNDER_ROW_COLUMNS).eq('org_id', orgId).order('fetched_at', { ascending: false }).limit(30);
  const state = buildFounderState({
    website: (org?.website as string | null | undefined) ?? null, visible: org?.website_score_visible as boolean | null | undefined,
    rows: (rows ?? []) as unknown as StoredRowLike[], now: new Date(),
  });
  return NextResponse.json({ ...state, checked: { anyOk: outcome.anyOk, results: outcome.results.map((r) => ({ strategy: r.strategy, ok: r.ok })) } });
});
