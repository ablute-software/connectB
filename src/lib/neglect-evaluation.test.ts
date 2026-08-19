import { describe, expect, it } from 'vitest';
import { buildNeglectEvaluationPrompt, entityToNeglectCase, neglectProposalPayload } from './neglect-evaluation';
import type { Interaction } from './types';

function interaction(overrides: Partial<Interaction> & { id: string }): Interaction {
  return {
    entity_id: 'e1', occurred_at: '2024-02-10T00:00:00.000Z', direction: 'in', channel: 'email', content: '...',
    ...overrides,
  };
}

describe('entityToNeglectCase', () => {
  it('returns undefined for an entity with no interactions', () => {
    expect(entityToNeglectCase({ id: 'e1', name: 'ECS Capital' }, [])).toBeUndefined();
  });

  // Real ECS Capital shape: 3 inbound questions, Feb 2024, zero follow-up.
  it('derives the case from the latest interaction, including its content', () => {
    const its = [
      interaction({ id: 'i1', occurred_at: '2024-02-10T00:00:00.000Z', content: 'Question about your traction numbers' }),
      interaction({ id: 'i2', occurred_at: '2024-02-20T00:00:00.000Z', content: 'Following up on my question' }),
      interaction({ id: 'i3', occurred_at: '2024-02-27T00:00:00.000Z', content: 'Any update? Still interested.' }),
    ];
    const c = entityToNeglectCase({ id: 'ent-ecs', name: 'ECS Capital' }, its);
    expect(c).toEqual({
      entityId: 'ent-ecs', entityName: 'ECS Capital',
      lastInteractionDirection: 'in', lastInteractionAt: '2024-02-27T00:00:00.000Z',
      lastInteractionContent: 'Any update? Still interested.', touchCount: 3,
    });
  });

  it('an outbound-last thread reports direction out', () => {
    const its = [interaction({ id: 'i1', direction: 'out', content: 'Just checking in' })];
    const c = entityToNeglectCase({ id: 'e1', name: 'Some Fund' }, its);
    expect(c?.lastInteractionDirection).toBe('out');
  });
});

describe('buildNeglectEvaluationPrompt', () => {
  const NOW = new Date('2026-08-19T10:00:00.000Z');

  it('includes entity_id, name, direction, date, and the last message content for every case', () => {
    const c = entityToNeglectCase({ id: 'ent-ecs', name: 'ECS Capital' }, [
      interaction({ id: 'i1', occurred_at: '2024-02-27T00:00:00.000Z', content: 'Any update? Still interested.' }),
    ])!;
    const prompt = buildNeglectEvaluationPrompt([c], NOW);
    expect(prompt).toContain('entity_id=ent-ecs');
    expect(prompt).toContain('ECS Capital');
    expect(prompt).toContain('FROM them');
    expect(prompt).toContain('2024-02-27');
    expect(prompt).toContain('Any update? Still interested.');
  });

  it("states today's date, so the model can reason about recency instead of guessing it", () => {
    const c = entityToNeglectCase({ id: 'e1', name: 'X' }, [interaction({ id: 'i1' })])!;
    expect(buildNeglectEvaluationPrompt([c], NOW)).toContain("Today's date: 2026-08-19.");
  });

  it('never claims to re-decide the classification itself', () => {
    const c = entityToNeglectCase({ id: 'e1', name: 'X' }, [interaction({ id: 'i1' })])!;
    expect(buildNeglectEvaluationPrompt([c], NOW)).toMatch(/nobody ever formally closed/);
  });
});

describe('neglectProposalPayload', () => {
  const nc = entityToNeglectCase({ id: 'ent-ecs', name: 'ECS Capital' }, [interaction({ id: 'i1' })])!;

  it("'reactivate' maps to reopens=true, status='pending'", () => {
    const payload = neglectProposalPayload(nc, { verdict: 'reactivate', rationale: 'Answer their traction question, share the updated deck.' });
    expect(payload).toEqual({
      entity_id: 'ent-ecs', trigger_kind: 'neglect', reopens: true,
      rationale: 'Answer their traction question, share the updated deck.', status: 'pending',
    });
  });

  it("'not_worth_it' maps to reopens=false, status='dismissed' — recorded, never dropped", () => {
    const payload = neglectProposalPayload(nc, { verdict: 'not_worth_it', rationale: 'Two prior no-replies already — low signal.' });
    expect(payload).toEqual({
      entity_id: 'ent-ecs', trigger_kind: 'neglect', reopens: false,
      rationale: 'Two prior no-replies already — low signal.', status: 'dismissed',
    });
  });
});
