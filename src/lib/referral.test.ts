import { describe, expect, it } from 'vitest';
import {
  buildReferralCodeDrafts, buildPromoTree, REFERRAL_CODE_COUNT, REFERRAL_DISCOUNT_PCT,
  REFERRAL_BENEFIT_MONTHS, REFERRAL_REDEEMABLE_MONTHS, type RedemptionRow,
} from './referral';

describe('buildReferralCodeDrafts', () => {
  const NOW = new Date('2026-01-15T00:00:00.000Z');
  let n = 0;
  const generateCode = () => `CODE${++n}`;

  it('produces REFERRAL_CODE_COUNT drafts with the right shape', () => {
    const drafts = buildReferralCodeDrafts('org-1', ['garage', 'motherfunding'], generateCode, NOW);
    expect(drafts).toHaveLength(REFERRAL_CODE_COUNT);
    for (const d of drafts) {
      expect(d.discount_pct).toBe(REFERRAL_DISCOUNT_PCT);
      expect(d.kind).toBe('percent_off');
      expect(d.max_redemptions).toBe(1);
      expect(d.is_pioneer).toBe(false);
      expect(d.referral_of_org_id).toBe('org-1');
      expect(d.benefit_duration_months).toBe(REFERRAL_BENEFIT_MONTHS);
      expect(d.applicable_plans).toEqual(['garage', 'motherfunding']);
    }
  });

  it('codes are unique across the batch (never Math.random() called directly here — generateCode is injected)', () => {
    const drafts = buildReferralCodeDrafts('org-1', ['garage'], generateCode, NOW);
    const codes = new Set(drafts.map((d) => d.code));
    expect(codes.size).toBe(drafts.length);
  });

  it('falls back to PROMO_ELIGIBLE_PLANS when the redeemed code applied to no plans', () => {
    const drafts = buildReferralCodeDrafts('org-1', [], generateCode, NOW);
    expect(drafts[0].applicable_plans.length).toBeGreaterThan(0);
  });

  it('redeemable_until is REFERRAL_REDEEMABLE_MONTHS out from `now`', () => {
    const drafts = buildReferralCodeDrafts('org-1', ['garage'], generateCode, NOW);
    const expected = new Date(NOW);
    expected.setMonth(expected.getMonth() + REFERRAL_REDEEMABLE_MONTHS);
    expect(drafts[0].redeemable_until).toBe(expected.toISOString());
  });
});

describe('buildPromoTree', () => {
  function row(p: Partial<RedemptionRow> & { orgId: string; code: string }): RedemptionRow {
    return { orgName: p.orgId, referralOfOrgId: null, redeemedAt: '2026-01-01T00:00:00.000Z', ...p };
  }

  it('a 3-generation chain: waves 0/1/2, descendants 2/1/0', () => {
    const rows: RedemptionRow[] = [
      row({ orgId: 'root', code: 'CAMPAIGN', redeemedAt: '2026-01-01T00:00:00.000Z' }),
      row({ orgId: 'mid', code: 'R1', referralOfOrgId: 'root', redeemedAt: '2026-02-01T00:00:00.000Z' }),
      row({ orgId: 'leaf', code: 'R2', referralOfOrgId: 'mid', redeemedAt: '2026-03-01T00:00:00.000Z' }),
    ];
    const { nodes, ignoredEdges } = buildPromoTree(rows);
    expect(ignoredEdges).toEqual([]);
    const byId = new Map(nodes.map((n) => [n.orgId, n]));
    expect(byId.get('root')).toMatchObject({ wave: 0, directChildren: 1, totalDescendants: 2, parentOrgId: null });
    expect(byId.get('mid')).toMatchObject({ wave: 1, directChildren: 1, totalDescendants: 1, parentOrgId: 'root' });
    expect(byId.get('leaf')).toMatchObject({ wave: 2, directChildren: 0, totalDescendants: 0, parentOrgId: 'mid' });
  });

  it('an org with two redemptions takes the EARLIEST referral parent', () => {
    const rows: RedemptionRow[] = [
      row({ orgId: 'root1', code: 'C1' }),
      row({ orgId: 'root2', code: 'C2' }),
      row({ orgId: 'child', code: 'R-late', referralOfOrgId: 'root2', redeemedAt: '2026-03-01T00:00:00.000Z' }),
      row({ orgId: 'child', code: 'R-early', referralOfOrgId: 'root1', redeemedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const { nodes } = buildPromoTree(rows);
    const child = nodes.find((n) => n.orgId === 'child')!;
    expect(child.parentOrgId).toBe('root1');
    expect(child.code).toBe('R-early');
  });

  it('a root with only a campaign code (referral_of_org_id null)', () => {
    const { nodes } = buildPromoTree([row({ orgId: 'root', code: 'CAMPAIGN50' })]);
    expect(nodes).toEqual([expect.objectContaining({ orgId: 'root', parentOrgId: null, wave: 0 })]);
  });

  it('a self-referential row resolves silently as a root, not an ignored edge', () => {
    const { nodes, ignoredEdges } = buildPromoTree([row({ orgId: 'x', code: 'SELF', referralOfOrgId: 'x' })]);
    expect(ignoredEdges).toEqual([]);
    expect(nodes[0].parentOrgId).toBeNull();
  });

  it('an induced cycle breaks one edge, reports it, and never hangs', () => {
    const rows: RedemptionRow[] = [
      row({ orgId: 'a', code: 'CA', referralOfOrgId: 'c', redeemedAt: '2026-01-03T00:00:00.000Z' }),
      row({ orgId: 'b', code: 'CB', referralOfOrgId: 'a', redeemedAt: '2026-01-01T00:00:00.000Z' }),
      row({ orgId: 'c', code: 'CC', referralOfOrgId: 'b', redeemedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    const { nodes, ignoredEdges } = buildPromoTree(rows);
    expect(ignoredEdges.length).toBe(1);
    expect(['CA', 'CB', 'CC']).toContain(ignoredEdges[0]);
    // Every org still resolves to a finite wave — the whole point of the guard.
    for (const n of nodes) expect(Number.isFinite(n.wave)).toBe(true);
    // Exactly one root now exists among the three.
    expect(nodes.filter((n) => n.parentOrgId === null).length).toBe(1);
  });

  it('empty input -> empty tree, no error', () => {
    expect(buildPromoTree([])).toEqual({ nodes: [], ignoredEdges: [] });
  });
});
