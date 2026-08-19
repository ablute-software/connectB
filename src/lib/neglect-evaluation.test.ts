import { describe, expect, it } from 'vitest';
import { buildNeglectEvaluationPrompt, entityToNeglectCase, neglectProposalPayload } from './neglect-evaluation';
import type { Interaction } from './types';

function interaction(overrides: Partial<Interaction> & { id: string }): Interaction {
  return {
    entity_id: 'e1', occurred_at: '2024-02-10T00:00:00.000Z', direction: 'in', channel: 'email', content: '...',
    ...overrides,
  };
}

const NOW = new Date('2026-08-19T10:00:00.000Z');
const FACTS = [{ id: 'f1', statement: 'Shipped the Porto pilot with 3 clinics live.', category: 'traction' }];

describe('entityToNeglectCase', () => {
  it('returns undefined for an entity with no interactions', () => {
    expect(entityToNeglectCase({ id: 'e1', name: 'ECS Capital' }, [])).toBeUndefined();
  });

  // Real ECS Capital shape: inbound questions, Feb 2024, zero follow-up.
  it('derives the case from the latest interaction, including its content', () => {
    const its = [
      interaction({ id: 'i1', occurred_at: '2024-02-10T00:00:00.000Z', content: 'Question about your traction numbers' }),
      interaction({ id: 'i2', occurred_at: '2024-02-27T00:00:00.000Z', content: 'Any update? Still interested.' }),
    ];
    const c = entityToNeglectCase({ id: 'ent-ecs', name: 'ECS Capital' }, its);
    expect(c).toEqual({
      entityId: 'ent-ecs', entityName: 'ECS Capital',
      lastInteractionDirection: 'in', lastInteractionAt: '2024-02-27T00:00:00.000Z',
      lastInteractionContent: 'Any update? Still interested.', touchCount: 2,
    });
  });

  it('an outbound-last thread reports direction out', () => {
    const its = [interaction({ id: 'i1', direction: 'out', content: 'Just checking in' })];
    const c = entityToNeglectCase({ id: 'e1', name: 'Some Fund' }, its);
    expect(c?.lastInteractionDirection).toBe('out');
  });
});

describe('buildNeglectEvaluationPrompt', () => {
  it('includes entity_id, name, direction, date, and the last message content for every case', () => {
    const c = entityToNeglectCase({ id: 'ent-ecs', name: 'ECS Capital' }, [
      interaction({ id: 'i1', occurred_at: '2024-02-27T00:00:00.000Z', content: 'Any update? Still interested.' }),
    ])!;
    const prompt = buildNeglectEvaluationPrompt([c], NOW, FACTS);
    expect(prompt).toContain('entity_id=ent-ecs');
    expect(prompt).toContain('ECS Capital');
    expect(prompt).toContain('FROM them');
    expect(prompt).toContain('2024-02-27');
    expect(prompt).toContain('Any update? Still interested.');
  });

  it("states today's date, so the model can reason about recency instead of guessing it", () => {
    const c = entityToNeglectCase({ id: 'e1', name: 'X' }, [interaction({ id: 'i1' })])!;
    expect(buildNeglectEvaluationPrompt([c], NOW, FACTS)).toContain("Today's date: 2026-08-19.");
  });

  it('lists confirmed company facts by id, as the only source a new hook may cite', () => {
    const c = entityToNeglectCase({ id: 'e1', name: 'X' }, [interaction({ id: 'i1' })])!;
    const prompt = buildNeglectEvaluationPrompt([c], NOW, FACTS);
    expect(prompt).toContain('[f1]');
    expect(prompt).toContain('Shipped the Porto pilot with 3 clinics live.');
  });

  it('with no confirmed facts, tells the model reactivate is unavailable rather than staying silent about it', () => {
    const c = entityToNeglectCase({ id: 'e1', name: 'X' }, [interaction({ id: 'i1' })])!;
    const prompt = buildNeglectEvaluationPrompt([c], NOW, []);
    expect(prompt).toMatch(/no case here can get outcome="reactivate"/);
  });

  it('describes all three outcomes, including hold_for_hook as distinct from not_worth_it', () => {
    const c = entityToNeglectCase({ id: 'e1', name: 'X' }, [interaction({ id: 'i1' })])!;
    const prompt = buildNeglectEvaluationPrompt([c], NOW, FACTS);
    expect(prompt).toContain('"hold_for_hook"');
    expect(prompt).toContain('"not_worth_it"');
  });
});

describe('neglectProposalPayload', () => {
  const person = { id: 'p1', full_name: 'Ana Pereira' };

  it("'reactivate' maps to reopens=true, status='pending', full advice with the resolved person", () => {
    const payload = neglectProposalPayload('ent-ecs', {
      outcome: 'reactivate', rationale: 'Answer their traction question, share the updated deck.',
      acknowledge: "It's been 18 months of silence on our side.",
      respondTo: [{ question: 'Traction numbers?', answer: 'Share the current MRR and pilot metrics.' }],
      newHook: 'Shipped the Porto pilot with 3 clinics live.',
      channel: 'email', timing: 'This week.',
    }, person);
    expect(payload).toEqual({
      entity_id: 'ent-ecs', trigger_kind: 'neglect', reopens: true, status: 'pending',
      rationale: 'Answer their traction question, share the updated deck.',
      advice: {
        acknowledge: "It's been 18 months of silence on our side.",
        respondTo: [{ question: 'Traction numbers?', answer: 'Share the current MRR and pilot metrics.' }],
        newHook: 'Shipped the Porto pilot with 3 clinics live.',
        holdReason: undefined, channel: 'email', timing: 'This week.',
        personId: 'p1', personName: 'Ana Pereira',
      },
    });
  });

  it("'hold_for_hook' maps to reopens=false, status='dismissed', advice present but no newHook/channel/person", () => {
    const payload = neglectProposalPayload('ent-ecs', {
      outcome: 'hold_for_hook', rationale: 'Real thread, but nothing new to lead with yet.',
      acknowledge: "It's been 18 months of silence on our side.",
      respondTo: [{ question: 'Traction numbers?', answer: 'Share once the pilot data is in.' }],
      holdReason: 'Ship the Porto pilot first, then reopen with real numbers.',
    }, person);
    expect(payload.reopens).toBe(false);
    expect(payload.status).toBe('dismissed');
    expect(payload.advice?.holdReason).toBe('Ship the Porto pilot first, then reopen with real numbers.');
    expect(payload.advice?.newHook).toBeUndefined();
    expect(payload.advice?.personId).toBeUndefined();
  });

  it("'not_worth_it' maps to reopens=false, status='dismissed', no advice object at all — just the rationale", () => {
    const payload = neglectProposalPayload('ent-thin', {
      outcome: 'not_worth_it', rationale: 'A one-word non-reply from years ago — nothing real to answer.',
    }, undefined);
    expect(payload).toEqual({
      entity_id: 'ent-thin', trigger_kind: 'neglect', reopens: false, status: 'dismissed',
      rationale: 'A one-word non-reply from years ago — nothing real to answer.',
      advice: undefined,
    });
  });

  it('reactivate with no resolvable person still builds advice, just without personId/personName', () => {
    const payload = neglectProposalPayload('ent-ecs', {
      outcome: 'reactivate', rationale: 'r',
      acknowledge: 'a', respondTo: [], newHook: 'h', channel: 'email', timing: 't',
    }, undefined);
    expect(payload.advice?.personId).toBeUndefined();
    expect(payload.advice?.personName).toBeUndefined();
    expect(payload.advice?.newHook).toBe('h');
  });
});
