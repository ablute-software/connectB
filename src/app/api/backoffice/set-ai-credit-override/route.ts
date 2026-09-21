// Prompt 706 Bloco C.2 — assign (or clear) a custom monthly-credit override
// for one org, without touching orgs.plan itself. orgs.plan stays whatever
// real entitlement tier (idea/garage/motherfunding) the org is actually
// on — this override affects ONLY the AI-credits wallet's monthly limit
// (plan_overrides, action_key null), the same "whole-org override" row
// ai_wallet_status()/charge_ai_action() already resolve. Keeping the two
// separate avoids a custom AI-credit plan needing to also make sense to
// every OTHER thing orgs.plan already gates (Watson quota, MatchDeal tier,
// catalog quota) — those are untouched, per this prompt's own guard.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  // planKey: a custom plans.key to borrow its monthly_ai_credits from, or
  // null to clear the override (falls back to the org's real plan).
  const { orgId, planKey } = await req.json().catch(() => ({})) as { orgId?: string; planKey?: string | null };
  if (!orgId) return NextResponse.json({ ok: false, error: 'Missing orgId.' }, { status: 400 });

  if (!planKey) {
    const { error } = await admin.from('plan_overrides').delete().eq('org_id', orgId).is('action_key', null);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    await logAdminAction(admin, { adminUserId: userId, action: 'ai_credit_override_clear', subjectType: 'orgs', subjectId: orgId });
    return NextResponse.json({ ok: true });
  }

  const { data: plan } = await admin.from('plans').select('monthly_ai_credits, is_custom').eq('key', planKey).maybeSingle();
  if (!plan) return NextResponse.json({ ok: false, error: 'Plan not found.' }, { status: 404 });

  // Prompt 706 — no plain upsert here: the whole-org override's uniqueness
  // is enforced by an EXPRESSION index (org_id, coalesce(action_key, ''))
  // so a NULL action_key still collides with itself — Supabase's upsert
  // onConflict can only target a literal column list, not that expression,
  // so this does the check-then-write by hand instead.
  const { data: existing } = await admin.from('plan_overrides').select('id').eq('org_id', orgId).is('action_key', null).maybeSingle();
  const { error } = existing
    ? await admin.from('plan_overrides').update({ monthly_credits_override: plan.monthly_ai_credits, updated_at: new Date().toISOString() }).eq('id', existing.id)
    : await admin.from('plan_overrides').insert({ org_id: orgId, action_key: null, monthly_credits_override: plan.monthly_ai_credits });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await logAdminAction(admin, { adminUserId: userId, action: 'ai_credit_override_set', subjectType: 'orgs', subjectId: orgId, detail: { planKey, monthlyAiCredits: plan.monthly_ai_credits } });
  return NextResponse.json({ ok: true });
}
