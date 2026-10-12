import 'server-only';
// Prompt 706 — the one function every AI-metered route calls, at the START,
// before any expensive model call. Thin wrapper around the charge_ai_action
// Postgres RPC (migration 20260921090000_ai_credits_wallet.sql) — the
// actual decision (is_test bypass, disabled-action lockout, plan/override
// resolution, the atomic check-and-increment) lives there, in a
// SECURITY DEFINER function with a `for update` row lock, for the same
// reason ai_drafts_used_this_month/ai_drafts_reset_at (0102_watson_draft_credits.sql)
// already does it that way: a plain read-then-write in application code
// can't be made race-safe across concurrent requests, and the RPC's own
// resolution of plan + ai_actions + plan_overrides means a plan change or a
// backoffice cost edit takes effect on the very next call with no app
// redeploy.
//
// Call this with the SAME request-scoped client every other RPC in this
// codebase uses for an org-scoped call (watson_drafts_status,
// watson_record_draft) — never a service-role admin client. The RPC's own
// is_org_member(p_org_id) check needs a real auth.uid() session to mean
// anything; a service-role call has none and would always be refused.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChargeResult {
  ok: boolean;
  /** Present only when ok is false — always plain-language, safe to show as-is. */
  reason: string | null;
  used: number;
  /** null when the org is_test (unlimited — there is no meaningful limit to report). */
  monthlyLimit: number | null;
  remaining: number | null;
  resetAt: string | null;
}

const RPC_FAILURE: ChargeResult = {
  ok: false,
  reason: "Couldn't verify your AI credit balance — please try again in a moment.",
  used: 0, monthlyLimit: null, remaining: null, resetAt: null,
};

/**
 * Charges one use of `actionKey` against `orgId`'s wallet. Fails CLOSED: if
 * the RPC itself errors (network, a bug, Postgres down), this returns
 * ok:false rather than letting the caller's AI call through unmetered — the
 * opposite of watson_record_draft's own fail-OPEN choice, and deliberately
 * so: that function runs AFTER a draft was already generated (failing open
 * there avoids throwing away paid-for tokens), while this runs BEFORE any
 * model call — nothing is lost by refusing, and letting an unverifiable
 * charge through would be exactly the "designed but never actually
 * enforced" gap this whole feature exists to close (blueprint_analyses.
 * consumed_kind, confirmed dead — see this migration's own report).
 */
export async function chargeAiAction(sb: SupabaseClient, orgId: string, actionKey: string): Promise<ChargeResult> {
  const { data, error } = await sb.rpc('charge_ai_action', { p_org_id: orgId, p_action_key: actionKey });
  if (error) {
    console.error('[chargeAiAction] RPC failed — refusing rather than calling the model unmetered', { orgId, actionKey, error: error.message });
    return RPC_FAILURE;
  }
  const row = (data as {
    ok: boolean; reason: string | null; used: number;
    monthly_limit: number | null; remaining: number | null; reset_at: string | null;
  }[] | null)?.[0];
  if (!row) {
    console.error('[chargeAiAction] RPC returned no row', { orgId, actionKey });
    return RPC_FAILURE;
  }
  return {
    ok: row.ok, reason: row.reason, used: row.used,
    monthlyLimit: row.monthly_limit, remaining: row.remaining, resetAt: row.reset_at,
  };
}

export interface WalletStatus {
  used: number;
  monthlyLimit: number;
  remaining: number;
  resetAt: string;
  actionCost: number;
  actionEnabled: boolean;
  /** Despite the name, this is really "exempt from the wallet" — is_test OR
   * is_internal on the org (see the migration's own note on why is_test
   * alone would have missed ablute_'s real org). Kept as `isTest` to match
   * the RPC's own field name. */
  isTest: boolean;
}

/**
 * Prompt 904 — the wallet a Developer Viewer session shows: the VIEWED org's numbers, computed from the
 * tables with the service role, and WITHOUT the write ai_wallet_status() does as a side effect.
 *
 * The RPC is not a pure read: it raises for a non-member (so it cannot be asked about an org the caller is
 * only looking at) and, when the period has lapsed, it UPDATES orgs.ai_credits_used_this_period /
 * ai_credits_reset_at before answering. A developer looking at a customer's workspace must not roll that
 * customer's billing period over, so this mirrors the arithmetic and, when the period has lapsed, reports
 * what the roll-over WOULD produce (used 0, reset one month ahead) without storing it. Never charges.
 */
export async function aiWalletStatusForViewer(admin: SupabaseClient, orgId: string, actionKey: string): Promise<WalletStatus | null> {
  const { data: org } = await admin.from('orgs')
    .select('ai_credits_used_this_period, ai_credits_reset_at, is_test, is_internal, plan').eq('id', orgId).maybeSingle();
  if (!org) return null;
  const now = new Date();
  const storedReset = org.ai_credits_reset_at ? new Date(org.ai_credits_reset_at as string) : null;
  const lapsed = !storedReset || now >= storedReset;
  const used = lapsed ? 0 : ((org.ai_credits_used_this_period as number | null) ?? 0);
  const resetAt = lapsed ? new Date(new Date(now).setMonth(now.getMonth() + 1)) : storedReset;

  const [{ data: plan }, { data: limitOverride }, { data: action }, { data: costOverride }] = await Promise.all([
    admin.from('plans').select('monthly_ai_credits').eq('key', org.plan as string).maybeSingle(),
    admin.from('plan_overrides').select('monthly_credits_override').eq('org_id', orgId).is('action_key', null).maybeSingle(),
    admin.from('ai_actions').select('credit_cost, enabled').eq('key', actionKey).maybeSingle(),
    admin.from('plan_overrides').select('credit_cost_override').eq('org_id', orgId).eq('action_key', actionKey).maybeSingle(),
  ]);
  const monthlyLimit = (limitOverride?.monthly_credits_override as number | null | undefined)
    ?? (plan?.monthly_ai_credits as number | null | undefined) ?? 0;
  return {
    used,
    monthlyLimit,
    remaining: Math.max(monthlyLimit - used, 0),
    resetAt: (resetAt as Date).toISOString(),
    actionCost: (costOverride?.credit_cost_override as number | null | undefined) ?? (action?.credit_cost as number | null | undefined) ?? 0,
    actionEnabled: (action?.enabled as boolean | null | undefined) ?? false,
    isTest: !!(org.is_test || org.is_internal),
  };
}

/** Read-only: for the Bloco D pre-spend popup ("you've used Y of Z this month") and the /api/me wallet card. Never charges. */
export async function aiWalletStatus(sb: SupabaseClient, orgId: string, actionKey: string): Promise<WalletStatus | null> {
  const { data, error } = await sb.rpc('ai_wallet_status', { p_org_id: orgId, p_action_key: actionKey });
  if (error) {
    console.error('[aiWalletStatus] RPC failed', { orgId, actionKey, error: error.message });
    return null;
  }
  const row = (data as {
    used: number; monthly_limit: number; remaining: number; reset_at: string;
    action_cost: number; action_enabled: boolean; is_test: boolean;
  }[] | null)?.[0];
  if (!row) return null;
  return {
    used: row.used, monthlyLimit: row.monthly_limit, remaining: row.remaining, resetAt: row.reset_at,
    actionCost: row.action_cost, actionEnabled: row.action_enabled, isTest: row.is_test,
  };
}
