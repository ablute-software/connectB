import { describe, expect, it } from 'vitest';
import {
  prefilterEntities, priorPassInfo, chunk, proposalStatusForVerdict, buildReawakenApproval,
} from './reawakening';
import type { Entity, Interaction } from './types';

function ent(p: Partial<Entity> & { id: string }): Entity {
  return { name: p.id, status: 'dormant', wave: 1, ...p } as Entity;
}
function inter(p: Partial<Interaction>): Interaction {
  return { id: 'i', occurred_at: '2024-01-01', direction: 'in', channel: 'email', content: '', ...p } as Interaction;
}

describe('prefilterEntities (mechanical prefilter + evaluated-pair dedup)', () => {
  const entities = [
    ent({ id: 'a', status: 'dormant', reopen_trigger: 'raise a lead' }),
    ent({ id: 'b', status: 'passed', reopen_trigger: 'show EU traction' }),
    ent({ id: 'c', status: 'contacted', reopen_trigger: 'irrelevant — active' }),
    ent({ id: 'd', status: 'dormant', reopen_trigger: undefined }),
    ent({ id: 'e', status: 'passed', reopen_trigger: '   ' }),
    ent({ id: 'f', status: 'invested', reopen_trigger: 'n/a' }),
  ];

  it('keeps only dormant/passed entities that carry a non-empty reopen_trigger', () => {
    expect(prefilterEntities(entities, []).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('excludes entities whose (fact,entity) pair was already evaluated', () => {
    expect(prefilterEntities(entities, ['a']).map((e) => e.id)).toEqual(['b']);
    expect(prefilterEntities(entities, new Set(['a', 'b']))).toEqual([]);
  });

  it('excludes active/invested statuses even with a reopen_trigger', () => {
    const ids = prefilterEntities(entities, []).map((e) => e.id);
    expect(ids).not.toContain('c');
    expect(ids).not.toContain('f');
  });

  it('treats whitespace-only reopen_trigger as absent', () => {
    expect(prefilterEntities(entities, []).map((e) => e.id)).not.toContain('e');
  });
});

describe('priorPassInfo', () => {
  it('returns the most recent pass reason + category', () => {
    const its = [
      inter({ classification: 'pass', pass_reason: 'too early', pass_reason_category: 'stage_too_early', occurred_at: '2023-01-01' }),
      inter({ classification: 'pass', pass_reason: 'valuation too high', pass_reason_category: 'valuation', occurred_at: '2024-06-01' }),
      inter({ classification: 'interested', occurred_at: '2024-07-01' }),
    ];
    expect(priorPassInfo(its)).toEqual({ reason: 'valuation too high', category: 'valuation' });
  });

  it('returns {} when there is no pass', () => {
    expect(priorPassInfo([inter({ classification: 'interested' })])).toEqual({});
    expect(priorPassInfo([])).toEqual({});
  });
});

describe('chunk (batched-call size guard)', () => {
  it('splits a >40 list into chunks of 40', () => {
    const arr = Array.from({ length: 95 }, (_, i) => i);
    const chunks = chunk(arr);
    expect(chunks.map((c) => c.length)).toEqual([40, 40, 15]);
  });

  it('returns a single chunk when at or below the size', () => {
    expect(chunk([1, 2, 3]).length).toBe(1);
  });

  it('guards against a non-positive size', () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
  });
});

describe('proposalStatusForVerdict', () => {
  it('reopens true → pending, false → dismissed', () => {
    expect(proposalStatusForVerdict(true)).toBe('pending');
    expect(proposalStatusForVerdict(false)).toBe('dismissed');
  });
});

describe('buildReawakenApproval (approval flow effects)', () => {
  const proposal = { entity_id: 'x', suggested_wave: 2, suggested_fit: 'high' as const, fact_statement: 'Closed a lead investor' };

  it('returns entity active with the suggested wave/fit and a follow-up task', () => {
    const { entityPatch, task } = buildReawakenApproval(proposal, 'Acme Ventures');
    expect(entityPatch).toEqual({ status: 'contacted', wave: 2, fit_score: 'high' });
    expect(task.action_type).toBe('follow_up_no_reply');
    expect(task.kind).toBe('follow_up');
    expect(task.entity_id).toBe('x');
    expect(task.title).toContain('Acme Ventures');
    expect(task.title).toContain('Closed a lead investor');
  });

  it('lets approval-time overrides win over the AI suggestion', () => {
    const { entityPatch } = buildReawakenApproval(proposal, 'Acme', { wave: 1, fit: 'medium' });
    expect(entityPatch.wave).toBe(1);
    expect(entityPatch.fit_score).toBe('medium');
  });

  it('omits wave/fit when neither suggested nor overridden', () => {
    const { entityPatch } = buildReawakenApproval({ entity_id: 'y' }, 'NoSuggest');
    expect(entityPatch).toEqual({ status: 'contacted' });
    expect('wave' in entityPatch).toBe(false);
    expect('fit_score' in entityPatch).toBe(false);
  });
});
