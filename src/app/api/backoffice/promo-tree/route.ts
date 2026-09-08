// Prompt 854 §D — the read-only genealogy of every org that came in
// through a promo code (campaign or referral). Platform-admin only, same
// defense-in-depth pattern as every other /api/backoffice/* route. Nothing
// here revokes, re-issues, or edits a code — that stays on Promo codes &
// offers; this route only ever reads promo_redemptions/promo_codes/orgs.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { buildPromoTree, type RedemptionRow } from '@/lib/referral';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data, error } = await admin
    .from('promo_redemptions')
    .select('org_id, redeemed_at, orgs(name), promo_codes(code, referral_of_org_id)')
    .order('redeemed_at', { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows: RedemptionRow[] = (data ?? [])
    .filter((r) => r.org_id)
    .map((r) => {
      const org = r.orgs as unknown as { name: string } | null;
      const promo = r.promo_codes as unknown as { code: string; referral_of_org_id: string | null } | null;
      return {
        orgId: r.org_id as string,
        orgName: org?.name ?? '(deleted org)',
        code: promo?.code ?? '(deleted code)',
        referralOfOrgId: promo?.referral_of_org_id ?? null,
        redeemedAt: r.redeemed_at as string,
      };
    });

  const { nodes, ignoredEdges } = buildPromoTree(rows);
  return NextResponse.json({ ok: true, nodes, ignoredEdges });
}
