import { describe, expect, it } from 'vitest';
import {
  buildDealMemoPayload, buildDealMemoSummary, chainForTerm, checkLockPreconditions,
  currentTermsForEntity, deriveInterestEur, topicsAlreadyOnTheTable,
} from './deal-terms';
import type { DealTerm, Interaction } from './types';

const ENTITY = 'zz-test-entity-1';

function term(partial: Partial<DealTerm> & Pick<DealTerm, 'id' | 'kind' | 'side' | 'formality'>): DealTerm {
  return {
    org_id: 'org-1', entity_id: ENTITY, recorded_at: '2026-01-01T00:00:00.000Z', ...partial,
  } as DealTerm;
}

describe('currentTermsForEntity — supersession chain', () => {
  it('a fresh term with no supersede is current', () => {
    const t = term({ id: 't1', kind: 'offer', side: 'theirs', formality: 'mentioned', amount_eur: 100 });
    expect(currentTermsForEntity([t], ENTITY)).toEqual([t]);
  });

  it('a superseding row replaces the one it points at — the old row drops out of "current"', () => {
    const t1 = term({ id: 't1', kind: 'commitment', side: 'theirs', formality: 'mentioned', amount_eur: 270_000, recorded_at: '2026-01-01T00:00:00.000Z' });
    const t2 = term({ id: 't2', kind: 'commitment', side: 'theirs', formality: 'agreed', amount_eur: 200_000, supersedes_id: 't1', recorded_at: '2026-01-05T00:00:00.000Z' });
    const current = currentTermsForEntity([t1, t2], ENTITY);
    expect(current.map((t) => t.id)).toEqual(['t2']);
  });

  it('independent chains (different topics) coexist — each keeps its own head', () => {
    const valuation = term({ id: 'v1', kind: 'valuation', side: 'theirs', formality: 'agreed', amount_eur: 6_000_000 });
    const ticket1 = term({ id: 'tk1', kind: 'ticket_range', side: 'theirs', formality: 'mentioned', text: '100k-200k', recorded_at: '2026-01-01T00:00:00.000Z' });
    const ticket2 = term({ id: 'tk2', kind: 'ticket_range', side: 'theirs', formality: 'negotiating', text: '150k-250k', supersedes_id: 'tk1', recorded_at: '2026-01-03T00:00:00.000Z' });
    const current = currentTermsForEntity([valuation, ticket1, ticket2], ENTITY);
    expect(current.map((t) => t.id).sort()).toEqual(['tk2', 'v1']);
  });

  it('only returns rows for the requested entity', () => {
    const mine = term({ id: 't1', kind: 'offer', side: 'theirs', formality: 'mentioned', amount_eur: 1 });
    const other = term({ id: 't2', kind: 'offer', side: 'theirs', formality: 'mentioned', amount_eur: 2, entity_id: 'zz-test-entity-2' });
    expect(currentTermsForEntity([mine, other], ENTITY)).toEqual([mine]);
  });
});

describe('chainForTerm — full history, oldest first', () => {
  it('walks the whole supersede chain in order', () => {
    const t1 = term({ id: 't1', kind: 'commitment', side: 'theirs', formality: 'mentioned', amount_eur: 300_000 });
    const t2 = term({ id: 't2', kind: 'commitment', side: 'theirs', formality: 'negotiating', amount_eur: 250_000, supersedes_id: 't1' });
    const t3 = term({ id: 't3', kind: 'commitment', side: 'theirs', formality: 'agreed', amount_eur: 200_000, supersedes_id: 't2' });
    expect(chainForTerm([t1, t2, t3], 't3').map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });
});

describe('deriveInterestEur — entities.interest_eur derivation (mirrors the DB trigger)', () => {
  it('undefined with no commitment term', () => {
    const t = term({ id: 't1', kind: 'offer', side: 'theirs', formality: 'agreed', amount_eur: 1 });
    expect(deriveInterestEur([t], ENTITY)).toBeUndefined();
  });

  it('the latest non-superseded commitment amount', () => {
    const t1 = term({ id: 't1', kind: 'commitment', side: 'theirs', formality: 'agreed', amount_eur: 270_000, recorded_at: '2026-01-01T00:00:00.000Z' });
    const t2 = term({ id: 't2', kind: 'commitment', side: 'theirs', formality: 'agreed', amount_eur: 200_000, supersedes_id: 't1', recorded_at: '2026-01-05T00:00:00.000Z' });
    expect(deriveInterestEur([t1, t2], ENTITY)).toBe(200_000);
  });

  it('an ask term never contributes to interest_eur', () => {
    const t = term({ id: 't1', kind: 'ask', side: 'ours', formality: 'mentioned', amount_eur: 1_300_000 });
    expect(deriveInterestEur([t], ENTITY)).toBeUndefined();
  });
});

describe('checkLockPreconditions — §C "activo quando existe >= 1 termo e nenhum está negotiating"', () => {
  it('blocks with zero terms', () => {
    expect(checkLockPreconditions([], ENTITY).canLock).toBe(false);
  });

  it('blocks while any term is negotiating', () => {
    const t = term({ id: 't1', kind: 'valuation', side: 'theirs', formality: 'negotiating', amount_eur: 6_000_000 });
    const check = checkLockPreconditions([t], ENTITY);
    expect(check.canLock).toBe(false);
    expect(check.negotiatingTerms).toHaveLength(1);
  });

  it('allows locking with a mix of agreed and mentioned (no negotiating)', () => {
    const agreed = term({ id: 't1', kind: 'commitment', side: 'theirs', formality: 'agreed', amount_eur: 200_000 });
    const mentioned = term({ id: 't2', kind: 'timing', side: 'theirs', formality: 'mentioned', text: 'Q4 close' });
    const check = checkLockPreconditions([agreed, mentioned], ENTITY);
    expect(check.canLock).toBe(true);
    expect(check.agreedTerms.map((t) => t.id)).toEqual(['t1']);
    expect(check.mentionedTerms.map((t) => t.id)).toEqual(['t2']);
  });

  it('a superseded (no longer current) negotiating row does not block locking', () => {
    const old = term({ id: 't1', kind: 'valuation', side: 'theirs', formality: 'negotiating', amount_eur: 5_000_000, recorded_at: '2026-01-01T00:00:00.000Z' });
    const resolved = term({ id: 't2', kind: 'valuation', side: 'theirs', formality: 'agreed', amount_eur: 6_000_000, supersedes_id: 't1', recorded_at: '2026-01-05T00:00:00.000Z' });
    expect(checkLockPreconditions([old, resolved], ENTITY).canLock).toBe(true);
  });
});

describe('buildDealMemoPayload / buildDealMemoSummary — §C, no AI (deterministic)', () => {
  const entity = { id: ENTITY, name: 'zz-test Ventures' };
  const agreed = [
    term({ id: 't1', kind: 'commitment', side: 'theirs', formality: 'agreed', amount_eur: 200_000, recorded_at: '2026-02-01T00:00:00.000Z' }),
  ];

  it('includes only the terms it is given (the caller decides agreed-only)', () => {
    const payload = buildDealMemoPayload(entity, agreed, agreed, [], []);
    expect(payload.terms).toHaveLength(1);
    expect(payload.terms[0].amountEur).toBe(200_000);
    expect(payload.entityName).toBe('zz-test Ventures');
  });

  it('carries the full supersede chain per term', () => {
    const t1 = term({ id: 't1', kind: 'commitment', side: 'theirs', formality: 'mentioned', amount_eur: 300_000, recorded_at: '2026-01-01T00:00:00.000Z' });
    const t2 = term({ id: 't2', kind: 'commitment', side: 'theirs', formality: 'agreed', amount_eur: 200_000, supersedes_id: 't1', recorded_at: '2026-02-01T00:00:00.000Z' });
    const payload = buildDealMemoPayload(entity, [t2], [t1, t2], [], []);
    expect(payload.terms[0].supersedes.map((s) => s.id)).toEqual(['t1']);
  });

  it('summary is plain text with no AI call and mentions each term', () => {
    const payload = buildDealMemoPayload(entity, agreed, agreed, [], []);
    const summary = buildDealMemoSummary(payload);
    expect(summary).toContain('zz-test Ventures');
    expect(summary).toContain('commitment');
    expect(summary).toContain('€200,000');
  });

  it('only references interactions actually linked by a term', () => {
    const linked = term({ id: 't1', kind: 'offer', side: 'theirs', formality: 'agreed', amount_eur: 1, interaction_id: 'int-1' });
    const interactions: Pick<Interaction, 'id' | 'occurred_at' | 'channel' | 'direction' | 'person_id' | 'content'>[] = [
      { id: 'int-1', occurred_at: '2026-01-01T00:00:00.000Z', channel: 'email', direction: 'in', person_id: undefined, content: 'They offered €1' },
      { id: 'int-2', occurred_at: '2026-01-02T00:00:00.000Z', channel: 'email', direction: 'out', person_id: undefined, content: 'unrelated' },
    ];
    const payload = buildDealMemoPayload(entity, [linked], [linked], [], interactions);
    expect(payload.referencedInteractions.map((i) => i.id)).toEqual(['int-1']);
  });
});

describe('topicsAlreadyOnTheTable — §D founder-only hint, never fed to a prompt', () => {
  it('excludes ask (covered by the Amount-asked field already)', () => {
    const ask = term({ id: 't1', kind: 'ask', side: 'ours', formality: 'mentioned', amount_eur: 1_300_000 });
    expect(topicsAlreadyOnTheTable([ask], ENTITY)).toEqual([]);
  });

  it('lists each distinct current kind once', () => {
    const offer = term({ id: 't1', kind: 'offer', side: 'theirs', formality: 'mentioned', amount_eur: 1 });
    const valuation = term({ id: 't2', kind: 'valuation', side: 'theirs', formality: 'agreed', amount_eur: 2 });
    expect(topicsAlreadyOnTheTable([offer, valuation], ENTITY).sort()).toEqual(['offer', 'valuation']);
  });
});
