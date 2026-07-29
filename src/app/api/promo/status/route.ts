// Founder-facing: does my org have an active promo redemption right now?
// Called on Plans & billing page load, so a returning founder sees their
// discount without having to re-type the code.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { isRedemptionCurrentlyActive } from '@/lib/promo';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, active: null });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: true, active: null });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: member } = await admin.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: true, active: null });

  const { data: redemptions } = await admin
    .from('promo_redemptions')
    .select('benefit_ends_at, promo_codes(code, kind, discount_pct, applicable_plans, active, deleted_at)')
    .eq('org_id', member.org_id);

  const now = new Date();
  const active = (redemptions ?? [])
    .filter((r) => isRedemptionCurrentlyActive(
      r.promo_codes as unknown as { active: boolean; deleted_at: string | null } | null, r.benefit_ends_at, now,
    ))
    .map((r) => {
      const promo = r.promo_codes as unknown as { code: string; kind: string; discount_pct: number; applicable_plans: string[] } | null;
      return promo && {
        code: promo.code, kind: promo.kind, discount_pct: promo.discount_pct,
        applicable_plans: promo.applicable_plans, benefit_ends_at: r.benefit_ends_at,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, active });
}
