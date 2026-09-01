import { describe, it, expect } from 'vitest';
import {
  NEGLECT_REASK_AFTER_DAYS, latestNeglectProposal, neglectAskState,
  neglectOutcomeOf, neglectReaskReason, type NeglectProposalRecord,
} from './neglect-history';

const NOW = new Date('2026-09-01T12:00:00Z');
const empty = { interactions: [], confirmedFacts: [], now: NOW };

function proposal(over: Partial<NeglectProposalRecord> = {}): NeglectProposalRecord {
  return {
    entity_id: 'e1', trigger_kind: 'neglect', reopens: false,
    rationale: 'Nothing real left to answer.', status: 'dismissed',
    created_at: '2026-08-31T00:33:00Z', ...over,
  };
}

describe('neglectOutcomeOf', () => {
  it('reads the three outcomes back from (reopens, advice), as stored', () => {
    expect(neglectOutcomeOf({ reopens: true })).toBe('reactivate');
    expect(neglectOutcomeOf({ reopens: false, advice: { acknowledge: '', respondTo: [], holdReason: 'Wait for revenue.' } })).toBe('hold_for_hook');
    expect(neglectOutcomeOf({ reopens: false })).toBe('not_worth_it');
  });
});

describe('latestNeglectProposal', () => {
  it('picks the most recent row for the entity and ignores other origins', () => {
    const rows = [
      proposal({ created_at: '2026-08-01T00:00:00Z', rationale: 'older' }),
      proposal({ created_at: '2026-08-20T00:00:00Z', rationale: 'newer' }),
      proposal({ entity_id: 'other', created_at: '2026-08-30T00:00:00Z', rationale: 'wrong entity' }),
      proposal({ trigger_kind: 'fact', created_at: '2026-08-31T00:00:00Z', rationale: 'wrong origin' }),
    ];
    expect(latestNeglectProposal(rows, 'e1')?.rationale).toBe('newer');
  });

  it('returns undefined when the entity was never evaluated', () => {
    expect(latestNeglectProposal([], 'e1')).toBeUndefined();
  });
});

describe('neglectReaskReason — the criterion that stops the re-billing loop', () => {
  it('refuses to re-ask a dismissed verdict when nothing has changed', () => {
    // The exact production case: three identical runs in three minutes,
    // because a dismissed verdict did not count as "already asked".
    expect(neglectReaskReason(proposal(), empty)).toBeNull();
  });

  it('re-asks when a new interaction was logged after the verdict', () => {
    expect(neglectReaskReason(proposal(), {
      ...empty, interactions: [{ occurred_at: '2018-04-01T00:00:00Z', created_at: '2026-08-31T09:00:00Z' }],
    })).toBe('new_interaction');
  });

  it('uses occurred_at when the row has no created_at', () => {
    expect(neglectReaskReason(proposal(), {
      ...empty, interactions: [{ occurred_at: '2026-08-31T09:00:00Z' }],
    })).toBe('new_interaction');
    expect(neglectReaskReason(proposal(), {
      ...empty, interactions: [{ occurred_at: '2018-04-01T00:00:00Z' }],
    })).toBeNull();
  });

  it('re-asks when a company fact was confirmed after the verdict — the thing a hold_for_hook waits for', () => {
    expect(neglectReaskReason(proposal(), {
      ...empty, confirmedFacts: [{ created_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-08-31T18:00:00Z' }],
    })).toBe('new_fact');
  });

  it('does not re-ask on a fact confirmed before the verdict', () => {
    expect(neglectReaskReason(proposal(), {
      ...empty, confirmedFacts: [{ created_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-06-01T00:00:00Z' }],
    })).toBeNull();
  });

  it(`re-asks once the verdict is ${NEGLECT_REASK_AFTER_DAYS} days old`, () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const justUnder = new Date(NOW.getTime() - (NEGLECT_REASK_AFTER_DAYS * dayMs) + 60_000).toISOString();
    const justOver = new Date(NOW.getTime() - (NEGLECT_REASK_AFTER_DAYS * dayMs) - 60_000).toISOString();
    expect(neglectReaskReason(proposal({ created_at: justUnder }), empty)).toBeNull();
    expect(neglectReaskReason(proposal({ created_at: justOver }), empty)).toBe('aged_out');
  });

  it('never re-asks a proposal still pending in the queue, however old', () => {
    expect(neglectReaskReason(proposal({ status: 'pending', reopens: true, created_at: '2020-01-01T00:00:00Z' }), empty)).toBeNull();
  });
});

describe('neglectAskState', () => {
  it('treats a never-evaluated entity as a plain first ask', () => {
    expect(neglectAskState([], 'e1', empty)).toEqual({ autoAskable: true, manualAskable: true, reaskReason: null });
  });

  it('blocks the bulk ask but offers the explicit one for a current dismissed verdict', () => {
    const s = neglectAskState([proposal()], 'e1', empty);
    expect(s.autoAskable).toBe(false);
    expect(s.manualAskable).toBe(true);
    expect(s.outcome).toBe('not_worth_it');
    expect(s.last?.rationale).toBe('Nothing real left to answer.');
  });

  it('blocks both asks while a reactivation is pending in the queue', () => {
    const s = neglectAskState([proposal({ status: 'pending', reopens: true })], 'e1', empty);
    expect(s.autoAskable).toBe(false);
    expect(s.manualAskable).toBe(false);
    expect(s.outcome).toBe('reactivate');
  });

  it('reopens the bulk ask once something has changed', () => {
    const s = neglectAskState([proposal()], 'e1', {
      ...empty, interactions: [{ occurred_at: '2026-08-31T23:00:00Z' }],
    });
    expect(s.autoAskable).toBe(true);
    expect(s.reaskReason).toBe('new_interaction');
    // Still shows the prior verdict — a re-ask never blanks the history.
    expect(s.outcome).toBe('not_worth_it');
  });
});
