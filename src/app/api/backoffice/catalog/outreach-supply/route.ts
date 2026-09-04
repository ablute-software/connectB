// Prompt 544 Part E — "who is short of contactable investors, right now".
//
// The catalog is thin exactly where the promise is: 355 verified active rows,
// 67 with any affiliated person, 3 with a hook written. WHICH of those gaps
// matters is not a property of the catalog — it depends on which founder is
// looking at which rows today. This aggregates catalog_outreach_supply into
// one line per active founder org so the back-office can see it, and so
// "aos poucos vamos aumentando essa lista" has an order rather than a mood.
//
// Counts only: no firm names, no people, no emails leave this route.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export interface OutreachSupplyRow {
  orgId: string;
  orgName: string;
  matches: number;
  readyToApproach: number;
  withHook: number;
}

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data, error } = await admin.rpc('catalog_outreach_supply', { p_top: 20 });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const byOrg = new Map<string, OutreachSupplyRow>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const id = r.org_id as string;
    const row = byOrg.get(id) ?? {
      orgId: id, orgName: r.org_name as string, matches: 0, readyToApproach: 0, withHook: 0,
    };
    row.matches += 1;
    // 40 is the readiness a row needs before the founder can do anything real
    // with it: it is the weight of "at least one person with a LinkedIn
    // profile", the cheapest state that answers "who do I write to".
    if (((r.readiness as number) ?? 0) >= 40) row.readyToApproach += 1;
    if (r.has_hook) row.withHook += 1;
    byOrg.set(id, row);
  }

  return NextResponse.json({
    ok: true,
    // Worst-served first: the org with the fewest approachable rows is the one
    // the next enrichment run should be aimed at.
    rows: [...byOrg.values()].sort((a, b) =>
      a.readyToApproach - b.readyToApproach || a.orgName.localeCompare(b.orgName)),
  });
}
