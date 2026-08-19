import { describe, expect, it } from 'vitest';
import { applyFilterVerdicts, buildRejectionFilterPrompt, reactivationToFilterCase, type FilterVerdict } from './reawakening-ai-filter';
import type { PendingReactivation } from './rejection-code-match';
import type { Entity, RejectionCode } from './types';

function makeEntity(overrides: Partial<Entity> & { id: string; name: string }): Entity {
  return {
    type: 'vc', invests_in_geographies: [], website_verified: false,
    email_domain_verified: false, sectors: [], submission_channel_type: 'unknown',
    hard_filter_status: 'not_applicable', status: 'passed', source: 'manual',
    ...overrides,
  };
}

function code(overrides: Partial<RejectionCode> & { id: string }): RejectionCode {
  return {
    entity_id: 'e1', axis_code: 'stage', required_level: 1, level_label: 'seed',
    created_at: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

// The real BlueCrow case (rejection-code-match.test.ts's own fixture): a
// pass over "requerem produto no mercado" — stage axis, required_level
// pointing at series_a — now cleared because the org reached series_a.
const blueCrow: PendingReactivation = {
  code: code({ id: 'rc-bluecrow', entity_id: 'ent-bluecrow', axis_code: 'stage', required_level: 2, level_label: 'series_a' }),
  entity: makeEntity({ id: 'ent-bluecrow', name: 'BlueCrow Capital' }),
  rationale: 'Passed earlier over stage (needed: series_a) — that bar looks cleared now. Cite the earlier "no" when re-approaching.',
};

// Constructed second case (no real Speedinvest Health clash-clear scenario
// exists in this codebase — confirmed by repo-wide search before writing
// this test; see Prompt 268's report) — a sector-axis clear, same shape
// class as blueCrow but a different axis, for coverage.
const constructedSector: PendingReactivation = {
  code: code({ id: 'rc-sector', entity_id: 'ent-sector', axis_code: 'sector', required_level: 0, level_label: 'healthtech' }),
  entity: makeEntity({ id: 'ent-sector', name: 'Constructed Health Fund' }),
  rationale: 'Passed earlier over sector (needed: healthtech) — that bar looks cleared now. Cite the earlier "no" when re-approaching.',
};

describe('reactivationToFilterCase', () => {
  it('carries the code, entity, and rationale into the AI-facing shape', () => {
    const c = reactivationToFilterCase(blueCrow);
    expect(c).toEqual({
      rejectionCodeId: 'rc-bluecrow', entityName: 'BlueCrow Capital',
      axisCode: 'stage', levelLabel: 'series_a', rationale: blueCrow.rationale,
    });
  });

  it('threads a given priorPass reason/category into the case — never left "(not recorded)" when the founder actually logged one', () => {
    const c = reactivationToFilterCase(blueCrow, { reason: 'Valuation too high for our thesis.', category: 'valuation' });
    expect(c.priorPassReason).toBe('Valuation too high for our thesis.');
    expect(c.priorPassCategory).toBe('valuation');
  });
});

describe('buildRejectionFilterPrompt', () => {
  it('lists every case with its rejection_code_id, axis, and rationale', () => {
    const prompt = buildRejectionFilterPrompt([reactivationToFilterCase(blueCrow), reactivationToFilterCase(constructedSector)]);
    expect(prompt).toContain('rejection_code_id=rc-bluecrow');
    expect(prompt).toContain('BlueCrow Capital');
    expect(prompt).toContain('rejection_code_id=rc-sector');
    expect(prompt).toContain('Constructed Health Fund');
  });

  it('never claims to re-decide the deterministic clash-clear itself', () => {
    const prompt = buildRejectionFilterPrompt([reactivationToFilterCase(blueCrow)]);
    expect(prompt).toMatch(/FINAL and not yours to override/);
  });
});

describe('applyFilterVerdicts', () => {
  it("keeps a 'pass' reactivation unchanged", () => {
    const verdicts = new Map<string, FilterVerdict>([
      ['rc-bluecrow', { verdict: 'pass', aiNote: 'Legitimate — stage bar genuinely cleared.' }],
    ]);
    const out = applyFilterVerdicts([blueCrow], verdicts);
    expect(out).toHaveLength(1);
    expect(out[0].reactivation).toBe(blueCrow);
    expect(out[0].taskTitleOverride).toBeUndefined();
  });

  it("drops a 'hold' reactivation entirely — no proposal, no task", () => {
    const verdicts = new Map<string, FilterVerdict>([
      ['rc-bluecrow', { verdict: 'hold', aiNote: 'Only one data point since the pass — wait for a second signal.' }],
    ]);
    const out = applyFilterVerdicts([blueCrow], verdicts);
    expect(out).toHaveLength(0);
  });

  it("an 'enrich' verdict replaces the rationale and carries a task title override", () => {
    const verdicts = new Map<string, FilterVerdict>([
      ['rc-bluecrow', {
        verdict: 'enrich', aiNote: 'Sharper framing available.',
        enrichedRationale: 'BlueCrow passed pre-product — the seed round just shipped a live pilot in Porto.',
        enrichedTaskTitle: 'Revisit BlueCrow — live pilot now shipped',
      }],
    ]);
    const out = applyFilterVerdicts([blueCrow], verdicts);
    expect(out).toHaveLength(1);
    expect(out[0].reactivation.rationale).toBe('BlueCrow passed pre-product — the seed round just shipped a live pilot in Porto.');
    expect(out[0].reactivation).not.toBe(blueCrow);
    expect(out[0].taskTitleOverride).toBe('Revisit BlueCrow — live pilot now shipped');
  });

  it("an 'enrich' verdict with no enrichedRationale falls back to the original wording", () => {
    const verdicts = new Map<string, FilterVerdict>([
      ['rc-bluecrow', { verdict: 'enrich', aiNote: 'No better wording found.' }],
    ]);
    const out = applyFilterVerdicts([blueCrow], verdicts);
    expect(out[0].reactivation.rationale).toBe(blueCrow.rationale);
  });

  it('a case missing from the verdicts map (fail-open) behaves exactly like an explicit pass', () => {
    const out = applyFilterVerdicts([blueCrow, constructedSector], new Map());
    expect(out).toHaveLength(2);
    expect(out[0].reactivation).toBe(blueCrow);
    expect(out[1].reactivation).toBe(constructedSector);
  });

  it('filters independently per case — one hold never affects another case in the same batch', () => {
    const verdicts = new Map<string, FilterVerdict>([
      ['rc-bluecrow', { verdict: 'hold', aiNote: 'Too thin.' }],
      ['rc-sector', { verdict: 'pass', aiNote: 'Clean clear.' }],
    ]);
    const out = applyFilterVerdicts([blueCrow, constructedSector], verdicts);
    expect(out).toHaveLength(1);
    expect(out[0].reactivation.code.id).toBe('rc-sector');
  });
});
