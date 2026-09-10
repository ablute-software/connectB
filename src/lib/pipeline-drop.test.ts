import { describe, expect, it } from 'vitest';
import { dropDialog, dropTargetAccepts, planDrop, planUndo, revisitDaysFor, UNDO_WINDOW_MS } from './pipeline-drop';
import { REVISIT_DAYS_DEFAULT } from './exit-effects';
import type { Entity, TaskItem } from './types';

// Prompt 647 — the decision behind the drag: what the dialog says, what a
// confirmed drop commits, what Undo restores. The component only draws.

const ENTITY = { id: 'e1', name: 'Indico Capital' } as Entity;
const NOW = new Date('2026-09-10T10:00:00.000Z');

function task(over: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 't1', title: 'Follow up', entity_id: 'e1', kind: 'follow_up',
    action_type: 'other', done: false, due_at: '2026-09-01T00:00:00.000Z', ...over,
  } as TaskItem;
}

describe('dropTargetAccepts — §3, option (A)', () => {
  it('Frozen and Passed take a row; Stale and Reported never do', () => {
    expect(dropTargetAccepts('frozen')).toBe(true);
    expect(dropTargetAccepts('passed')).toBe(true);
    expect(dropTargetAccepts('stale')).toBe(false);
    expect(dropTargetAccepts('reported')).toBe(false);
    expect(dropTargetAccepts(null)).toBe(false);
  });
});

describe('dropDialog — §2, the dialog tells the truth', () => {
  it('Frozen: names the revisit task, counts re-dated and closed tasks from the plan itself', () => {
    const d = dropDialog('frozen', ENTITY, [
      task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c', action_type: 'follow_up_thread' }),
    ], NOW);
    expect(d.title).toBe('Freeze Indico Capital?');
    expect(d.message).toContain('Creates "Revisit Indico Capital"');
    expect(d.message).toContain('2 open tasks will be re-dated to that day.');
    expect(d.message).toContain('1 open task that asked for a reply will be closed');
    expect(d.confirmLabel).toBe('Freeze');
    expect(d.destructive).toBe(false);
  });

  it('Frozen: the date field defaults to +30 days and cannot be set to today', () => {
    const d = dropDialog('frozen', ENTITY, [], NOW);
    expect(d.fields).toEqual([expect.objectContaining({ key: 'revisit_date', type: 'date', defaultValue: '2026-10-10', min: '2026-09-11' })]);
    expect(d.message).toContain('No open tasks to move.');
  });

  it('Passed: counts the tasks planPass will close; the reason is optional', () => {
    const d = dropDialog('passed', ENTITY, [task({ id: 'a' }), task({ id: 'b', done: true })], NOW);
    expect(d.title).toBe('Mark Indico Capital as passed?');
    expect(d.message).toBe('Closes this relationship. 1 open task will be closed.');
    expect(d.confirmLabel).toBe('Pass');
    expect(d.destructive).toBe(true);
    expect(d.fields).toEqual([expect.objectContaining({ key: 'reason', type: 'text' })]);
  });

  it('never counts another entity’s tasks', () => {
    const d = dropDialog('passed', ENTITY, [task({ id: 'x', entity_id: 'someone-else' })], NOW);
    expect(d.message).toContain('No open tasks to close.');
  });
});

describe('revisitDaysFor', () => {
  it('turns the chosen day into the count planPark expects', () => {
    expect(revisitDaysFor(NOW, '2026-09-24')).toBe(14);
  });
  it('never parks until yesterday: a past or malformed date falls back', () => {
    expect(revisitDaysFor(NOW, '2026-09-01')).toBe(1);
    expect(revisitDaysFor(NOW, 'soon')).toBe(REVISIT_DAYS_DEFAULT);
    expect(revisitDaysFor(NOW, undefined)).toBe(REVISIT_DAYS_DEFAULT);
  });
});

describe('planDrop — what a confirmed drop commits', () => {
  it('Frozen: dormant, the 527 note, planPark on the chosen date, a toast naming the date', () => {
    const c = planDrop('frozen', ENTITY, [task({ id: 'a' })], NOW, { revisit_date: '2026-09-24' });
    expect(c.status).toBe('dormant');
    expect(c.stage).toBeUndefined();
    expect(c.dormantReason).toBe('Frozen — dragged from the Pipeline');
    expect(c.note).toBe('Parked by choice — dragged onto Frozen in the Pipeline. Marked dormant on 2026-09-10.');
    expect(c.plan.revisitTask?.title).toBe('Revisit Indico Capital — frozen on 2026-09-10');
    expect(c.plan.revisitTask?.dueAt.slice(0, 10)).toBe('2026-09-24');
    expect(c.plan.dispositions).toEqual([expect.objectContaining({ taskId: 'a', action: 'reschedule' })]);
    expect(c.toast).toBe('❄ Indico Capital parked — revisit on 2026-09-24.');
  });

  it('Passed with a reason: passed + decision stage, the reason in the note, every open task closed', () => {
    const c = planDrop('passed', ENTITY, [task({ id: 'a' }), task({ id: 'b', action_type: 'follow_up_thread' })], NOW, { reason: '  Not doing medtech this year ' });
    expect(c.status).toBe('passed');
    expect(c.stage).toBe('decision');
    expect(c.dormantReason).toBeUndefined();
    expect(c.note).toBe('Passed by choice — dragged onto Passed in the Pipeline (Not doing medtech this year). Marked passed on 2026-09-10.');
    expect(c.plan.dispositions.map((d) => d.action)).toEqual(['done', 'done']);
    expect(c.toast).toBe('✕ Indico Capital passed — reason recorded.');
  });

  it('Passed without a reason never claims one was recorded', () => {
    const c = planDrop('passed', ENTITY, [], NOW);
    expect(c.note).toBe('Passed by choice — dragged onto Passed in the Pipeline. Marked passed on 2026-09-10.');
    expect(c.toast).toBe('✕ Indico Capital passed.');
  });
});

describe('planUndo — §1.6', () => {
  it('Frozen: restores the status only (the store closes the revisit task on leaving dormant)', () => {
    const u = planUndo('frozen', { status: 'in_conversation', stage: 'engaged' }, NOW);
    expect(u.status).toBe('in_conversation');
    expect(u.stage).toBeUndefined();
    expect(u.note).toBe('Undone — un-parked moments later; status restored to in conversation on 2026-09-10.');
  });

  it('Passed: restores status AND the stage the pass moved', () => {
    const u = planUndo('passed', { status: 'contacted', stage: 'contacted' }, NOW);
    expect(u).toMatchObject({ status: 'contacted', stage: 'contacted' });
    expect(u.note).toContain('reopened');
  });

  it('the Undo window is eight seconds', () => {
    expect(UNDO_WINDOW_MS).toBe(8000);
  });
});
