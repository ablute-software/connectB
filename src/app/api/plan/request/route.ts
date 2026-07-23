// Plans & Account batch (B) — the founder's upgrade CTA. Records a plan-change
// REQUEST on the org (no payment processing yet); a platform admin flips the
// plan for real in the back-office. Owner+admin only (same gate as org
// settings), enforced here server-side with the service role — orgs' RLS update
// policy is owner-only, and the request columns come from migration 0028.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { can, type OrgRole } from '@/lib/permissions';
import { PLAN_TIERS } from '@/lib/plans';
import type { PlanTier } from '@/lib/types';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  if (!can(member.role as OrgRole, 'manage_org_settings')) {
    return NextResponse.json({ ok: false, error: 'Só o owner ou admin pode pedir uma mudança de plano.' }, { status: 403 });
  }

  const { tier } = await req.json() as { tier?: string };
  if (!tier || !PLAN_TIERS.includes(tier as PlanTier)) {
    return NextResponse.json({ ok: false, error: 'Plano inválido.' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { error } = await admin.from('orgs')
    .update({ plan_change_requested: tier, plan_change_requested_at: new Date().toISOString() })
    .eq('id', member.org_id);
  // A missing-column error means migration 0028 hasn't been applied yet.
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
