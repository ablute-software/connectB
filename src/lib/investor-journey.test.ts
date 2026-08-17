// Prompt 216 §B — a jornada vista pelo investidor. O contrato de
// privacidade (§A) está nos TIPOS: o input só admite as formas
// investor-visíveis (log próprio, thread própria, docs com gate resolvido,
// decisão própria) — não há como passar interactions do founder sem o
// compilador reclamar.
import { describe, expect, it } from 'vitest';
import { investorJourneySteps, type InvestorJourneyInput } from './investor-journey';

function base(overrides: Partial<InvestorJourneyInput> = {}): InvestorJourneyInput {
  return { entries: [], messages: [], accessibleDocs: [], status: 'open', decidedAt: null, ...overrides };
}

function step(steps: ReturnType<typeof investorJourneySteps>, key: string) {
  const s = steps.find((x) => x.key === key);
  if (!s) throw new Error(`step ${key} missing`);
  return s;
}

describe('investorJourneySteps', () => {
  it('empty relationship: everything future, current = In review', () => {
    const steps = investorJourneySteps(base());
    expect(step(steps, 'first_contact').state).toBe('future');
    expect(step(steps, 'interest').state).toBe('future');
    expect(step(steps, 'documents').state).toBe('future');
    expect(step(steps, 'messages').state).toBe('future');
    expect(step(steps, 'current').label).toBe('In review');
  });

  it('first contact is the earliest event across log AND messages', () => {
    const steps = investorJourneySteps(base({
      entries: [{ id: 'e1', kind: 'manual', at: '2026-08-10T10:00:00Z' }],
      messages: [{ createdAt: '2026-08-08T09:00:00Z' }],
    }));
    expect(step(steps, 'first_contact')).toMatchObject({ state: 'done', at: '2026-08-08T09:00:00Z' });
  });

  it('interest comes from the automatic log entry when present', () => {
    const steps = investorJourneySteps(base({
      entries: [
        { id: 'e1', kind: 'manual', at: '2026-08-01T10:00:00Z' },
        { id: 'e2', kind: 'interested', at: '2026-08-03T10:00:00Z' },
      ],
      status: 'interested', decidedAt: '2026-08-04T10:00:00Z',
    }));
    // a entrada do log ganha ao decidedAt — é o registo mais antigo do facto
    expect(step(steps, 'interest')).toMatchObject({ state: 'done', at: '2026-08-03T10:00:00Z' });
  });

  it('interest falls back to decidedAt only when the decision was interested', () => {
    const interested = investorJourneySteps(base({ status: 'interested', decidedAt: '2026-08-04T10:00:00Z' }));
    expect(step(interested, 'interest')).toMatchObject({ state: 'done', at: '2026-08-04T10:00:00Z' });
    const passed = investorJourneySteps(base({ status: 'passed', decidedAt: '2026-08-04T10:00:00Z' }));
    expect(step(passed, 'interest').state).toBe('future');
  });

  it('current reflects the investor decision, dated by decidedAt', () => {
    const steps = investorJourneySteps(base({ status: 'passed', decidedAt: '2026-08-05T10:00:00Z' }));
    expect(step(steps, 'current')).toMatchObject({ label: 'Passed', at: '2026-08-05T10:00:00Z' });
  });

  it('documents step is done with access today even without log events', () => {
    const steps = investorJourneySteps(base({ accessibleDocs: [{ id: 'd1', name: 'Deck' }] }));
    expect(step(steps, 'documents')).toMatchObject({ state: 'done', count: 1 });
  });

  it('documents step stays done when the doc appeared in the log but access was lost', () => {
    const steps = investorJourneySteps(base({
      entries: [{ id: 'e1', kind: 'manual', at: '2026-08-02T10:00:00Z', document: { id: 'd1', name: 'Deck' } }],
      accessibleDocs: [],
    }));
    expect(step(steps, 'documents').state).toBe('done');
    expect(step(steps, 'documents').docs?.[0]).toMatchObject({ documentId: 'd1', accessible: false });
  });

  it('first doc anchors to the documents step (its own boundary), later docs to the phase they arrived in', () => {
    const steps = investorJourneySteps(base({
      entries: [
        { id: 'e1', kind: 'manual', at: '2026-08-01T10:00:00Z' },
        { id: 'e2', kind: 'interested', at: '2026-08-03T10:00:00Z' },
        { id: 'e3', kind: 'manual', at: '2026-08-04T10:00:00Z', document: { id: 'd1', name: 'Deck' } },
        // partilhado depois da thread arrancar -> ancora ao passo messages
        { id: 'e4', kind: 'manual', at: '2026-08-07T10:00:00Z', document: { id: 'd2', name: 'Cap table' } },
      ],
      messages: [{ createdAt: '2026-08-06T10:00:00Z' }],
      accessibleDocs: [{ id: 'd1', name: 'Deck' }, { id: 'd2', name: 'Cap table' }],
    }));
    expect(step(steps, 'documents').docs?.[0]).toMatchObject({ documentId: 'd1', entryId: 'e3', accessible: true });
    expect(step(steps, 'messages').docs?.[0]).toMatchObject({ documentId: 'd2', entryId: 'e4' });
    expect(step(steps, 'first_contact').docs).toBeUndefined();
    expect(step(steps, 'interest').docs).toBeUndefined();
  });

  it('messages step counts the thread', () => {
    const steps = investorJourneySteps(base({
      messages: [{ createdAt: '2026-08-06T10:00:00Z' }, { createdAt: '2026-08-07T10:00:00Z' }],
    }));
    expect(step(steps, 'messages')).toMatchObject({ state: 'done', count: 2, at: '2026-08-06T10:00:00Z' });
  });
});
