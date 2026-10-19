// Prompt 914 — the plan an org is on RIGHT NOW, in TypeScript, over an in-memory database. The cases are effective-plan-cases.json, the
// same file the SQL rehearsal reads (scripts/compose-effective-plan-rehearsal.mjs → effective_plan() on production data): "the two
// answer the same" is only a claim until both are run over the same list, and this is the TypeScript half of that list.
//
// What is pinned here that the old plan-server.ts only ever did implicitly: a 100% voucher raises the plan; a partial one does not; a
// DELETED code revokes every holder while a DEACTIVATED one does not; the plan never goes down; and the same function serves every
// limit (the bulk version agrees with the single one for every case).
import { describe, expect, it } from 'vitest';
import { fakeAdmin, fakeDb } from '@/test/fake-supabase';
import {
  bestFreeBadge, bestFreeTrial, describePlanOrigin, effectivePlanFromRows, resolveEffectivePlan,
  type TrialRedemptionRow,
} from './effective-plan';
import { effectivePlanDetailForOrg, effectivePlanForOrg, effectivePlansForOrgs } from './effective-plan-server';
import cases from './effective-plan-cases.json';

const NOW = new Date(cases.now);
const DAY = 86_400_000;
const iso = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

interface Redemption { code: string; pct: number; plans: string[]; deleted: boolean; deactivated?: boolean; endsInDays?: number | null; endsAt?: string | null }
interface Badge { badge: string; freeTier: string | null; freeUntilInDays?: number | null; freeUntil?: string | null; revoked: boolean }
interface Case { id: string; label: string; stored: string | null; redemptions: Redemption[]; badges: Badge[]; expected: string; origin: string; orgId?: string }

function tables(c: Case, orgId: string) {
  return {
    orgs: [{ id: orgId, plan: c.stored }],
    promo_redemptions: c.redemptions.map((r) => ({
      org_id: orgId,
      benefit_ends_at: r.endsAt !== undefined ? r.endsAt : r.endsInDays == null ? null : iso(r.endsInDays),
      promo_codes: { code: r.code, discount_pct: r.pct, applicable_plans: r.plans, deleted_at: r.deleted ? iso(-1) : null, active: !r.deactivated },
    })),
    platform_badges: c.badges.map((b) => ({
      org_id: orgId, badge: b.badge, free_tier: b.freeTier,
      free_until: b.freeUntil !== undefined ? b.freeUntil : b.freeUntilInDays == null ? null : iso(b.freeUntilInDays),
      revoked_at: b.revoked ? iso(-2) : null,
    })),
  };
}

const ALL: { group: string; list: Case[] }[] = [
  { group: 'zz-test fixtures (the three the prompt names)', list: cases.fixtures as Case[] },
  { group: 'matrix', list: cases.matrix as Case[] },
  { group: 'TypeScript-only (values the database cannot hold)', list: cases.typescriptOnly as Case[] },
  { group: 'real organisations (snapshot of production, 13/10/2026)', list: cases.real as Case[] },
];

describe.each(ALL)('effectivePlanDetailForOrg — $group', ({ list }) => {
  it.each(list.map((c) => [c.id, c.label, c] as const))('%s — %s', async (_id, _label, c) => {
    const admin = fakeAdmin(fakeDb(tables(c, 'org-1')));
    const eff = await effectivePlanDetailForOrg(admin, 'org-1', { now: NOW });
    expect(eff.plan).toBe(c.expected);
    expect(eff.origin.kind).toBe(c.origin);
    // the convenience the limits call answers the same
    expect(await effectivePlanForOrg(admin, 'org-1', { now: NOW })).toBe(c.expected);
  });
});

describe('the bulk version (the back-office Startups table) agrees with the single one for every case', () => {
  it('two queries for all of them, same answers', async () => {
    const every = [...cases.fixtures, ...cases.matrix, ...cases.typescriptOnly, ...cases.real] as Case[];
    const merged = { orgs: [] as unknown[], promo_redemptions: [] as unknown[], platform_badges: [] as unknown[] };
    every.forEach((c, i) => {
      const t = tables(c, `org-${i}`);
      merged.orgs.push(...t.orgs); merged.promo_redemptions.push(...t.promo_redemptions); merged.platform_badges.push(...t.platform_badges);
    });
    const db = fakeDb(merged as Record<string, Record<string, unknown>[]>);
    const bulk = await effectivePlansForOrgs(fakeAdmin(db), every.map((c, i) => ({ id: `org-${i}`, plan: c.stored })), NOW);
    every.forEach((c, i) => {
      expect(bulk.get(`org-${i}`)?.plan, c.id).toBe(c.expected);
      expect(bulk.get(`org-${i}`)?.origin.kind, c.id).toBe(c.origin);
    });
  });
});

describe('the origin says WHY (the answer to "I redeemed a code and it still says Elementary")', () => {
  it('a free trial names the code and when it ends', async () => {
    const wisify = (cases.real as Case[]).find((c) => c.id === 'r1')!;
    const eff = await effectivePlanDetailForOrg(fakeAdmin(fakeDb(tables(wisify, 'w'))), 'w', { now: NOW });
    expect(eff).toEqual({ plan: 'motherfunding', stored: 'idea', origin: { kind: 'free_trial', code: 'PIONEER_100', until: '2027-01-08T22:52:27.255+00:00' } });
    expect(describePlanOrigin(eff.origin, (d) => d.slice(0, 10))).toBe('free trial via PIONEER_100 until 2027-01-08');
  });

  it('a trial that never ends says so, a badge names the status, and nothing special says nothing', () => {
    expect(describePlanOrigin({ kind: 'free_trial', code: 'ZEROCOST', until: null }, (d) => d)).toBe('free trial via ZEROCOST (no end date)');
    expect(describePlanOrigin({ kind: 'badge', badge: 'tech_master', until: null }, (d) => d)).toBe('free through your tech master status');
    expect(describePlanOrigin({ kind: 'badge', badge: 'pioneer', until: '2026-12-01' }, (d) => d)).toBe('free through your pioneer status until 2026-12-01');
    expect(describePlanOrigin({ kind: 'stored' }, (d) => d)).toBe('');
  });

  it('the stored plan is reported next to the effective one', () => {
    expect(resolveEffectivePlan('idea', { tier: 'garage', code: 'A', until: null }, null).stored).toBe('idea');
  });
});

describe('tie-breaks only ever change the origin text, never the tier', () => {
  const redemption = (code: string, endsInDays: number | null, plans = ['motherfunding']): TrialRedemptionRow => ({
    benefit_ends_at: endsInDays == null ? null : iso(endsInDays),
    promo_codes: { code, discount_pct: 100, applicable_plans: plans, deleted_at: null },
  });

  it('two vouchers for the same tier: the one that ends later is named; one that never ends beats any date', () => {
    expect(bestFreeTrial([redemption('SOON', 5), redemption('LATER', 90)], NOW)).toMatchObject({ tier: 'motherfunding', code: 'LATER' });
    expect(bestFreeTrial([redemption('LATER', 90), redemption('SOON', 5)], NOW)).toMatchObject({ code: 'LATER' });
    expect(bestFreeTrial([redemption('DATED', 90), redemption('FOREVER', null)], NOW)).toMatchObject({ code: 'FOREVER' });
  });

  it('a higher tier wins whatever order the rows come in', () => {
    expect(bestFreeTrial([redemption('G', 30, ['garage']), redemption('M', 30, ['motherfunding'])], NOW)?.tier).toBe('motherfunding');
    expect(bestFreeTrial([redemption('M', 30, ['motherfunding']), redemption('G', 30, ['garage'])], NOW)?.tier).toBe('motherfunding');
  });

  it('two badges: the higher free tier wins', () => {
    const rows = [
      { badge: 'pioneer', free_tier: 'garage', free_until: iso(10), revoked_at: null },
      { badge: 'tech_master', free_tier: 'motherfunding', free_until: null, revoked_at: null },
    ];
    expect(bestFreeBadge(rows, NOW)).toMatchObject({ tier: 'motherfunding', badge: 'tech_master' });
  });
});

describe('degrades to the stored plan instead of throwing', () => {
  it('garbage where rows should be (a table that answers something that is not a list) is "no voucher, no badge"', () => {
    expect(effectivePlanFromRows('garage', { id: 'x' } as unknown as TrialRedemptionRow[], 'nope' as unknown as [], NOW).plan).toBe('garage');
    expect(effectivePlanFromRows('idea', null, undefined, NOW).plan).toBe('idea');
  });

  it('an org that does not exist is the free tier', async () => {
    const admin = fakeAdmin(fakeDb({ orgs: [], promo_redemptions: [], platform_badges: [] }));
    expect(await effectivePlanForOrg(admin, 'nobody', { now: NOW })).toBe('idea');
  });

  it('a caller that already has the row passes it and skips the orgs read; null means "the row has no plan"', async () => {
    const db = fakeDb({ orgs: [{ id: 'o', plan: 'motherfunding' }], promo_redemptions: [], platform_badges: [] });
    const admin = fakeAdmin(db);
    expect(await effectivePlanForOrg(admin, 'o', { storedPlan: 'garage', now: NOW })).toBe('garage');
    expect(await effectivePlanForOrg(admin, 'o', { storedPlan: null, now: NOW })).toBe('idea');
    expect(await effectivePlanForOrg(admin, 'o', { now: NOW })).toBe('motherfunding');
  });
});
