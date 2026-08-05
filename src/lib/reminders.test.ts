// P126 §3 follow-up (verification doc, 2026-08-05) — dueReminders() shipped in
// Prompt 126 D without a dedicated unit test. Covers: past-due fires, future
// snooze suppresses, ordering is soonest-first.
import { describe, expect, it } from 'vitest';
import { dueReminders } from './reminders';
import type { TaskItem } from '@/lib/types';

const NOW = new Date('2026-08-05T12:00:00.000Z').getTime();

function task(overrides: Partial<TaskItem>): TaskItem {
  return {
    id: 'default-id',
    title: 'Default task',
    kind: 'follow_up',
    action_type: 'other',
    done: false,
    ...overrides,
  };
}

describe('dueReminders', () => {
  it('includes a task whose reminder_at is in the past', () => {
    const t = task({ id: 't1', reminder_at: new Date(NOW - 60_000).toISOString() });
    expect(dueReminders([t], NOW)).toEqual([t]);
  });

  it('includes a task whose reminder_at is exactly now', () => {
    const t = task({ id: 't1', reminder_at: new Date(NOW).toISOString() });
    expect(dueReminders([t], NOW)).toEqual([t]);
  });

  it('excludes a task with no reminder_at set', () => {
    const t = task({ id: 't1' });
    expect(dueReminders([t], NOW)).toEqual([]);
  });

  it('excludes a task whose reminder_at is in the future', () => {
    const t = task({ id: 't1', reminder_at: new Date(NOW + 60_000).toISOString() });
    expect(dueReminders([t], NOW)).toEqual([]);
  });

  it('excludes an already-done task even if reminder_at is due', () => {
    const t = task({ id: 't1', done: true, reminder_at: new Date(NOW - 60_000).toISOString() });
    expect(dueReminders([t], NOW)).toEqual([]);
  });

  it('suppresses a due reminder while snoozed_until is still in the future', () => {
    const t = task({
      id: 't1',
      reminder_at: new Date(NOW - 60_000).toISOString(),
      snoozed_until: new Date(NOW + 60_000).toISOString(),
    });
    expect(dueReminders([t], NOW)).toEqual([]);
  });

  it('fires again once snoozed_until has passed', () => {
    const t = task({
      id: 't1',
      reminder_at: new Date(NOW - 60_000).toISOString(),
      snoozed_until: new Date(NOW - 1_000).toISOString(),
    });
    expect(dueReminders([t], NOW)).toEqual([t]);
  });

  it('orders multiple due reminders soonest-first', () => {
    const later = task({ id: 'later', reminder_at: new Date(NOW - 1_000).toISOString() });
    const soonest = task({ id: 'soonest', reminder_at: new Date(NOW - 120_000).toISOString() });
    const middle = task({ id: 'middle', reminder_at: new Date(NOW - 60_000).toISOString() });
    expect(dueReminders([later, soonest, middle], NOW).map((t) => t.id)).toEqual(['soonest', 'middle', 'later']);
  });
});
