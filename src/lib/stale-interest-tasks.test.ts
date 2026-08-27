import { describe, expect, it } from 'vitest';
import { staleInterestTasks, type InterestRequestForReconciliation, type StaleTaskCandidate } from './stale-interest-tasks';

function makeTask(overrides: Partial<StaleTaskCandidate> & { id: string }): StaleTaskCandidate {
  return { entityId: 'ent-a', done: false, source: 'interest_level_request', ...overrides };
}

function makeRequest(overrides: Partial<InterestRequestForReconciliation> & { id: string }): InterestRequestForReconciliation {
  return { entityId: 'ent-a', status: 'pending', ...overrides };
}

describe('staleInterestTasks', () => {
  it('closes a task whose request was decided (granted)', () => {
    const task = makeTask({ id: 't-1' });
    const request = makeRequest({ id: 'r-1', status: 'granted' });

    expect(staleInterestTasks([task], [request])).toEqual([{ taskId: 't-1', requestId: 'r-1' }]);
  });

  it('closes a task whose request was decided (denied)', () => {
    const task = makeTask({ id: 't-1' });
    const request = makeRequest({ id: 'r-1', status: 'denied' });

    expect(staleInterestTasks([task], [request])).toEqual([{ taskId: 't-1', requestId: 'r-1' }]);
  });

  it('does not close a task whose request is still pending', () => {
    const task = makeTask({ id: 't-1' });
    const request = makeRequest({ id: 'r-1', status: 'pending' });

    expect(staleInterestTasks([task], [request])).toEqual([]);
  });

  it('does not close a task whose entity has a decided AND a pending request — any pending blocks', () => {
    const task = makeTask({ id: 't-1' });
    const decided = makeRequest({ id: 'r-old', status: 'denied' });
    const pending = makeRequest({ id: 'r-new', status: 'pending' });

    expect(staleInterestTasks([task], [decided, pending])).toEqual([]);
  });

  it('does not close a task whose entity has no known request at all', () => {
    const task = makeTask({ id: 't-1', entityId: 'ent-unknown' });
    const request = makeRequest({ id: 'r-1', entityId: 'ent-a', status: 'granted' });

    expect(staleInterestTasks([task], [request])).toEqual([]);
  });

  it('leaves an already-closed task alone', () => {
    const task = makeTask({ id: 't-1', done: true });
    const request = makeRequest({ id: 'r-1', status: 'granted' });

    expect(staleInterestTasks([task], [request])).toEqual([]);
  });

  it('ignores a task with no entity_id — nothing to match against', () => {
    const task = makeTask({ id: 't-1', entityId: null });
    const request = makeRequest({ id: 'r-1', entityId: null, status: 'granted' });

    expect(staleInterestTasks([task], [request])).toEqual([]);
  });

  it('ignores a task whose source is not interest_level_request', () => {
    const task = makeTask({ id: 't-1', source: 'suggested' });
    const request = makeRequest({ id: 'r-1', status: 'granted' });

    expect(staleInterestTasks([task], [request])).toEqual([]);
  });

  it('handles multiple entities independently in one pass', () => {
    const staleTask = makeTask({ id: 't-stale', entityId: 'ent-a' });
    const pendingTask = makeTask({ id: 't-pending', entityId: 'ent-b' });
    const untouchedTask = makeTask({ id: 't-none', entityId: 'ent-c' });
    const requests = [
      makeRequest({ id: 'r-a', entityId: 'ent-a', status: 'granted' }),
      makeRequest({ id: 'r-b', entityId: 'ent-b', status: 'pending' }),
    ];

    expect(staleInterestTasks([staleTask, pendingTask, untouchedTask], requests))
      .toEqual([{ taskId: 't-stale', requestId: 'r-a' }]);
  });
});
