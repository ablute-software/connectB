// Prompt 164 B — this investor's weighted scorecard average per startup
// org, for the Pipeline card badge. Exactly the same weighted-average
// formula ScorecardPanel.tsx computes for a single org (sum(weight*score)
// / sum(weight), over criteria that HAVE a score), just across every org
// this member ever scored, in one call — the calculation itself is
// untouched, per the prompt's own scope ("não mexer no cálculo em si").
// Private to the calling member, same as everything scorecard: a colleague
// at the same fund gets their own averages, never these.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ averages: {} });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ averages: {} });

  const { data: criteria } = await admin.from('investor_scorecard_criteria')
    .select('id, weight').eq('investor_member_id', member.id);
  if (!criteria || criteria.length === 0) return NextResponse.json({ averages: {} });
  const weightByCriteria = new Map(criteria.map((c) => [c.id as string, c.weight as number]));

  const { data: scores } = await admin.from('investor_scorecard_scores')
    .select('criteria_id, startup_org_id, score').in('criteria_id', criteria.map((c) => c.id));

  const acc = new Map<string, { weighted: number; weight: number }>();
  for (const s of scores ?? []) {
    const w = weightByCriteria.get(s.criteria_id as string) ?? 0;
    const cur = acc.get(s.startup_org_id as string) ?? { weighted: 0, weight: 0 };
    cur.weighted += w * (s.score as number);
    cur.weight += w;
    acc.set(s.startup_org_id as string, cur);
  }
  const averages: Record<string, number> = {};
  for (const [orgId, { weighted, weight }] of acc) {
    if (weight > 0) averages[orgId] = Math.round((weighted / weight) * 10) / 10;
  }
  return NextResponse.json({ averages });
}
