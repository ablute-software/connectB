// Prompt 854 §C/§D — the platform-wide referral pyramid, pure/I/O-free core
// (mirrors pioneer.ts and promo.ts: no env reads, no Supabase client,
// injectable code generator, unit-tested). referral-server.ts composes
// buildReferralCodeDrafts with real DB reads/writes; the back-office
// /api/backoffice/promo-tree route composes buildPromoTree with a real
// promo_redemptions+promo_codes query.
//
// This is an EXTENSION of Prompt 161's own referral mechanism, not a second
// one: same `promo_codes.referral_of_org_id` column, same "Invite other
// founders" card, same /api/promo/referrals route. pioneer.ts's own
// buildReferralCodeDrafts (3 codes at 100%, Pioneer-only) is untouched —
// this module's buildReferralCodeDrafts is the platform-wide sibling (2
// codes at 10%, every redemption), named the same on purpose (mirroring,
// per the prompt's own instruction) but living in a different module, so
// nothing actually collides: each caller imports the one it means.
import { PROMO_ELIGIBLE_PLANS } from './promo';

// Prompt 854 §C.1 — flagged in the report rather than assumed silently:
// - REFERRAL_DISCOUNT_PCT is a FLAT 10% at every generation, not decaying.
//   A decaying ladder would eventually hit 0%, which violates promo_codes'
//   own `check (discount_pct between 1 and 100)`, and "−10% again" reads as
//   the same perk repeating rather than shrinking.
// - REFERRAL_BENEFIT_MONTHS = 12 is a judgement call: a permanent 10% on an
//   unbounded pyramid is a standing revenue commitment nobody costed.
// Both are single named constants — easy to change on one line once Nuno
// decides differently.
export const REFERRAL_CODE_COUNT = 2;
export const REFERRAL_DISCOUNT_PCT = 10;
export const REFERRAL_BENEFIT_MONTHS = 12;
export const REFERRAL_REDEEMABLE_MONTHS = 6;

export interface ReferralCodeDraft {
  code: string;
  label: string;
  kind: 'percent_off';
  discount_pct: number;
  applicable_plans: string[];
  benefit_duration_months: number;
  max_redemptions: 1;
  is_pioneer: false;
  referral_of_org_id: string;
  redeemable_until: string;
}

/**
 * The REFERRAL_CODE_COUNT codes an org receives the moment it redeems any
 * non-Pioneer promo code (referral-server.ts's grantReferralCodes calls
 * this) — same applicable_plans as whichever code the org itself redeemed,
 * falling back to PROMO_ELIGIBLE_PLANS when that code applied to none.
 * `now` defaults to the real clock; a caller (a test) can pin it for a
 * deterministic redeemable_until. generateCode is injected, never
 * Math.random() called directly here, same discipline pioneer.ts and
 * promo.ts already follow — production passes generatePromoCode (promo.ts).
 */
export function buildReferralCodeDrafts(
  orgId: string, applicablePlans: string[], generateCode: () => string, now: Date = new Date(),
): ReferralCodeDraft[] {
  const plans = applicablePlans.length ? applicablePlans : PROMO_ELIGIBLE_PLANS;
  const redeemableUntil = new Date(now);
  redeemableUntil.setMonth(redeemableUntil.getMonth() + REFERRAL_REDEEMABLE_MONTHS);
  return Array.from({ length: REFERRAL_CODE_COUNT }, () => ({
    code: generateCode(),
    label: 'Referral',
    kind: 'percent_off' as const,
    discount_pct: REFERRAL_DISCOUNT_PCT,
    applicable_plans: plans,
    benefit_duration_months: REFERRAL_BENEFIT_MONTHS,
    max_redemptions: 1 as const,
    is_pioneer: false as const,
    referral_of_org_id: orgId,
    redeemable_until: redeemableUntil.toISOString(),
  }));
}

// ---------- Prompt 854 §D — the promo tree (genealogy), derived ----------

// One row per promo_redemptions joined to its promo_codes — the raw facts
// buildPromoTree resolves into a tree. No new column anywhere: the parent
// link IS promo_codes.referral_of_org_id, already on every row.
export interface RedemptionRow {
  orgId: string;
  orgName: string;
  code: string;
  referralOfOrgId: string | null;
  redeemedAt: string;
}

// One org's own edge into the tree: which code it used, who referred it (or
// null at a root), and its depth. Exported on its own (rather than folded
// straight into PromoNode) because it's also the shape ignoredEdges'
// cycle-guard reasons about before the child/descendant counts exist.
export interface PromoEdge {
  orgId: string;
  orgName: string;
  code: string;
  parentOrgId: string | null;
  redeemedAt: string;
  wave: number;
}

export interface PromoNode extends PromoEdge {
  directChildren: number;
  totalDescendants: number;
}

/**
 * Builds the genealogy from raw redemption rows. One node per org that has
 * redeemed at least one promo code (an org that redeemed several still gets
 * exactly one node/edge — the earliest referral-carrying redemption decides
 * its parent, per §D.1). Cycle-safe: a walk that would revisit an org
 * already on its own ancestor chain drops the edge that closes the loop
 * (that org becomes a root instead) and names its code in `ignoredEdges` —
 * a back-office page must not hang on strange data.
 */
export function buildPromoTree(rows: RedemptionRow[]): { nodes: PromoNode[]; ignoredEdges: string[] } {
  const byOrg = new Map<string, RedemptionRow[]>();
  for (const r of rows) {
    const list = byOrg.get(r.orgId) ?? [];
    list.push(r);
    byOrg.set(r.orgId, list);
  }

  // Step 1 — each org's own edge: the EARLIEST redemption that carries a
  // real (non-self) referral parent wins; absent one, the org is a root and
  // its edge is labelled by its earliest redemption's own code.
  const edges = new Map<string, PromoEdge>();
  for (const [orgId, orgRows] of byOrg) {
    const sorted = [...orgRows].sort((a, b) => a.redeemedAt.localeCompare(b.redeemedAt));
    const referralRow = sorted.find((r) => r.referralOfOrgId && r.referralOfOrgId !== orgId);
    const chosen = referralRow ?? sorted[0];
    edges.set(orgId, {
      orgId, orgName: chosen.orgName, code: chosen.code,
      parentOrgId: referralRow ? referralRow.referralOfOrgId : null,
      redeemedAt: chosen.redeemedAt, wave: 0,
    });
  }

  // Step 2 — cycle guard. Walk each org's ancestor chain with a per-walk
  // visited set; revisiting an org within THIS walk means the edge back
  // into it closes a loop — break it there (that org becomes a root) and
  // record what was cut. A single self-referential row never reaches here:
  // it was already excluded from `referralRow` candidacy above, so that org
  // reads as an ordinary root, no warning needed for a case that resolves
  // cleanly on its own.
  const ignoredEdges: string[] = [];
  for (const orgId of edges.keys()) {
    const visited = new Set<string>();
    let cur: string | null = orgId;
    while (cur) {
      if (visited.has(cur)) {
        const cycleEdge = edges.get(cur)!;
        ignoredEdges.push(cycleEdge.code);
        edges.set(cur, { ...cycleEdge, parentOrgId: null });
        break;
      }
      visited.add(cur);
      const parent: string | null = edges.get(cur)?.parentOrgId ?? null;
      cur = parent && edges.has(parent) ? parent : null;
    }
  }

  // Step 3 — wave = depth from root, memoized (parent pointers are now
  // guaranteed acyclic by step 2).
  const waveCache = new Map<string, number>();
  function waveOf(orgId: string): number {
    const cached = waveCache.get(orgId);
    if (cached !== undefined) return cached;
    const edge = edges.get(orgId)!;
    const w = edge.parentOrgId && edges.has(edge.parentOrgId) ? waveOf(edge.parentOrgId) + 1 : 0;
    waveCache.set(orgId, w);
    return w;
  }
  for (const orgId of edges.keys()) waveOf(orgId);

  // Step 4 — direct children + total descendants, one post-order pass over
  // the (now acyclic) parent/child graph, not per-row recursion.
  const childrenOf = new Map<string, string[]>();
  for (const edge of edges.values()) {
    if (!edge.parentOrgId || !edges.has(edge.parentOrgId)) continue;
    const list = childrenOf.get(edge.parentOrgId) ?? [];
    list.push(edge.orgId);
    childrenOf.set(edge.parentOrgId, list);
  }
  const descendantsCache = new Map<string, number>();
  function totalDescendantsOf(orgId: string): number {
    const cached = descendantsCache.get(orgId);
    if (cached !== undefined) return cached;
    const kids = childrenOf.get(orgId) ?? [];
    const total = kids.reduce((sum, k) => sum + 1 + totalDescendantsOf(k), 0);
    descendantsCache.set(orgId, total);
    return total;
  }

  const nodes: PromoNode[] = [...edges.values()].map((edge) => ({
    ...edge,
    wave: waveCache.get(edge.orgId) ?? 0,
    directChildren: (childrenOf.get(edge.orgId) ?? []).length,
    totalDescendants: totalDescendantsOf(edge.orgId),
  }));

  return { nodes, ignoredEdges };
}
