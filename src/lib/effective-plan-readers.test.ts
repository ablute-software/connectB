// Prompt 914 — the plan-dependent limits that used to read orgs.plan directly, each over an in-memory database, each asked the same
// question: "this org is stored on Elementary but is on a running 100%-off trial of the top plan — which number do you give?".
// effective-plan.test.ts pins the RULE (and its SQL twin); this pins that every READER goes through it:
//   · the pipeline size / quota target (pipeline-unlock-server.ts)  · the MatchDeal deck size (matchdeal-pairing.ts)
//   · the AI-credit wallet's read-only mirror for a Developer Viewer (ai-credits.ts)
// The monthly delivery has its own file (catalog-monthly-delivery-server.test.ts); the SQL wallet is proved by the rehearsal.
import { describe, expect, it } from 'vitest';
import { fakeAdmin, fakeDb } from '@/test/fake-supabase';
import { computeVisiblePipelineSize } from './pipeline-unlock-server';
import { PLAN_PIPELINE_BASE } from './pipeline-unlock';
import { startupDeckLimit } from './matchdeal-pairing';
import { aiWalletStatusForViewer } from './ai-credits';
import { MATCHDEAL_WEEKLY } from './plans';

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

const trial = (over: { pct?: number; plans?: string[]; endsInDays?: number | null; deleted?: boolean } = {}) => ({
  org_id: 'org-1',
  benefit_ends_at: over.endsInDays === null ? null : inDays(over.endsInDays ?? 30),
  promo_codes: { code: 'PIONEER_100', discount_pct: over.pct ?? 100, applicable_plans: over.plans ?? ['motherfunding'], deleted_at: over.deleted ? inDays(-1) : null },
});

describe('pipeline size and quota target run on the plan the org is on today', () => {
  // The nine gate fields, so the pipeline is unlocked and the answer is the plan's own base (no bonuses, month 0).
  const gateOrg = {
    id: 'org-1', plan: 'idea', website: 'https://x.example', sectors: ['healthtech'], stage: 'seed', country: 'PT', round_target_eur: 1_300_000,
    current_phase: 'launched', founded_year: 2023, revenue_eur: 1000, primary_contact_person_id: 'p1', profile_completed_at: null,
  };
  const pool = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, org_id: 'org-1', source: 'catalog' }));
  const dbWith = (over: Record<string, unknown[]> = {}) => fakeAdmin(fakeDb({
    orgs: [gateOrg], folders: [], documents: [], entities: pool, interactions: [], promo_redemptions: [], platform_badges: [], ...over,
  } as Record<string, Record<string, unknown>[]>));

  it('control: stored idea, nothing else → the Elementary base', async () => {
    const r = await computeVisiblePipelineSize(dbWith(), 'org-1');
    expect(r).toMatchObject({ gateComplete: true, visible: PLAN_PIPELINE_BASE.idea, catalogQuotaTarget: PLAN_PIPELINE_BASE.idea });
  });

  it('stored idea + a 100% trial of the top plan, still running → the top plan\'s base (what the founder was promised)', async () => {
    const r = await computeVisiblePipelineSize(dbWith({ promo_redemptions: [trial()] }), 'org-1');
    expect(r.visible).toBe(PLAN_PIPELINE_BASE.motherfunding);
    expect(r.catalogQuotaTarget).toBe(PLAN_PIPELINE_BASE.motherfunding);
    expect(PLAN_PIPELINE_BASE.motherfunding).toBeGreaterThan(PLAN_PIPELINE_BASE.idea); // the two answers really differ
  });

  it.each([
    ['ended yesterday', { redemptions: [trial({ endsInDays: -1 })] }],
    ['only a 99% discount', { redemptions: [trial({ pct: 99 })] }],
    ['the code was deleted', { redemptions: [trial({ deleted: true })] }],
  ])('a trial that is not granting anything (%s) changes nothing', async (_label, o) => {
    const r = await computeVisiblePipelineSize(dbWith({ promo_redemptions: o.redemptions }), 'org-1');
    expect(r.visible).toBe(PLAN_PIPELINE_BASE.idea);
  });

  it('a badge\'s free tier counts too', async () => {
    const badges = [{ org_id: 'org-1', badge: 'tech_master', free_tier: 'garage', free_until: null, revoked_at: null }];
    expect((await computeVisiblePipelineSize(dbWith({ platform_badges: badges }), 'org-1')).visible).toBe(PLAN_PIPELINE_BASE.garage);
  });

  it('a caller that already resolved the tier (the back-office table, one query for all orgs) passes it and the voucher is not asked again', async () => {
    const r = await computeVisiblePipelineSize(dbWith({ promo_redemptions: [trial()] }), 'org-1', { planTier: 'garage' });
    expect(r.visible).toBe(PLAN_PIPELINE_BASE.garage);
  });

  it('an org that does not exist is 0 (unchanged)', async () => {
    expect(await computeVisiblePipelineSize(dbWith(), 'nobody')).toEqual({ visible: 0, gateComplete: false, eligiblePoolSize: 0, catalogQuotaTarget: 0 });
  });
});

describe('the MatchDeal deck asks for the size of the plan the org is on today', () => {
  const dbWith = (over: Record<string, unknown[]> = {}) => fakeAdmin(fakeDb({
    matchdeal_profiles: [{ id: 'prof-1', membership_id: 'org-1' }], orgs: [{ id: 'org-1', plan: 'idea' }], promo_redemptions: [], platform_badges: [], ...over,
  } as Record<string, Record<string, unknown>[]>));

  it('control: stored idea → the Elementary deck', async () => {
    expect(await startupDeckLimit(dbWith(), 'prof-1')).toBe(MATCHDEAL_WEEKLY.idea.deck);
  });

  it('stored idea + a running 100% trial of the top plan → the top plan\'s deck', async () => {
    expect(await startupDeckLimit(dbWith({ promo_redemptions: [trial()] }), 'prof-1')).toBe(MATCHDEAL_WEEKLY.motherfunding.deck);
    expect(MATCHDEAL_WEEKLY.motherfunding.deck).not.toBe(MATCHDEAL_WEEKLY.idea.deck);
  });

  it('the fallbacks are unchanged: no profile, or a profile whose org is gone, is the old default of 10', async () => {
    expect(await startupDeckLimit(dbWith(), 'no-such-profile')).toBe(10);
    expect(await startupDeckLimit(dbWith({ orgs: [] }), 'prof-1')).toBe(10);
  });
});

describe('the Developer Viewer\'s wallet shows the limit the founder gets', () => {
  const org = (over: Record<string, unknown> = {}) => ({
    id: 'org-1', plan: 'idea', ai_credits_used_this_period: 7, ai_credits_reset_at: inDays(10), is_test: false, is_internal: false, ...over,
  });
  const dbWith = (over: Record<string, unknown[]> = {}) => fakeAdmin(fakeDb({
    orgs: [org()],
    plans: [{ key: 'idea', monthly_ai_credits: 80 }, { key: 'garage', monthly_ai_credits: 200 }, { key: 'motherfunding', monthly_ai_credits: 500 }],
    plan_overrides: [], ai_actions: [{ key: 'compose_outreach', credit_cost: 1, enabled: true }],
    promo_redemptions: [], platform_badges: [], ...over,
  } as Record<string, Record<string, unknown>[]>));

  it('control: stored idea → 80, with what is left of it', async () => {
    expect(await aiWalletStatusForViewer(dbWith(), 'org-1', 'compose_outreach')).toMatchObject({ used: 7, monthlyLimit: 80, remaining: 73, actionCost: 1, actionEnabled: true, isTest: false });
  });

  it('stored idea + a running 100% trial of the top plan → 500 (Wisify and Insignals today)', async () => {
    expect(await aiWalletStatusForViewer(dbWith({ promo_redemptions: [trial()] }), 'org-1', 'compose_outreach'))
      .toMatchObject({ used: 7, monthlyLimit: 500, remaining: 493 });
  });

  it('the trial that ended reverts by itself, a per-org override still wins over every plan', async () => {
    expect((await aiWalletStatusForViewer(dbWith({ promo_redemptions: [trial({ endsInDays: -1 })] }), 'org-1', 'compose_outreach'))?.monthlyLimit).toBe(80);
    const withOverride = dbWith({ promo_redemptions: [trial()], plan_overrides: [{ org_id: 'org-1', action_key: null, monthly_credits_override: 1234 }] });
    expect((await aiWalletStatusForViewer(withOverride, 'org-1', 'compose_outreach'))?.monthlyLimit).toBe(1234);
  });

  it('an exempt org (is_test or is_internal) is still reported as exempt, whatever its plan', async () => {
    expect((await aiWalletStatusForViewer(dbWith({ orgs: [org({ is_internal: true })] }), 'org-1', 'compose_outreach'))?.isTest).toBe(true);
  });
});
