// Plans & Account batch (B) — platform admin flips an org's plan manually
// (no billing infra yet). Clears any pending plan-change request at the same
// time. Platform-admin only (requirePlatformAdmin), service-role write.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { PLAN_TIERS } from '@/lib/plans';
import type { PlanTier } from '@/lib/types';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { orgId, tier } = await req.json() as { orgId?: string; tier?: string };
  if (!orgId) return NextResponse.json({ ok: false, error: 'Missing orgId.' }, { status: 400 });
  if (!tier || !PLAN_TIERS.includes(tier as PlanTier)) {
    return NextResponse.json({ ok: false, error: 'Invalid plan tier.' }, { status: 400 });
  }

  const { error } = await admin.from('orgs')
    .update({ plan: tier, plan_change_requested: null, plan_change_requested_at: null })
    .eq('id', orgId);
  // A missing-column / enum-value error means migration 0028 hasn't landed yet.
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
