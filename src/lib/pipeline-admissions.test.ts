import { describe, expect, it } from 'vitest';
import { calendarMonthStartIso, computeAdmissions } from './pipeline-admissions';
import { firstOfNextMonth, pipelineQuotaLine } from './pipeline-quota-line';

type Card = { orgId: string };
const candidates = (n: number, prefix = 'c'): Card[] => Array.from({ length: n }, (_, i) => ({ orgId: `${prefix}${i + 1}` }));
const allEligible = (cards: Card[]) => new Set(cards.map((c) => c.orgId));

const MONTH_1 = '2026-09-04T12:00:00Z';
const MONTH_2 = '2026-10-04T12:00:00Z';
const MONTH_3 = '2026-11-04T12:00:00Z';

describe('computeAdmissions — the cumulative monthly cap', () => {
  // Nuno's general case, 04/09: 30 startup accounts, Pro Scout (10/month).
  // Month one admits the 10 best-matching, month two admits 10 more and the
  // pipeline holds 20, month three 30. Cumulative, never re-shuffled.
  it('accumulates 10 → 20 → 30 across three months against 30 candidates', () => {
    const cards = candidates(30);
    const eligible = allEligible(cards);
    const admittedAtByOrg = new Map<string, string>();

    const m1 = computeAdmissions({ discoveryCards: cards, admittedAtByOrg, eligibleNowOrgIds: eligible, monthlyCap: 10, nowIso: MONTH_1 });
    expect(m1.admitted).toHaveLength(10);
    expect(m1.newlyAdmittedOrgIds).toHaveLength(10);
    expect(m1.quota).toEqual({ monthlyCap: 10, admittedThisMonth: 10, hasUnadmittedCandidates: true });
    // Best-matching first: discoveryCards arrives already sorted by score.
    expect(m1.admitted.map((c) => c.orgId)).toEqual(candidates(10).map((c) => c.orgId));
    for (const id of m1.newlyAdmittedOrgIds) admittedAtByOrg.set(id, MONTH_1);

    const m2 = computeAdmissions({ discoveryCards: cards, admittedAtByOrg, eligibleNowOrgIds: eligible, monthlyCap: 10, nowIso: MONTH_2 });
    expect(m2.admitted).toHaveLength(20);
    expect(m2.newlyAdmittedOrgIds).toHaveLength(10);
    // The first 10 are still there, in the same order — never re-shuffled.
    expect(m2.admitted.slice(0, 10).map((c) => c.orgId)).toEqual(m1.admitted.map((c) => c.orgId));
    expect(m2.quota.admittedThisMonth).toBe(10);
    for (const id of m2.newlyAdmittedOrgIds) admittedAtByOrg.set(id, MONTH_2);

    const m3 = computeAdmissions({ discoveryCards: cards, admittedAtByOrg, eligibleNowOrgIds: eligible, monthlyCap: 10, nowIso: MONTH_3 });
    expect(m3.admitted).toHaveLength(30);
    expect(m3.quota.hasUnadmittedCandidates).toBe(false);
  });

  // Nuno's specific case: "Se a pipeline pode ter até 10, as 5 que existem
  // têm obrigatoriamente que estar presentes."
  it('admits every candidate when there are fewer of them than the cap', () => {
    const cards = candidates(5);
    const result = computeAdmissions({
      discoveryCards: cards, admittedAtByOrg: new Map(), eligibleNowOrgIds: allEligible(cards), monthlyCap: 10, nowIso: MONTH_1,
    });
    expect(result.admitted).toHaveLength(5);
    expect(result.quota).toEqual({ monthlyCap: 10, admittedThisMonth: 5, hasUnadmittedCandidates: false });
  });

  it('never re-spends budget on an org admitted in an earlier month', () => {
    const cards = candidates(3);
    const admittedAtByOrg = new Map([['c1', MONTH_1], ['c2', MONTH_1], ['c3', MONTH_1]]);
    const result = computeAdmissions({
      discoveryCards: cards, admittedAtByOrg, eligibleNowOrgIds: allEligible(cards), monthlyCap: 10, nowIso: MONTH_2,
    });
    expect(result.newlyAdmittedOrgIds).toEqual([]);
    expect(result.quota.admittedThisMonth).toBe(0);
    expect(result.admitted).toHaveLength(3);
  });

  // Prompt 850 §D's one correction. Live case: the "Test investor" firm
  // spent 3 of 10 at 09:03 on 04/09 and one of those (Estojo) is
  // back-office suspended — it stops consuming the budget.
  it('refunds an admission whose org is no longer eligible', () => {
    const cards = candidates(3);
    const admittedAtByOrg = new Map([['ablute', MONTH_1], ['sherlock', MONTH_1], ['estojo', MONTH_1]]);
    const stillEligible = new Set(['ablute', 'sherlock', ...cards.map((c) => c.orgId)]);
    const result = computeAdmissions({
      discoveryCards: cards, admittedAtByOrg, eligibleNowOrgIds: stillEligible, monthlyCap: 10, nowIso: MONTH_1,
    });
    // 2 of the 3 old admissions still count, + the 3 new ones = 5, not 6.
    expect(result.quota.admittedThisMonth).toBe(5);
  });

  it('closing an org after admission frees its slot for a new candidate', () => {
    const cards = candidates(2, 'new');
    const admittedAtByOrg = new Map([['closed-org', MONTH_1]]);
    const spent = computeAdmissions({
      discoveryCards: cards, admittedAtByOrg, eligibleNowOrgIds: new Set(['closed-org', ...allEligible(cards)]), monthlyCap: 1, nowIso: MONTH_1,
    });
    expect(spent.admitted).toHaveLength(0);
    expect(spent.quota.hasUnadmittedCandidates).toBe(true);

    const refunded = computeAdmissions({
      discoveryCards: cards, admittedAtByOrg, eligibleNowOrgIds: allEligible(cards), monthlyCap: 1, nowIso: MONTH_1,
    });
    expect(refunded.admitted.map((c) => c.orgId)).toEqual(['new1']);
  });

  it('stops at the cap and reports that something is behind it', () => {
    const cards = candidates(12);
    const result = computeAdmissions({
      discoveryCards: cards, admittedAtByOrg: new Map(), eligibleNowOrgIds: allEligible(cards), monthlyCap: 10, nowIso: MONTH_1,
    });
    expect(result.admitted).toHaveLength(10);
    expect(result.quota.hasUnadmittedCandidates).toBe(true);
  });

  it('computes the calendar month boundary in UTC', () => {
    expect(calendarMonthStartIso('2026-09-04T12:00:00Z')).toBe('2026-09-01T00:00:00.000Z');
    expect(calendarMonthStartIso('2026-01-31T23:59:59Z')).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('pipelineQuotaLine — three states, no invented numbers', () => {
  it('says how much of this month has been used while there is still room', () => {
    expect(pipelineQuotaLine({ monthlyCap: 10, admittedThisMonth: 3, hasUnadmittedCandidates: true }, MONTH_1))
      .toBe('3 of 10 new startups this month');
  });

  it('names the reset date once the budget is spent and more are waiting', () => {
    expect(pipelineQuotaLine({ monthlyCap: 10, admittedThisMonth: 10, hasUnadmittedCandidates: true }, MONTH_1))
      .toBe('10 of 10 new startups this month · the next 10 unlock on 1 October');
  });

  it('says the list is complete when nothing is being withheld', () => {
    expect(pipelineQuotaLine({ monthlyCap: 10, admittedThisMonth: 5, hasUnadmittedCandidates: false }, MONTH_1))
      .toBe("You're seeing every startup that matches today. Your plan allows 10 new ones a month.");
    // Even with the budget spent: nothing is waiting for the reset, so the
    // reset is not the honest thing to say.
    expect(pipelineQuotaLine({ monthlyCap: 10, admittedThisMonth: 10, hasUnadmittedCandidates: false }, MONTH_1))
      .toBe("You're seeing every startup that matches today. Your plan allows 10 new ones a month.");
  });

  // The privacy limit: the line must never leak how many startups exist and
  // are excluded. hasUnadmittedCandidates is a boolean for exactly that
  // reason, so no output can carry a supply-side number.
  it('never states how many candidates are being withheld', () => {
    for (const admitted of [0, 3, 10]) {
      for (const withheld of [true, false]) {
        const line = pipelineQuotaLine({ monthlyCap: 10, admittedThisMonth: admitted, hasUnadmittedCandidates: withheld }, MONTH_1)!;
        const numbers = line.match(/\d+/g) ?? [];
        // Every number in the line is either the cap or this month's usage.
        for (const n of numbers) expect([String(admitted), '10', '1']).toContain(n);
      }
    }
  });

  it('returns null when there is no plan cap to describe', () => {
    expect(pipelineQuotaLine(null, MONTH_1)).toBeNull();
    expect(pipelineQuotaLine(undefined, MONTH_1)).toBeNull();
    expect(pipelineQuotaLine({ monthlyCap: 0, admittedThisMonth: 0, hasUnadmittedCandidates: true }, MONTH_1)).toBeNull();
  });

  it('rolls the reset date into next year in December', () => {
    expect(firstOfNextMonth('2026-12-15T00:00:00Z')).toBe('1 January 2027');
    expect(firstOfNextMonth('2026-09-04T12:00:00Z')).toBe('1 October');
  });
});
