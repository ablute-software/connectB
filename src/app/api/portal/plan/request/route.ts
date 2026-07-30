// Investor Workspace Plans & billing (Prompt 74 Bloco 2) — records a
// plan-tier-change REQUEST on the investor's own matchdeal_profiles row,
// mirroring /api/plan/request exactly (no payment processing here either;
// a platform admin applies it manually). matchdeal_profiles.plan_tier is
// the SAME mechanism MatchDeal's own swipe engine already reads
// (matchdeal_tier_limits) — this route only ever writes the *_requested
// columns (migration "investor_plan_tier_requested"), never plan_tier
// itself, so a pending request can't silently change what the investor is
// actually entitled to before anyone reviews it.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { INVESTOR_PLANS, type InvestorPlanTier } from '@/lib/plans';

const TIER_TO_MATCHDEAL: Record<InvestorPlanTier, string> = {
  boy_scout: 'tier_a', pro_spotter: 'tier_b', ace_sleuth: 'tier_c',
};

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { tier } = await req.json() as { tier?: string };
  if (!tier || !INVESTOR_PLANS.some((p) => p.tier === tier)) {
    return NextResponse.json({ ok: false, error: 'Invalid plan.' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: member } = await admin.from('matchdeal_investor_members').select('id')
    .eq('user_id', user.id).eq('status', 'active').maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor profile yet.' }, { status: 403 });

  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  const { error } = await admin.from('matchdeal_profiles')
    .update({ plan_tier_requested: TIER_TO_MATCHDEAL[tier as InvestorPlanTier], plan_tier_requested_at: new Date().toISOString() })
    .eq('membership_id', member.id).eq('kind', 'investor');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
