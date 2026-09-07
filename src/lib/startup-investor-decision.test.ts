import { describe, expect, it } from 'vitest';
import {
  DECISION_NOTE_MAX, isLiveDecision, liveDecisionByEntity, noteProblem, noteProblemMessage,
  passedDirectionLabel, passedDirections, type StartupInvestorDecision,
} from './startup-investor-decision';
import { passReasonAlert } from './rules';
import type { Db, Interaction } from './types';

function decision(over: Partial<StartupInvestorDecision> = {}): StartupInvestorDecision {
  return {
    id: 'd-1', org_id: 'org-1', entity_id: 'ent-1', decision: 'not_a_fit',
    note: 'We met them in 2024 and they were not aligned.',
    decided_by: 'user-1', decided_at: '2026-09-07T10:00:00Z', updated_at: '2026-09-07T10:00:00Z',
    ...over,
  };
}

describe('the 220-character note cap', () => {
  it('is 220, the same number the Postgres CHECK enforces', () => {
    expect(DECISION_NOTE_MAX).toBe(220);
  });

  it('accepts a note of exactly the cap and rejects one character more', () => {
    expect(noteProblem('x'.repeat(220))).toBeNull();
    expect(noteProblem('x'.repeat(221))).toBe('too_long');
  });

  it('rejects an empty or whitespace-only note — a decision with no reason is not a record', () => {
    expect(noteProblem('')).toBe('empty');
    expect(noteProblem('   ')).toBe('empty');
    expect(noteProblem(undefined)).toBe('empty');
    expect(noteProblem(null)).toBe('empty');
  });

  it('measures the TRIMMED note, so trailing spaces never push a valid note over', () => {
    expect(noteProblem(`${'x'.repeat(220)}    `)).toBeNull();
  });

  it('has a message for each problem and none for a valid note', () => {
    expect(noteProblemMessage('empty')).toContain('Write a note');
    expect(noteProblemMessage('too_long')).toContain('220');
    expect(noteProblemMessage(null)).toBeNull();
  });
});

describe('one live decision per (org, entity); reverting frees it', () => {
  it('treats a decision with no reverted_at as live', () => {
    expect(isLiveDecision(decision())).toBe(true);
    expect(isLiveDecision(decision({ reverted_at: '2026-09-08T10:00:00Z' }))).toBe(false);
  });

  it('indexes only live decisions by entity', () => {
    const live = liveDecisionByEntity([
      decision({ id: 'd-old', entity_id: 'ent-1', reverted_at: '2026-09-08T10:00:00Z' }),
      decision({ id: 'd-new', entity_id: 'ent-1' }),
      decision({ id: 'd-2', entity_id: 'ent-2', reverted_at: '2026-09-08T10:00:00Z' }),
    ]);
    expect(live.get('ent-1')?.id).toBe('d-new');
    // Reverted and never replaced — the entity is back in the active list.
    expect(live.has('ent-2')).toBe(false);
  });

  it('a reverted decision leaves the slot free for a new one', () => {
    const reverted = [decision({ id: 'd-old', reverted_at: '2026-09-08T10:00:00Z' })];
    expect(liveDecisionByEntity(reverted).size).toBe(0);
    expect(liveDecisionByEntity([...reverted, decision({ id: 'd-new' })]).get('ent-1')?.id).toBe('d-new');
  });
});

describe('the Passed view labels both directions, never one number', () => {
  it('labels an investor pass and a founder decision differently', () => {
    expect(passedDirectionLabel('they_passed')).toBe('They passed');
    expect(passedDirectionLabel('not_a_fit_for_us')).toBe('Not a fit for us');
  });

  it('sorts each entity into the direction its own record says', () => {
    const entities = [
      { id: 'ent-passed', status: 'passed' },
      { id: 'ent-ours', status: 'active' },
      { id: 'ent-live', status: 'active' },
    ];
    const map = passedDirections(entities, [decision({ entity_id: 'ent-ours' })]);
    expect(map.get('ent-passed')).toBe('they_passed');
    expect(map.get('ent-ours')).toBe('not_a_fit_for_us');
    expect(map.has('ent-live')).toBe(false);
  });

  it('shows the founder’s own decision when both are true — it is the one they can revert', () => {
    const map = passedDirections([{ id: 'ent-1', status: 'passed' }], [decision({ entity_id: 'ent-1' })]);
    expect(map.get('ent-1')).toBe('not_a_fit_for_us');
  });

  it('ignores a reverted decision — the entity goes back to whatever its status says', () => {
    const reverted = [decision({ entity_id: 'ent-1', reverted_at: '2026-09-08T10:00:00Z' })];
    expect(passedDirections([{ id: 'ent-1', status: 'passed' }], reverted).get('ent-1')).toBe('they_passed');
    expect(passedDirections([{ id: 'ent-1', status: 'active' }], reverted).has('ent-1')).toBe(false);
  });
});

// The rule this whole prompt rests on, stated as a test: passReasonAlert
// exists to tell the founder that their PITCH may be the problem. A founder's
// own "not a fit for us" is not evidence about the pitch, and must never
// count toward it. Structural rather than filtered — a decision is not an
// interaction — so this pins that the structure holds.
describe('passReasonAlert is untouched by §A decisions', () => {
  function pass(id: string, category: string): Interaction {
    return {
      id: `i-${id}`, entity_id: `ent-${id}`, occurred_at: '2026-09-01T10:00:00Z', direction: 'in',
      channel: 'email', content: 'no thanks', classification: 'pass',
      pass_reason_category: category as Interaction['pass_reason_category'],
    } as Interaction;
  }

  // passReasonAlert reads db.interactions and nothing else. Handing it a db
  // whose startupInvestorDecisions is FULL and whose interactions are empty
  // is the whole assertion: a founder's own "no" cannot reach the alert,
  // because a decision is not an interaction. Structural, not filtered.
  function dbWith(interactions: Interaction[], decisions: StartupInvestorDecision[]) {
    return { interactions, startupInvestorDecisions: decisions } as unknown as Db;
  }

  const threeOfOurs = ['1', '2', '3'].map((n) =>
    decision({ id: `d-${n}`, entity_id: `ent-${n}`, reason_category: 'traction' }));

  it('fires on three real investor passes in one category', () => {
    expect(passReasonAlert(dbWith([pass('a', 'traction'), pass('b', 'traction'), pass('c', 'traction')], []))).not.toBeNull();
  });

  it('does not fire when the only "no"s are the founder’s own decisions', () => {
    expect(threeOfOurs).toHaveLength(3);
    expect(passReasonAlert(dbWith([], threeOfOurs))).toBeNull();
  });

  it('counts only the investor passes when both kinds exist', () => {
    // Two real passes plus three founder decisions must not reach the 3+
    // threshold: only the two passes are evidence about the pitch.
    expect(passReasonAlert(dbWith([pass('a', 'traction'), pass('b', 'traction')], threeOfOurs))).toBeNull();
    // And the third real pass is what tips it — the decisions never did.
    expect(passReasonAlert(dbWith([pass('a', 'traction'), pass('b', 'traction'), pass('c', 'traction')], threeOfOurs))).not.toBeNull();
  });
});
