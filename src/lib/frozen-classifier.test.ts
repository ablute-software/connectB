import { describe, expect, it } from 'vitest';
import { classifyFrozen, lastInteractionSummary } from './frozen-classifier';
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

  // ECS Capital-shaped case (the prompt's own real example): 3 inbound
  // emails in Feb 2024, zero follow-up from us, no pass, no reopen_trigger.
  it("real ECS Capital shape — inbound-only, no pass, no reopen_trigger -> 'dropped_by_us'", () => {
    const its = [
      interaction({ id: 'i1', direction: 'in', occurred_at: '2024-02-10T00:00:00.000Z' }),
      interaction({ id: 'i2', direction: 'in', occurred_at: '2024-02-20T00:00:00.000Z' }),
      interaction({ id: 'i3', direction: 'in', occurred_at: '2024-02-27T00:00:00.000Z' }),
    ];
    expect(classifyFrozen({}, its)).toBe('dropped_by_us');
  });

  it("an all-outbound thread with no reply is still 'dropped_by_us' — direction never decides the class", () => {
    const its = [interaction({ id: 'i1', direction: 'out' })];
    expect(classifyFrozen({}, its)).toBe('dropped_by_us');
  });

  it("a real pass interaction -> 'closed_for_cause', regardless of direction", () => {
    const its = [interaction({ id: 'i1', direction: 'in', classification: 'pass' })];
    expect(classifyFrozen({}, its)).toBe('closed_for_cause');
  });

  it("reopen_trigger set, no pass -> 'closed_for_cause'", () => {
    const its = [interaction({ id: 'i1' })];
    expect(classifyFrozen({ reopen_trigger: 'they raise a Series A' }, its)).toBe('closed_for_cause');
  });

  it("reopen_eligible_after set, no pass, no reopen_trigger -> 'closed_for_cause'", () => {
    const its = [interaction({ id: 'i1' })];
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
