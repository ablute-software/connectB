import { describe, it, expect } from 'vitest';
import { viewForFrozenState, pillLabelForFrozenState, pipelineViewForEntity } from './frozen-view-grouping';
import type { EntityFrozenState } from './frozen-classifier';

describe('viewForFrozenState', () => {
  it('groups closed_for_cause, frozen_cold, and not_a_fit into frozen', () => {
    expect(viewForFrozenState('closed_for_cause')).toBe('frozen');
    expect(viewForFrozenState('frozen_cold')).toBe('frozen');
    // Prompt 283 — the actual correction: not_a_fit moved out of reported.
    expect(viewForFrozenState('not_a_fit')).toBe('frozen');
  });

  it('groups stand_by and no_data into stale', () => {
    expect(viewForFrozenState('stand_by')).toBe('stale');
    expect(viewForFrozenState('no_data')).toBe('stale');
  });

  it('reported requires evidence — only blocked (fraud reported with proof) reaches it', () => {
    expect(viewForFrozenState('blocked')).toBe('reported');
  });

  it('every EntityFrozenState value maps to exactly one view (exhaustiveness)', () => {
    const all: EntityFrozenState[] = ['stand_by', 'closed_for_cause', 'frozen_cold', 'no_data', 'not_a_fit', 'blocked'];
    for (const state of all) expect(['frozen', 'stale', 'reported']).toContain(viewForFrozenState(state));
  });
});

describe('pillLabelForFrozenState', () => {
  it('gives not_a_fit its own distinct label from the other Frozen sub-classes', () => {
    expect(pillLabelForFrozenState('not_a_fit')).toBe('Not a fit');
    expect(pillLabelForFrozenState('closed_for_cause')).toBe('Frozen');
    expect(pillLabelForFrozenState('frozen_cold')).toBe('Frozen — no reply');
  });

  it('gives blocked the pending-review label, never a verdict', () => {
    expect(pillLabelForFrozenState('blocked')).toBe('Fraud — pending review');
  });

  it('labels the two Stale sub-classes', () => {
    expect(pillLabelForFrozenState('stand_by')).toBe('Stale');
    expect(pillLabelForFrozenState('no_data')).toBe('Never contacted');
  });
});

// Prompt 852 §C.
describe('pipelineViewForEntity — the fourth view', () => {
  it('sends an investor pass to the Passed view', () => {
    expect(pipelineViewForEntity({ status: 'passed', hasLiveDecision: false })).toBe('passed');
  });

  it('sends the founder’s own live decision to the Passed view whatever the status', () => {
    for (const status of ['active', 'contacted', 'passed', 'dormant']) {
      expect(pipelineViewForEntity({ status, hasLiveDecision: true })).toBe('passed');
    }
  });

  it('lets the founder’s own decision outrank a frozen classification', () => {
    expect(pipelineViewForEntity({ frozenState: 'frozen_cold', status: 'dormant', hasLiveDecision: true })).toBe('passed');
    expect(pipelineViewForEntity({ frozenState: 'blocked', status: 'dormant', hasLiveDecision: true })).toBe('passed');
  });

  // A reverted decision is not a live one, so the entity goes straight back
  // to the active list — the whole point of the choice being reversible.
  it('puts a plain active entity in no view at all', () => {
    expect(pipelineViewForEntity({ status: 'active', hasLiveDecision: false })).toBe('none');
    expect(pipelineViewForEntity({ hasLiveDecision: false })).toBe('none');
  });

  it('leaves the three frozen views exactly where viewForFrozenState puts them', () => {
    const all: EntityFrozenState[] = ['stand_by', 'closed_for_cause', 'frozen_cold', 'no_data', 'not_a_fit', 'blocked'];
    for (const state of all) {
      expect(pipelineViewForEntity({ frozenState: state, status: 'dormant', hasLiveDecision: false }))
        .toBe(viewForFrozenState(state));
    }
  });

  // The existing hard-filter 'not_a_fit' (migration 0195, the PLATFORM's
  // thesis mismatch) is a different thing from the founder's "Not a fit for
  // us" and must keep its own home in Frozen.
  it('keeps the platform hard-filter not_a_fit in Frozen, not in Passed', () => {
    expect(pipelineViewForEntity({ frozenState: 'not_a_fit', status: 'dormant', hasLiveDecision: false })).toBe('frozen');
  });
});
