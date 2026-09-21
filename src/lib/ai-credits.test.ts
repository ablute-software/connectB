import { describe, expect, it, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chargeAiAction, aiWalletStatus } from './ai-credits';

// Prompt 706 — what matters here is not the exact numbers (those are the
// RPC's job, verified separately against production via a rolled-back
// transaction — see this session's own report) but the wrapper's two
// contracts: it calls the RPC with the right args, and it FAILS CLOSED —
// unlike watson-draft-record.test.ts's recordWatsonDraft (fails OPEN,
// because that RPC runs after a draft is already generated), a
// chargeAiAction RPC failure must never let the caller's own AI call
// through unmetered, since nothing has been spent yet at that point.

function fakeSb(result: { data: unknown; error: { message: string } | null }) {
  const calls: { fn: string; args: unknown }[] = [];
  const sb = {
    rpc: (fn: string, args: unknown) => { calls.push({ fn, args }); return Promise.resolve(result); },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('chargeAiAction', () => {
  it('calls charge_ai_action with the org and action key, and passes through an ok:true row', async () => {
    const row = { ok: true, reason: null, used: 6, monthly_limit: 200, remaining: 194, reset_at: '2026-10-21T00:00:00Z' };
    const { sb, calls } = fakeSb({ data: [row], error: null });

    const result = await chargeAiAction(sb, 'org-1', 'market_research');

    expect(calls).toEqual([{ fn: 'charge_ai_action', args: { p_org_id: 'org-1', p_action_key: 'market_research' } }]);
    expect(result).toEqual({ ok: true, reason: null, used: 6, monthlyLimit: 200, remaining: 194, resetAt: '2026-10-21T00:00:00Z' });
  });

  it('passes through an ok:false row (refused) without treating it as an error', async () => {
    const row = { ok: false, reason: 'AI credits limit reached for this month — resets on 2026-10-21, or upgrade your plan.', used: 200, monthly_limit: 200, remaining: 0, reset_at: '2026-10-21T00:00:00Z' };
    const { sb } = fakeSb({ data: [row], error: null });

    const result = await chargeAiAction(sb, 'org-1', 'market_research');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('limit reached');
  });

  it('fails CLOSED on an RPC error — never returns ok:true when the charge could not be verified', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sb } = fakeSb({ data: null, error: { message: 'connection reset' } });

    const result = await chargeAiAction(sb, 'org-1', 'market_research');

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fails CLOSED when the RPC returns no row at all', async () => {
    const { sb } = fakeSb({ data: [], error: null });

    const result = await chargeAiAction(sb, 'org-1', 'market_research');

    expect(result.ok).toBe(false);
  });

  it('an RPC failure never touches used/remaining — no invented numbers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sb } = fakeSb({ data: null, error: { message: 'timeout' } });

    const result = await chargeAiAction(sb, 'org-1', 'market_research');

    expect(result.monthlyLimit).toBeNull();
    expect(result.remaining).toBeNull();
  });
});

describe('aiWalletStatus', () => {
  it('calls ai_wallet_status with the org and action key, and maps the row', async () => {
    const row = { used: 6, monthly_limit: 200, remaining: 194, reset_at: '2026-10-21T00:00:00Z', action_cost: 5, action_enabled: true, is_test: false };
    const { sb, calls } = fakeSb({ data: [row], error: null });

    const result = await aiWalletStatus(sb, 'org-1', 'market_research');

    expect(calls).toEqual([{ fn: 'ai_wallet_status', args: { p_org_id: 'org-1', p_action_key: 'market_research' } }]);
    expect(result).toEqual({
      used: 6, monthlyLimit: 200, remaining: 194, resetAt: '2026-10-21T00:00:00Z',
      actionCost: 5, actionEnabled: true, isTest: false,
    });
  });

  it('returns null on an RPC error rather than inventing a status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sb } = fakeSb({ data: null, error: { message: 'network unreachable' } });

    await expect(aiWalletStatus(sb, 'org-1', 'market_research')).resolves.toBeNull();
  });
});
