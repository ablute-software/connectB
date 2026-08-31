// Prompt 497 — the seat rule itself. The COUNTING half (who holds an active
// matchdeal_investor_members row) is exercised against real data by the
// migration 0285 trigger and reported in that prompt; this pins the pure
// decision, including the two cases that are easy to get backwards: a firm
// already over its limit, and the message actually naming the plan.
import { describe, it, expect } from 'vitest';
import { checkInvestorSeatLimit, investorSeatLimit, INVESTOR_PLANS } from './plans';
import { checkSeatAvailable, resolveFirmPlanTier } from './investor-seats';

// Minimal PostgREST-shaped stub: only the two tables (and the chain shape)
// investor-seats.ts actually uses. A real client would drag server-only
// deps into a unit test for no gain.
function fakeAdmin(rows: {
  members: { id: string; user_id: string; catalog_entity_id: string; status: string; created_at: string }[];
  profiles: { membership_id: string; kind: string; plan_tier: string | null }[];
}) {
  return {
    from(table: string) {
      let data: Record<string, unknown>[] = table === 'matchdeal_investor_members'
        ? rows.members as unknown as Record<string, unknown>[]
        : rows.profiles as unknown as Record<string, unknown>[];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { data = data.filter((r) => r[col] === val); return q; },
        in: (col: string, vals: unknown[]) => { data = data.filter((r) => vals.includes(r[col])); return q; },
        order: (col: string) => {
          data = [...data].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
          return q;
        },
        then: (resolve: (v: { data: Record<string, unknown>[] }) => unknown) => resolve({ data }),
      };
      return q;
    },
  } as never;
}

const M = (id: string, user: string, entity: string, created: string, status = 'active') =>
  ({ id, user_id: user, catalog_entity_id: entity, status, created_at: created });

describe('investorSeatLimit', () => {
  it('reads the seats straight off INVESTOR_PLANS — never a second copy of the numbers', () => {
    expect(investorSeatLimit('pro_scout')).toBe(1);
    expect(investorSeatLimit('ace_spotter')).toBe(2);
    expect(investorSeatLimit('legendary_sleuth')).toBe(5);
    for (const p of INVESTOR_PLANS) expect(investorSeatLimit(p.tier)).toBe(p.seats);
  });
});

describe('checkInvestorSeatLimit', () => {
  it('allows a seat while the firm is below its limit', () => {
    expect(checkInvestorSeatLimit({ tier: 'ace_spotter', used: 0 }).allowed).toBe(true);
    expect(checkInvestorSeatLimit({ tier: 'ace_spotter', used: 1 }).allowed).toBe(true);
    expect(checkInvestorSeatLimit({ tier: 'legendary_sleuth', used: 4 }).allowed).toBe(true);
  });

  it('blocks the seat that would exceed the limit, not the one that reaches it', () => {
    expect(checkInvestorSeatLimit({ tier: 'pro_scout', used: 0 }).allowed).toBe(true);
    expect(checkInvestorSeatLimit({ tier: 'pro_scout', used: 1 }).allowed).toBe(false);
    expect(checkInvestorSeatLimit({ tier: 'ace_spotter', used: 2 }).allowed).toBe(false);
    expect(checkInvestorSeatLimit({ tier: 'legendary_sleuth', used: 5 }).allowed).toBe(false);
  });

  it('still blocks a firm that is ALREADY over its limit, without claiming anything about its existing seats', () => {
    // The `ablute_ — Internal QA` shape measured in production: 2 seats on a
    // 1-seat tier. Adding a third is refused; the verdict says nothing about
    // removing the two it has (that is Nuno's call, never the code's).
    const v = checkInvestorSeatLimit({ tier: 'pro_scout', used: 2 });
    expect(v.allowed).toBe(false);
    expect(v.used).toBe(2);
    expect(v.limit).toBe(1);
  });

  it('says WHICH plan and WHAT limit — the message is the requirement, not a generic refusal', () => {
    const v = checkInvestorSeatLimit({ tier: 'pro_scout', used: 1 });
    expect(v.planName).toBe('Pro Scout');
    expect(v.reason).toContain('Pro Scout');
    expect(v.reason).toContain('1 seat');
    // and points at the way out
    expect(v.reason).toContain('Ace Spotter');
  });

  it('offers no upgrade on the top tier, rather than naming a plan that does not exist', () => {
    const v = checkInvestorSeatLimit({ tier: 'legendary_sleuth', used: 5 });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('The Legendary Sleuth');
    expect(v.reason).not.toContain('upgrade to');
  });

  it('pluralises the seat count from the tier, not from a hard-coded string', () => {
    expect(checkInvestorSeatLimit({ tier: 'pro_scout', used: 1 }).reason).toContain('includes 1 seat,');
    expect(checkInvestorSeatLimit({ tier: 'ace_spotter', used: 2 }).reason).toContain('includes 2 seats,');
  });

  it('never reports a negative used count', () => {
    expect(checkInvestorSeatLimit({ tier: 'pro_scout', used: -3 }).used).toBe(0);
  });
});


describe('resolveFirmPlanTier', () => {
  it('falls back to the entry plan when the firm has no seat carrying a tier', async () => {
    const admin = fakeAdmin({ members: [M('m1', 'u1', 'f1', '2026-01-01')], profiles: [] });
    expect(await resolveFirmPlanTier(admin, 'f1')).toBe('pro_scout');
  });

  it('falls back to the entry plan for a firm with no seats at all', async () => {
    expect(await resolveFirmPlanTier(fakeAdmin({ members: [], profiles: [] }), 'f1')).toBe('pro_scout');
  });

  it('takes the tier of the OLDEST seat that carries one — the same seat migration 0285 picks', async () => {
    const admin = fakeAdmin({
      members: [M('m2', 'u2', 'f1', '2026-02-01'), M('m1', 'u1', 'f1', '2026-01-01')],
      profiles: [
        { membership_id: 'm2', kind: 'investor', plan_tier: 'tier_c' },
        { membership_id: 'm1', kind: 'investor', plan_tier: 'tier_b' },
      ],
    });
    expect(await resolveFirmPlanTier(admin, 'f1')).toBe('ace_spotter');
  });

  it('skips a seat with no tier rather than reading it as the entry plan', async () => {
    const admin = fakeAdmin({
      members: [M('m1', 'u1', 'f1', '2026-01-01'), M('m2', 'u2', 'f1', '2026-02-01')],
      profiles: [
        { membership_id: 'm1', kind: 'investor', plan_tier: null },
        { membership_id: 'm2', kind: 'investor', plan_tier: 'tier_c' },
      ],
    });
    expect(await resolveFirmPlanTier(admin, 'f1')).toBe('legendary_sleuth');
  });
});

describe('checkSeatAvailable', () => {
  const tierA = [{ membership_id: 'm1', kind: 'investor', plan_tier: 'tier_a' }];

  it('blocks a newcomer when the firm is at its limit', async () => {
    const admin = fakeAdmin({ members: [M('m1', 'u1', 'f1', '2026-01-01')], profiles: tierA });
    const v = await checkSeatAvailable(admin, 'f1', 'u-new');
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('Pro Scout');
  });

  it('allows the first seat on an empty firm', async () => {
    const admin = fakeAdmin({ members: [], profiles: [] });
    expect((await checkSeatAvailable(admin, 'f1', 'u-new')).allowed).toBe(true);
  });

  it('never blocks someone who ALREADY holds a seat here, even on an over-limit firm', async () => {
    // The production shape that broke the first version of this rule:
    // excluding only the caller's own row still left the OTHER seat at the
    // 1-seat limit, so the firm's own owner was refused their own re-link.
    const admin = fakeAdmin({
      members: [M('m1', 'u1', 'f1', '2026-01-01'), M('m2', 'u2', 'f1', '2026-01-02')],
      profiles: tierA,
    });
    const v = await checkSeatAvailable(admin, 'f1', 'u1');
    expect(v.allowed).toBe(true);
    expect(v.reason).toBeNull();
    // ...and still reports the firm's real seat count, not a flattered one.
    expect(v.used).toBe(1);
    expect(v.limit).toBe(1);
  });

  it('ignores revoked seats — they are not billed and must not block a newcomer', async () => {
    const admin = fakeAdmin({
      members: [M('m1', 'u1', 'f1', '2026-01-01', 'revoked')],
      profiles: tierA,
    });
    expect((await checkSeatAvailable(admin, 'f1', 'u-new')).allowed).toBe(true);
  });

  it('counts seats per FIRM, not per platform — another firm\'s seats are irrelevant', async () => {
    const admin = fakeAdmin({
      members: [M('m1', 'u1', 'f-other', '2026-01-01'), M('m2', 'u2', 'f-other', '2026-01-02')],
      profiles: tierA,
    });
    expect((await checkSeatAvailable(admin, 'f1', 'u-new')).allowed).toBe(true);
  });

  it('lets a 2-seat tier take its second seat and refuses the third', async () => {
    const profiles = [{ membership_id: 'm1', kind: 'investor', plan_tier: 'tier_b' }];
    const one = fakeAdmin({ members: [M('m1', 'u1', 'f1', '2026-01-01')], profiles });
    expect((await checkSeatAvailable(one, 'f1', 'u-new')).allowed).toBe(true);
    const two = fakeAdmin({
      members: [M('m1', 'u1', 'f1', '2026-01-01'), M('m2', 'u2', 'f1', '2026-01-02')], profiles,
    });
    expect((await checkSeatAvailable(two, 'f1', 'u-new')).allowed).toBe(false);
  });
});
