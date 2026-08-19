import { describe, expect, it } from 'vitest';
import { classifyEntityFrozenState, classifyFrozen, lastInteractionSummary } from './frozen-classifier';
import type { Interaction } from './types';

function interaction(overrides: Partial<Interaction> & { id: string }): Interaction {
  return {
    entity_id: 'e1', occurred_at: '2026-01-01T00:00:00.000Z', direction: 'in', channel: 'email', content: '...',
    ...overrides,
  };
}

describe('classifyFrozen', () => {
  it("no interactions at all -> 'no_data'", () => {
    expect(classifyFrozen({}, [])).toBe('no_data');
  });

  // Real ECS Capital shape (the prompt's own real example): 3 inbound
  // emails in Feb 2024, zero follow-up from us, no pass, no reopen_trigger.
  // Recoverable by us unilaterally — replying fixes it.
  it("real ECS Capital shape — inbound-only, no pass, no reopen_trigger -> 'stand_by'", () => {
    const its = [
      interaction({ id: 'i1', direction: 'in', occurred_at: '2024-02-10T00:00:00.000Z' }),
      interaction({ id: 'i2', direction: 'in', occurred_at: '2024-02-20T00:00:00.000Z' }),
      interaction({ id: 'i3', direction: 'in', occurred_at: '2024-02-27T00:00:00.000Z' }),
    ];
    expect(classifyFrozen({}, its)).toBe('stand_by');
  });

  // Real Alter VP shape (Prompt 273's own correction): 2 outbound from us,
  // zero replies. Nobody dropped a thread — THEY never responded. The ball
  // is in their court; the app's own discipline (rules.ts) already says
  // don't send a 3rd unanswered message. Prompt 271 originally, wrongly,
  // classified this as the same class as ECS — this is the regression test
  // for that bug.
  it("real Alter VP shape — outbound-only, zero replies, no pass, no reopen_trigger -> 'frozen_cold'", () => {
    const its = [
      interaction({ id: 'i1', direction: 'out', occurred_at: '2026-01-05T00:00:00.000Z' }),
      interaction({ id: 'i2', direction: 'out', occurred_at: '2026-01-20T00:00:00.000Z' }),
    ];
    expect(classifyFrozen({}, its)).toBe('frozen_cold');
  });

  it("last touch outbound with no reply at all (single message) -> 'frozen_cold', not 'stand_by'", () => {
    const its = [interaction({ id: 'i1', direction: 'out' })];
    expect(classifyFrozen({}, its)).toBe('frozen_cold');
  });

  it("a real pass interaction -> 'closed_for_cause', regardless of last direction", () => {
    const its = [interaction({ id: 'i1', direction: 'in', classification: 'pass' })];
    expect(classifyFrozen({}, its)).toBe('closed_for_cause');
    const its2 = [interaction({ id: 'i1', direction: 'out', classification: 'pass' })];
    expect(classifyFrozen({}, its2)).toBe('closed_for_cause');
  });

  it("reopen_trigger set, no pass -> 'closed_for_cause'", () => {
    const its = [interaction({ id: 'i1', direction: 'out' })];
    expect(classifyFrozen({ reopen_trigger: 'they raise a Series A' }, its)).toBe('closed_for_cause');
  });

  it("reopen_eligible_after set, no pass, no reopen_trigger -> 'closed_for_cause'", () => {
    const its = [interaction({ id: 'i1', direction: 'out' })];
    expect(classifyFrozen({ reopen_eligible_after: '2027-01-01' }, its)).toBe('closed_for_cause');
  });

  it('one pass among several non-pass interactions is still enough for closed_for_cause', () => {
    const its = [
      interaction({ id: 'i1', classification: 'interested' }),
      interaction({ id: 'i2', classification: 'pass' }),
      interaction({ id: 'i3', classification: 'question' }),
    ];
    expect(classifyFrozen({}, its)).toBe('closed_for_cause');
  });

  it('classification is decided by the LATEST interaction direction, not the first', () => {
    const its = [
      interaction({ id: 'i1', direction: 'out', occurred_at: '2026-01-01T00:00:00.000Z' }),
      interaction({ id: 'i2', direction: 'in', occurred_at: '2026-02-01T00:00:00.000Z' }),
    ];
    expect(classifyFrozen({}, its)).toBe('stand_by');
  });
});

describe('classifyEntityFrozenState', () => {
  // Real Sofinnova shape (Prompt 273's own real example): an accelerator,
  // never a viable backer — hard_filter_status='resolved_blocked'.
  it("hard_filter_status='resolved_blocked' takes precedence over everything else", () => {
    const its = [interaction({ id: 'i1', direction: 'in', classification: 'pass' })];
    expect(classifyEntityFrozenState({ hard_filter_status: 'resolved_blocked' }, its)).toBe('blocked');
    expect(classifyEntityFrozenState({ hard_filter_status: 'resolved_blocked' }, [])).toBe('blocked');
  });

  it('falls through to classifyFrozen when not blocked', () => {
    const its = [interaction({ id: 'i1', direction: 'in' })];
    expect(classifyEntityFrozenState({ hard_filter_status: 'open' }, its)).toBe('stand_by');
    expect(classifyEntityFrozenState({ hard_filter_status: 'not_applicable' }, its)).toBe('stand_by');
  });
});

describe('lastInteractionSummary', () => {
  it('returns undefined for no interactions', () => {
    expect(lastInteractionSummary([])).toBeUndefined();
  });

  it('picks the latest by occurred_at, not by array order', () => {
    const its = [
      interaction({ id: 'i1', occurred_at: '2026-03-01T00:00:00.000Z', direction: 'out' }),
      interaction({ id: 'i2', occurred_at: '2024-02-27T00:00:00.000Z', direction: 'in' }),
      interaction({ id: 'i3', occurred_at: '2025-01-15T00:00:00.000Z', direction: 'out' }),
    ];
    expect(lastInteractionSummary(its)).toEqual({ occurredAt: '2026-03-01T00:00:00.000Z', direction: 'out' });
  });

  it('ECS Capital shape — last of 3 inbound is the Feb 27 one', () => {
    const its = [
      interaction({ id: 'i1', direction: 'in', occurred_at: '2024-02-10T00:00:00.000Z' }),
      interaction({ id: 'i2', direction: 'in', occurred_at: '2024-02-20T00:00:00.000Z' }),
      interaction({ id: 'i3', direction: 'in', occurred_at: '2024-02-27T00:00:00.000Z' }),
    ];
    expect(lastInteractionSummary(its)).toEqual({ occurredAt: '2024-02-27T00:00:00.000Z', direction: 'in' });
  });
});
