import { describe, expect, it } from 'vitest';
import { calendarMonthStartIso, computeAdmissions, computeReservationTargets } from './pipeline-admissions';
import { WAVE_SIZE } from './pipeline-waves';
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

describe('computeReservationTargets — progressive-by-wave (Prompt 715 Pedido G)', () => {
  type Card = { orgId: string; status: string; isArchived?: boolean; isWatching?: boolean; hasPendingFollowup?: boolean; hasPendingLevel3Request?: boolean };
  const open = (orgId: string): Card => ({ orgId, status: 'open' });
  const treated = (orgId: string): Card => ({ orgId, status: 'passed' });
  const discovery = (n: number, make = open, prefix = 'd') => Array.from({ length: n }, (_, i) => make(`${prefix}${i + 1}`));

  it('proposes the first WAVE_SIZE candidates when nothing is reserved yet', () => {
    const cards = discovery(20);
    const result = computeReservationTargets(cards, new Set());
    expect(result.alreadyReserved).toEqual([]);
    expect(result.candidateOrgIds).toEqual(discovery(WAVE_SIZE).map((c) => c.orgId));
  });

  it('never re-proposes an already-reserved candidate', () => {
    const cards = discovery(20);
    const reserved = new Set(discovery(WAVE_SIZE).map((c) => c.orgId));
    const result = computeReservationTargets(cards, reserved);
    expect(result.alreadyReserved.map((c) => c.orgId)).toEqual(discovery(WAVE_SIZE).map((c) => c.orgId));
    expect(result.candidateOrgIds).not.toContain('d1');
  });

  it('proposes nothing new while the reserved tail wave is not fully treated', () => {
    const cards = discovery(20);
    const reserved = new Set(discovery(WAVE_SIZE).map((c) => c.orgId));
    // One card in the reserved wave is still open (untreated) — the rest passed.
    const mixedCards = cards.map((c, i) => (reserved.has(c.orgId) && i < WAVE_SIZE - 1 ? treated(c.orgId) : c));
    const result = computeReservationTargets(mixedCards, reserved);
    expect(result.candidateOrgIds).toEqual([]);
  });

  it('proposes the next batch once every card in the reserved tail wave is treated', () => {
    const cards = discovery(20);
    const reservedIds = discovery(WAVE_SIZE).map((c) => c.orgId);
    const reserved = new Set(reservedIds);
    const allTreated = cards.map((c) => (reserved.has(c.orgId) ? treated(c.orgId) : c));
    const result = computeReservationTargets(allTreated, reserved);
    expect(result.candidateOrgIds).toEqual(discovery(WAVE_SIZE, open, 'd').map((_, i) => `d${WAVE_SIZE + i + 1}`));
  });

  it('never reserves the whole month in one go — proposes at most WAVE_SIZE at a time even with plenty of untreated candidates left', () => {
    const cards = discovery(50);
    const result = computeReservationTargets(cards, new Set());
    expect(result.candidateOrgIds).toHaveLength(WAVE_SIZE);
  });

  it('a watch/follow-up/level-3 request on the tail wave unblocks the next reservation, same as it unblocks the next wave', () => {
    const cards = discovery(20);
    const reservedIds = discovery(WAVE_SIZE).map((c) => c.orgId);
    const reserved = new Set(reservedIds);
    const withWatch = cards.map((c, i) => (reserved.has(c.orgId) ? (i === 0 ? { ...c, isWatching: true } : treated(c.orgId)) : c));
    const result = computeReservationTargets(withWatch, reserved);
    expect(result.candidateOrgIds.length).toBeGreaterThan(0);
  });
});
