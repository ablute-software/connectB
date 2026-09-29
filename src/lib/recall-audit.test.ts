// Prompt 895 (v2) §E — unit tests for the restricted-scope recall_audit
// grouping logic. See recall-audit.ts's header for what this file's
// `research_pending` group actually means in this branch (a reporting label,
// not a production behaviour change).
import { describe, expect, it } from 'vitest';
import { recallAudit, RECALL_AUDIT_SCORE_THRESHOLD, type RecallAuditEntityInput } from './recall-audit';
import type { FitOrgInput } from './catalog-fit';

const org: FitOrgInput = {
  sectors: ['Enterprise Software & SaaS', 'AI, Data & Analytics'],
  stage: 'pre_seed',
  round_min_ticket_eur: 135000,
  round_target_eur: 270000,
  country: 'Portugal',
};

function firm(overrides: Partial<RecallAuditEntityInput>): RecallAuditEntityInput {
  return {
    id: 'id',
    name: 'name',
    sectors_normalized: [],
    stage_min: null,
    stage_max: null,
    check_min_eur: null,
    check_max_eur: null,
    geographies: null,
    hq_country: null,
    thesis: null,
    hasContactablePerson: true,
    ...overrides,
  };
}

describe('recallAudit grouping', () => {
  it('groups a hard-excluded firm under hard_excluded:<reason>', () => {
    const domino = firm({
      id: 'domino', name: 'DOMiNO Ventures',
      sectors_normalized: ['AI, Data & Analytics'],
      geographies: ['Eastern Europe', 'Central Asia', 'Caucasus'],
      hq_country: 'NL',
    });
    const report = recallAudit('SherlockDeal', org, [domino]);
    expect(report.rows[0].group).toBe('hard_excluded:geography_out');
    expect(report.counts['hard_excluded:geography_out']).toBe(1);
    expect(report.groups['hard_excluded:geography_out']).toHaveLength(1);
  });

  it('groups an eligible, above-threshold, contactable firm as eligible', () => {
    const f = firm({
      id: 'good', name: 'Good Fit VC',
      sectors_normalized: ['Enterprise Software & SaaS'],
      stage_min: 'pre_seed', stage_max: 'seed',
      check_min_eur: 50_000, check_max_eur: 500_000,
      hq_country: 'PT',
      hasContactablePerson: true,
    });
    const report = recallAudit('SherlockDeal', org, [f]);
    expect(report.rows[0].group).toBe('eligible');
    expect(report.rows[0].fit.score).toBeGreaterThanOrEqual(RECALL_AUDIT_SCORE_THRESHOLD);
  });

  it('groups an eligible, above-threshold firm with NO contactable person as research_pending, not eligible', () => {
    const f = firm({
      id: 'no-person', name: 'No Person VC',
      sectors_normalized: ['Enterprise Software & SaaS'],
      stage_min: 'pre_seed', stage_max: 'seed',
      check_min_eur: 50_000, check_max_eur: 500_000,
      hq_country: 'PT',
      hasContactablePerson: false,
    });
    const report = recallAudit('SherlockDeal', org, [f]);
    expect(report.rows[0].group).toBe('research_pending');
  });

  it('groups a not-hard-excluded, below-threshold firm as below_threshold regardless of person availability', () => {
    const f = firm({
      id: 'low-score', name: 'Low Score VC',
      sectors_normalized: [], // unknown -> +15 only
      hasContactablePerson: true,
    });
    const report = recallAudit('SherlockDeal', org, [f]);
    expect(report.rows[0].fit.score).toBeLessThan(RECALL_AUDIT_SCORE_THRESHOLD);
    expect(report.rows[0].group).toBe('below_threshold');
  });

  it('lists unknown areas that would matter for an excluded/low-confidence firm', () => {
    const f = firm({ id: 'sparse', name: 'Sparse VC', hasContactablePerson: true });
    const report = recallAudit('SherlockDeal', org, [f]);
    expect(report.rows[0].unknownAreasThatWouldMatter.length).toBeGreaterThan(0);
  });

  it('totals and per-group counts always sum to totalFirms', () => {
    const firms = [
      firm({ id: '1', name: 'a', hasContactablePerson: true }),
      firm({ id: '2', name: 'b', hq_country: 'NL', geographies: ['Central Asia'], hasContactablePerson: true }),
      firm({ id: '3', name: 'c', sectors_normalized: ['Enterprise Software & SaaS'], stage_min: 'pre_seed', stage_max: 'seed', check_min_eur: 50_000, check_max_eur: 500_000, hq_country: 'PT', hasContactablePerson: false }),
    ];
    const report = recallAudit('SherlockDeal', org, firms);
    const sum = Object.values(report.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(report.totalFirms);
    expect(report.totalFirms).toBe(3);
  });
});
