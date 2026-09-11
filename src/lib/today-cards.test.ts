// Prompt 884 — the Today redesign's four-card membership rules.
import { describe, expect, it } from 'vitest';
import {
  meetingTasks, overdueTasks, followUpTasks, otherTasks,
  missedMeetings, upcomingMeetingGroups, otherTaskPriority, meetingsCompletedThisWeek,
} from './today-cards';
import type { Entity, TaskItem } from './types';

const NOW = new Date('2026-08-11T09:00:00.000Z');

function task(over: Partial<TaskItem> & { id: string }): TaskItem {
  return { title: 'x', kind: 'admin', action_type: 'other', done: false, ...over };
}

describe('Today redesign — the four cards never double-count or drop a task', () => {
  const tasks: TaskItem[] = [
    task({ id: 'meeting-today', kind: 'meeting', due_at: '2026-08-11T14:00:00.000Z' }),
    task({ id: 'meeting-tomorrow', kind: 'meeting', due_at: '2026-08-12T10:00:00.000Z' }),
    task({ id: 'meeting-missed', kind: 'meeting', due_at: '2026-08-09T10:00:00.000Z' }),
    task({ id: 'meeting-far', kind: 'meeting', due_at: '2026-08-20T10:00:00.000Z' }), // outside the +2d window
    task({ id: 'overdue-admin', kind: 'admin', due_at: '2026-08-01T00:00:00.000Z' }),
    task({ id: 'overdue-research', kind: 'research', due_at: '2026-08-01T00:00:00.000Z' }), // excluded — its own tab
    task({ id: 'follow-up-future', kind: 'follow_up', action_type: 'follow_up_no_reply', due_at: '2026-08-15T00:00:00.000Z' }),
    task({ id: 'follow-up-overdue', kind: 'follow_up', action_type: 'follow_up_thread', due_at: '2026-08-01T00:00:00.000Z' }), // this one IS overdue
    task({ id: 'dormant', kind: 'admin', source: 'automation_dormant', due_at: '2026-08-01T00:00:00.000Z' }),
    task({ id: 'done', kind: 'admin', due_at: '2026-08-01T00:00:00.000Z', done: true }),
    task({ id: 'other-plain', kind: 'admin' }),
  ];

  it('Meetings: every not-done meeting with a due date, any distance out', () => {
    expect(meetingTasks(tasks).map((t) => t.id).sort()).toEqual(
      ['meeting-today', 'meeting-tomorrow', 'meeting-missed', 'meeting-far'].sort());
  });

  it('Overdue: excludes meetings and research, includes a past-due follow-up (it is NOT in Follow up)', () => {
    expect(overdueTasks(tasks, NOW).map((t) => t.id).sort()).toEqual(['overdue-admin', 'follow-up-overdue'].sort());
  });

  it('Follow up: only the two follow-up action_types, and only if NOT already overdue', () => {
    expect(followUpTasks(tasks, NOW).map((t) => t.id)).toEqual(['follow-up-future']);
  });

  it('a follow-up task whose due_at moves into the past leaves Follow up and appears in Overdue', () => {
    const pushedPast = tasks.map((t) => t.id === 'follow-up-future' ? { ...t, due_at: '2026-08-01T00:00:00.000Z' } : t);
    expect(followUpTasks(pushedPast, NOW).map((t) => t.id)).toEqual([]);
    expect(overdueTasks(pushedPast, NOW).map((t) => t.id).sort()).toEqual(['follow-up-future', 'follow-up-overdue', 'overdue-admin'].sort());
  });

  it('Other: whatever is left — never automation_dormant, never done, never a member of the other three', () => {
    expect(otherTasks(tasks, NOW).map((t) => t.id).sort()).toEqual(['overdue-research', 'other-plain'].sort());
  });

  it('every not-done, non-dormant task lands in EXACTLY one of the four cards', () => {
    const eligible = tasks.filter((t) => !t.done && t.source !== 'automation_dormant');
    const buckets = [meetingTasks(tasks), overdueTasks(tasks, NOW), followUpTasks(tasks, NOW), otherTasks(tasks, NOW)];
    for (const t of eligible) {
      const memberships = buckets.filter((b) => b.some((x) => x.id === t.id)).length;
      expect(memberships, `task ${t.id} should be in exactly one card, was in ${memberships}`).toBe(1);
    }
  });
});

describe('missedMeetings / upcomingMeetingGroups', () => {
  it('a past meeting is Missed, not silently dropped just because it left Overdue', () => {
    const tasks = [task({ id: 'm1', kind: 'meeting', due_at: '2026-08-09T10:00:00.000Z' })];
    expect(missedMeetings(tasks, NOW).map((t) => t.id)).toEqual(['m1']);
    expect(upcomingMeetingGroups(tasks, NOW)).toEqual([]);
  });

  it('groups today/tomorrow/+2d with the right labels, in date order', () => {
    const tasks = [
      task({ id: 'day2', kind: 'meeting', due_at: '2026-08-13T09:00:00.000Z' }),
      task({ id: 'today2', kind: 'meeting', due_at: '2026-08-11T15:00:00.000Z' }),
      task({ id: 'today1', kind: 'meeting', due_at: '2026-08-11T10:00:00.000Z' }),
      task({ id: 'tomorrow', kind: 'meeting', due_at: '2026-08-12T11:00:00.000Z' }),
    ];
    const groups = upcomingMeetingGroups(tasks, NOW);
    expect(groups.map((g) => g.label)).toEqual([
      'Today · Tuesday, Aug 11', 'Tomorrow · Wednesday, Aug 12', 'Thursday, Aug 13',
    ]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['today1', 'today2']); // time-ordered within the day
  });

  it('a meeting further than +2 days out is absent from the card entirely (not "Today" yet)', () => {
    const tasks = [task({ id: 'far', kind: 'meeting', due_at: '2026-08-20T10:00:00.000Z' })];
    expect(upcomingMeetingGroups(tasks, NOW)).toEqual([]);
  });
});

describe('otherTaskPriority — derived from the linked entity\'s real fit_score, never invented', () => {
  const entities: Pick<Entity, 'id' | 'fit_score'>[] = [
    { id: 'e-high', fit_score: 'high' }, { id: 'e-medhigh', fit_score: 'medium_high' },
    { id: 'e-med', fit_score: 'medium' }, { id: 'e-low', fit_score: 'low' }, { id: 'e-unscored' },
  ];

  it('maps high/medium_high to High, medium to Medium, low to Low', () => {
    expect(otherTaskPriority(task({ id: 't', entity_id: 'e-high' }), entities)).toBe('High');
    expect(otherTaskPriority(task({ id: 't', entity_id: 'e-medhigh' }), entities)).toBe('High');
    expect(otherTaskPriority(task({ id: 't', entity_id: 'e-med' }), entities)).toBe('Medium');
    expect(otherTaskPriority(task({ id: 't', entity_id: 'e-low' }), entities)).toBe('Low');
  });

  it('no pill (undefined) for a task with no entity, or an entity with no fit_score', () => {
    expect(otherTaskPriority(task({ id: 't' }), entities)).toBeUndefined();
    expect(otherTaskPriority(task({ id: 't', entity_id: 'e-unscored' }), entities)).toBeUndefined();
    expect(otherTaskPriority(task({ id: 't', entity_id: 'does-not-exist' }), entities)).toBeUndefined();
  });
});

describe('meetingsCompletedThisWeek', () => {
  it('numerator is done meeting tasks due this week; denominator is all meeting tasks due this week', () => {
    const tasks = [
      task({ id: 'done-this-week', kind: 'meeting', due_at: '2026-08-12T10:00:00.000Z', done: true }),
      task({ id: 'open-this-week', kind: 'meeting', due_at: '2026-08-13T10:00:00.000Z', done: false }),
      task({ id: 'next-week', kind: 'meeting', due_at: '2026-08-25T10:00:00.000Z', done: true }),
      task({ id: 'not-a-meeting', kind: 'follow_up', due_at: '2026-08-12T10:00:00.000Z', done: true }),
    ];
    expect(meetingsCompletedThisWeek(tasks, NOW)).toEqual({ done: 1, total: 2 });
  });
});
