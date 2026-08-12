// Prompt 161 §D.2 — a Pioneer org's own 3 referral codes, for the "Invite
// other founders" section on Plans & billing. Founder-facing but reads
// promo_codes/promo_redemptions (platform_admin-only RLS, 0040), so this
// goes through the service role, same as every other promo route.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { pioneerBadgeAvailable } from '@/lib/pioneer-capability';

interface ReferralCode {
  code: string;
  redeemedByOrgName: string | null;
  redeemedAt: string | null;
  expired: boolean;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, codes: [] });
  if (!(await pioneerBadgeAvailable())) return NextResponse.json({ ok: true, codes: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: member } = await admin.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const { data: promos } = await admin
    .from('promo_codes')
    .select('id, code, redeemable_until, promo_redemptions(org_id, redeemed_at, orgs(name))')
    .eq('referral_of_org_id', member.org_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  const now = new Date();
  const codes: ReferralCode[] = (promos ?? []).map((p) => {
    const redemptions = (p.promo_redemptions ?? []) as unknown as { org_id: string; redeemed_at: string; orgs: { name: string } | null }[];
    const redemption = redemptions[0] ?? null;
    return {
      code: p.code as string,
      redeemedByOrgName: redemption?.orgs?.name ?? null,
      redeemedAt: redemption?.redeemed_at ?? null,
      expired: !redemption && !!p.redeemable_until && new Date(p.redeemable_until as string) < now,
    };
  });

  return NextResponse.json({ ok: true, codes });
}
