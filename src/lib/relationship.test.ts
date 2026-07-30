import { describe, expect, it } from 'vitest';
import { suggestNextAction } from './relationship';

const OCCURRED = '2026-07-30T10:00:00.000Z';

describe('suggestNextAction', () => {
  it('suggests a 14-day wait-then-follow-up for an outbound web form submission', () => {
    const s = suggestNextAction('out', 'web_form', undefined, OCCURRED);
    expect(s).not.toBeNull();
    expect(s!.actionType).toBe('follow_up_no_reply');
    expect(s!.dueAt.slice(0, 10)).toBe('2026-08-13'); // +14 days
    expect(s!.title).toContain('follow up via the same form');
  });

  it('suggests a shorter window for a meeting, tagged follow_up_thread', () => {
    const s = suggestNextAction('out', 'meeting', undefined, OCCURRED);
    expect(s!.actionType).toBe('follow_up_thread');
    expect(s!.dueAt.slice(0, 10)).toBe('2026-08-01'); // +2 days
  });

  it('suggests scheduling a meeting for an inbound meeting_request', () => {
    const s = suggestNextAction('in', 'email', 'meeting_request', OCCURRED);
    expect(s!.title).toBe('Schedule the meeting');
    expect(s!.actionType).toBe('follow_up_thread');
  });

  it('returns null for an inbound pass — the relationship is closed, not awaiting a next step', () => {
    expect(suggestNextAction('in', 'email', 'pass', OCCURRED)).toBeNull();
  });

  it('returns null for an inbound classification with no rule (e.g. unclear)', () => {
    expect(suggestNextAction('in', 'email', 'unclear', OCCURRED)).toBeNull();
  });

  it('returns null for an outbound channel with no rule (e.g. stage_change)', () => {
    expect(suggestNextAction('out', 'stage_change', undefined, OCCURRED)).toBeNull();
  });
});
