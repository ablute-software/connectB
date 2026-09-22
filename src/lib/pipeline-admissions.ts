// Prompt 850 §D — the monthly-cap arithmetic of the investor Pipeline,
// pulled out of getPipelineWaves so the rule can be pinned by unit tests
// instead of only by a live database.
//
// What this confirms rather than changes (Prompt 153, migration 0157): a
// discovery admission is PERMANENT. investor_pipeline_admissions records
// when a candidate first became visible to a firm, and nothing removes it.
// The budget is `monthlyCap - (admissions created this calendar month)`, so
// the pipeline ACCUMULATES and is never re-shuffled: 30 candidates on Pro
// Scout's 10/month is 10 in month one, 20 in month two, 30 in month three.
// The cap limits how many NEW startups arrive, not how many you hold.
//
// What this DOES change is one line of it: only admissions whose org is
// STILL ELIGIBLE count against the month's budget. An org that was admitted
// and has since closed (orgs.closed_at), been hidden by its founder, or been
// suspended from the back-office is gone from the pipeline, and must not go
// on spending the investor's quota on a card they cannot see. Live case:
// the "Test investor" firm spent 3 of 10 at 09:03 on 04/09/2026 and one of
// those three (Estojo) is back-office suspended — that slot refunds itself.
import type { PipelineQuota } from './pipeline-quota-line';
import { WAVE_SIZE, isTreatedForWaveDosage } from './pipeline-waves';

export function calendarMonthStartIso(nowIso: string): string {
  const now = new Date(nowIso);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export interface AdmissionInput<T> {
  /** Discovery-only cards, already sorted best-match-first. */
  discoveryCards: T[];
  /** org_id -> admitted_at, every admission this firm has ever had. */
  admittedAtByOrg: Map<string, string>;
  /** The orgs that pass eligibility RIGHT NOW (eligiblePipelineOrgIds). */
  eligibleNowOrgIds: Set<string>;
  monthlyCap: number;
  nowIso: string;
}

export interface AdmissionResult<T> {
  /** What the investor sees: every prior admission still on the board, plus
   *  whatever this month's remaining budget could afford. */
  admitted: T[];
  /** Rows to upsert into investor_pipeline_admissions. */
  newlyAdmittedOrgIds: string[];
  quota: PipelineQuota;
}

export function computeAdmissions<T extends { orgId: string }>(input: AdmissionInput<T>): AdmissionResult<T> {
  const { discoveryCards, admittedAtByOrg, eligibleNowOrgIds, monthlyCap, nowIso } = input;
  const monthStart = calendarMonthStartIso(nowIso);
  const admittedThisMonthCount = [...admittedAtByOrg.entries()]
    .filter(([orgId, admittedAt]) => admittedAt >= monthStart && eligibleNowOrgIds.has(orgId)).length;

  let budget = Math.max(0, monthlyCap - admittedThisMonthCount);
  const newlyAdmittedOrgIds: string[] = [];
  const admitted = discoveryCards.filter((c) => {
    // Permanent: an already-admitted candidate never re-spends budget and
    // never falls off the board to make room for a better match.
    if (admittedAtByOrg.has(c.orgId)) return true;
    if (budget <= 0) return false;
    budget -= 1;
    newlyAdmittedOrgIds.push(c.orgId);
    return true;
  });

  return {
    admitted,
    newlyAdmittedOrgIds,
    quota: {
      monthlyCap,
      admittedThisMonth: admittedThisMonthCount + newlyAdmittedOrgIds.length,
      // A boolean, never a count — see pipeline-quota-line.ts's header.
      hasUnadmittedCandidates: admitted.length < discoveryCards.length,
    },
  };
}

// Prompt 715 Pedido G — progressive-by-wave reservation. This function
// stays pure and untested-against-a-database on purpose, same spirit as
// computeAdmissions above (which it deliberately leaves untouched): it
// only decides WHICH org_ids should be proposed to the atomic SQL function
// (reserve_pipeline_admissions) next, never how many of them the month's
// budget can actually afford — that check happens inside the advisory-lock
// transaction, where a stale read here can't cause an overshoot.
//
// "Reserva-se só o que a próxima wave desbloqueada precisa... quando a
// wave anterior fica tratada": already-reserved discovery cards are never
// re-proposed (permanent, same as computeAdmissions' own admittedAtByOrg
// check); a NEW batch is proposed only once every card in the tail
// WAVE_SIZE-sized chunk of what's already reserved is treated — the exact
// gate that already unlocks the next wave in buildPipelineWaves, reused
// rather than reinvented.
export interface ReservationTargets<T> {
  /** Already-reserved discovery cards, in rank order — unchanged, never re-proposed. */
  alreadyReserved: T[];
  /** Not-yet-reserved org_ids to propose to reserve_pipeline_admissions, best-ranked first. Empty when the tail wave isn't fully treated yet. */
  candidateOrgIds: string[];
}

export function computeReservationTargets<T extends { orgId: string; status: string; isArchived?: boolean; isWatching?: boolean; hasPendingFollowup?: boolean; hasPendingLevel3Request?: boolean }>(
  discoveryCards: T[], reservedOrgIds: Set<string>,
): ReservationTargets<T> {
  const alreadyReserved = discoveryCards.filter((c) => reservedOrgIds.has(c.orgId));
  const notYetReserved = discoveryCards.filter((c) => !reservedOrgIds.has(c.orgId));
  const needsMore = alreadyReserved.length === 0 || alreadyReserved.slice(-WAVE_SIZE).every(isTreatedForWaveDosage);
  return { alreadyReserved, candidateOrgIds: needsMore ? notYetReserved.slice(0, WAVE_SIZE).map((c) => c.orgId) : [] };
}
