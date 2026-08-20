import { describe, it, expect } from 'vitest';
import { viewForFrozenState, pillLabelForFrozenState } from './frozen-view-grouping';
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
