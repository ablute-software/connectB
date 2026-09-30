// Prompt I-01 §C.2 — public preview of a startup invite: the incubator
// (name, logo, kind), the cohort, the voucher if any (plan + duration), the
// stub fields that prefill signup, and whether the house also invests (D3).
// Token-authorised like /api/guest/[token]: looked up by its sha256 with the
// service role, rate-limited per IP, and never echoed back.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashToken } from '@/lib/matchdeal-pairing';
import { clientIp, guestLinkRateLimited } from '@/lib/guest-link-security';

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, demo: true, error: 'not configured' });
  const admin = createClient(url, service, { auth: { persistSession: false } });
  if (await guestLinkRateLimited(admin, clientIp(req))) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const { data: inv } = await admin.from('incubator_invites')
    .select('id, incubator_id, cohort_id, email, startup_name, sector, website, promo_code_id, status, token_expires_at')
    .eq('token_hash', hashToken(params.token)).maybeSingle();
  if (!inv) return NextResponse.json({ ok: false, error: 'invite_not_found' }, { status: 404 });

  const [{ data: inc }, { data: cohort }, { data: promo }] = await Promise.all([
    admin.from('incubators').select('name, logo_url, kind, related_catalog_entity_id, closed_at').eq('id', inv.incubator_id).maybeSingle(),
    inv.cohort_id ? admin.from('incubator_cohorts').select('name').eq('id', inv.cohort_id).maybeSingle() : Promise.resolve({ data: null }),
    inv.promo_code_id ? admin.from('promo_codes').select('applicable_plans, benefit_duration_months, kind, discount_pct').eq('id', inv.promo_code_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!inc) return NextResponse.json({ ok: false, error: 'invite_not_found' }, { status: 404 });

  const expired = inv.status === 'invited' && new Date(inv.token_expires_at).getTime() < Date.now();
  return NextResponse.json({
    ok: true,
    status: inc.closed_at ? 'closed' : expired ? 'expired' : inv.status,
    invitedEmail: inv.email,
    incubator: { name: inc.name, logoUrl: inc.logo_url, kind: inc.kind, alsoInvests: !!inc.related_catalog_entity_id },
    cohortName: cohort?.name ?? null,
    voucher: promo ? {
      plans: promo.applicable_plans as string[], months: promo.benefit_duration_months as number | null,
      kind: promo.kind as string, discountPct: promo.discount_pct as number,
    } : null,
    stub: { startupName: inv.startup_name, sector: inv.sector, website: inv.website },
  });
}
