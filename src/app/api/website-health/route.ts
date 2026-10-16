// Prompt 919 C — what the founder's "Website health" card shows: the website on file, the latest analysis of each strategy, the summary if
// there is one, whether another check is allowed and when, and whether the founder shares the four scores with investors.
//
// Read-only, so it also answers in a Developer Viewer session (the VIEWED org's card): it reads what is stored and does nothing else —
// no check is started, nothing is charged, nothing is written. Until the migration is applied it answers `available: false` and the card
// does not appear (capability probe), instead of the Readiness page failing on a table that is not there yet.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { withActingOrg, resolveActingOrg } from '@/lib/acting-org';
import { websiteHealthAvailable } from '@/lib/website-health-capability';
import { FOUNDER_ROW_COLUMNS, buildFounderState } from '@/lib/website-health-state';
import type { StoredRowLike } from '@/lib/website-health';

export const GET = withActingOrg(async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: true, available: false });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = acting.orgId as string;

  if (!(await websiteHealthAvailable())) return NextResponse.json({ ok: true, available: false });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const [{ data: org }, { data: rows }] = await Promise.all([
    admin.from('orgs').select('website, website_score_visible').eq('id', orgId).maybeSingle(),
    admin.from('org_website_audits').select(FOUNDER_ROW_COLUMNS).eq('org_id', orgId).order('fetched_at', { ascending: false }).limit(30),
  ]);
  return NextResponse.json(buildFounderState({
    website: (org?.website as string | null | undefined) ?? null,
    visible: org?.website_score_visible as boolean | null | undefined,
    rows: (rows ?? []) as unknown as StoredRowLike[],
    now: new Date(),
  }));
});
