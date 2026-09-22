import { describe, expect, it } from 'vitest';
import { dropAllowedForStatus, dropDialog, dropTargetAccepts, planDrop, planUndo, revisitDaysFor, UNDO_WINDOW_MS } from './pipeline-drop';
import { REVISIT_DAYS_DEFAULT } from './exit-effects';
import type { Entity, TaskItem } from './types';

// Prompt 647 — the decision behind the drag: what the dialog says, what a
// confirmed drop commits, what Undo restores. The component only draws.
//
// Prompt 704 (18/09/2026) — Phase 4: all five real buckets accept a drop now
// (not just Frozen/Passed), and every one of them requires a reason.

const ENTITY = { id: 'e1', name: 'Indico Capital', status: 'contacted' } as Entity;
const NOW = new Date('2026-09-10T10:00:00.000Z');

function task(over: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 't1', title: 'Follow up', entity_id: 'e1', kind: 'follow_up',
    action_type: 'other', done: false, due_at: '2026-09-01T00:00:00.000Z', ...over,
  } as TaskItem;
}

describe('dropTargetAccepts — Phase 4: the five real buckets, never the Active roll-up', () => {
  it('every real bucket takes a row', () => {
    expect(dropTargetAccepts('not_contacted')).toBe(true);
    expect(dropTargetAccepts('contacted')).toBe(true);
    expect(dropTargetAccepts('diligence')).toBe(true);
    expect(dropTargetAccepts('frozen')).toBe(true);
    expect(dropTargetAccepts('passed')).toBe(true);
  });
  it('Active never does — it is a roll-up (total − passed), not a bucket with a status of its own', () => {
    expect(dropTargetAccepts('active')).toBe(false);
  });
  it('Stale and Reported never did and still do not', () => {
    expect(dropTargetAccepts('stale')).toBe(false);
    expect(dropTargetAccepts('reported')).toBe(false);
    expect(dropTargetAccepts(null)).toBe(false);
  });
});

describe('dropAllowedForStatus — Prompt 712: an invested row cannot be demoted to Contacted by a drag', () => {
  it('refuses invested -> contacted', () => {
    expect(dropAllowedForStatus('invested', 'contacted')).toBe(false);
  });
  it('still allows in_conversation -> contacted — a legitimate correction', () => {
    expect(dropAllowedForStatus('in_conversation', 'contacted')).toBe(true);
  });
  it('invested is never blocked from any OTHER target — only contacted is guarded', () => {
    expect(dropAllowedForStatus('invested', 'diligence')).toBe(true);
    expect(dropAllowedForStatus('invested', 'frozen')).toBe(true);
    expect(dropAllowedForStatus('invested', 'passed')).toBe(true);
    expect(dropAllowedForStatus('invested', 'not_contacted')).toBe(true);
  });
  it('every other status is unaffected for every target', () => {
    for (const status of ['not_contacted', 'contacted', 'in_conversation', 'diligence', 'passed', 'dormant'] as const) {
      for (const target of ['not_contacted', 'contacted', 'diligence', 'frozen', 'passed'] as const) {
        expect(dropAllowedForStatus(status, target)).toBe(true);
      }
    }
  });
});

describe('dropDialog — §2, the dialog tells the truth, and Prompt 704: reason is required everywhere', () => {
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

  // Prompt 671 — the confirmation must say the transition itself, in the
  // exact friendly names the six funnel cards use, never the raw enum value.
  it('Frozen: the first line states the transition in friendly names', () => {
    const d = dropDialog('frozen', ENTITY, [], NOW);
    expect(d.message.split('\n')[0]).toBe('Contacted → Frozen.');
  });

  it('Frozen: the date field defaults to +30 days and cannot be set to today; a required reason field sits alongside it', () => {
    const d = dropDialog('frozen', ENTITY, [], NOW);
    expect(d.fields).toEqual([
      expect.objectContaining({ key: 'revisit_date', type: 'date', defaultValue: '2026-10-10', min: '2026-09-11' }),
      expect.objectContaining({ key: 'reason', type: 'text', required: true }),
    ]);
    expect(d.message).toContain('No open tasks to move.');
  });

  it('Passed: counts the tasks planPass will close; the reason is now required', () => {
    const d = dropDialog('passed', ENTITY, [task({ id: 'a' }), task({ id: 'b', done: true })], NOW);
    expect(d.title).toBe('Mark Indico Capital as passed?');
    expect(d.message).toBe('Contacted → Passed.\nCloses this relationship. 1 open task will be closed.');
    expect(d.confirmLabel).toBe('Pass');
    expect(d.destructive).toBe(true);
    expect(d.fields).toEqual([expect.objectContaining({ key: 'reason', type: 'text', required: true })]);
  });

  it('names the true current stage, not always "Contacted" — a dormant row shows Frozen as its own current stage', () => {
    const d = dropDialog('passed', { ...ENTITY, status: 'dormant' }, [], NOW);
    expect(d.message.split('\n')[0]).toBe('Frozen → Passed.');
  });

  it('never counts another entity’s tasks', () => {
    const d = dropDialog('passed', ENTITY, [task({ id: 'x', entity_id: 'someone-else' })], NOW);
    expect(d.message).toContain('No open tasks to close.');
  });

  it('Not contacted / Contacted / Due diligence: a required-reason dialog, no task counting (nothing here is an exit)', () => {
    for (const target of ['not_contacted', 'contacted', 'diligence'] as const) {
      const d = dropDialog(target, ENTITY, [task()], NOW);
      expect(d.destructive).toBe(false);
      expect(d.fields).toEqual([expect.objectContaining({ key: 'reason', type: 'text', required: true })]);
      expect(d.message).toContain(`Contacted → `);
    }
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
  it('Frozen: dormant, the note leads with the transition and states the (now required) reason, planPark on the chosen date, a toast naming the date', () => {
    const c = planDrop('frozen', ENTITY, [task({ id: 'a' })], NOW, { revisit_date: '2026-09-24', reason: 'No reply in 3 weeks' });
    expect(c.status).toBe('dormant');
    expect(c.stage).toBeUndefined();
    expect(c.dormantReason).toBe('Frozen — dragged from the Pipeline');
    expect(c.note).toBe('Contacted → Frozen. Parked by choice — dragged onto Frozen in the Pipeline. Marked dormant on 2026-09-10. (No reply in 3 weeks)');
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
    expect(c.note).toBe('Contacted → Passed. Passed by choice — dragged onto Passed in the Pipeline (Not doing medtech this year). Marked passed on 2026-09-10.');
    expect(c.plan.dispositions.map((d) => d.action)).toEqual(['done', 'done']);
    expect(c.toast).toBe('✕ Indico Capital passed — reason recorded.');
  });

  it('Passed without a reason never claims one was recorded (a defensive default — the dialog itself now requires one)', () => {
    const c = planDrop('passed', ENTITY, [], NOW);
    expect(c.note).toBe('Contacted → Passed. Passed by choice — dragged onto Passed in the Pipeline. Marked passed on 2026-09-10.');
    expect(c.toast).toBe('✕ Indico Capital passed.');
  });

  // Prompt 671 §2 — the founder-visible half of "who moved this, when": the
  // note names the actor when the caller supplies one (pipeline/page.tsx
  // resolves the current session's own email); silent (no dangling "by")
  // when it can't.
  it('names who dragged it when an actor label is supplied', () => {
    const c = planDrop('frozen', ENTITY, [], NOW, { reason: 'r' }, 'nuno@ablute.pt');
    expect(c.note).toBe('Contacted → Frozen — moved by nuno@ablute.pt. Parked by choice — dragged onto Frozen in the Pipeline. Marked dormant on 2026-09-10. (r)');
  });

  it('never invents an actor when none is supplied', () => {
    const c = planDrop('passed', ENTITY, [], NOW);
    expect(c.note).not.toContain('moved by');
  });

  describe('Not contacted / Contacted / Due diligence — pure requalifications, no stage change, no task disposition', () => {
    it('Not contacted: status only, an empty plan, the reason quoted in the note', () => {
      const c = planDrop('not_contacted', ENTITY, [task()], NOW, { reason: 'Re-approaching after a long gap' });
      expect(c.status).toBe('not_contacted');
      expect(c.stage).toBeUndefined();
      expect(c.dormantReason).toBeUndefined();
      expect(c.plan).toEqual({ dispositions: [], confirmation: '' });
      expect(c.note).toBe('Contacted → Not contacted. Moved to Not contacted — dragged in the Pipeline (Re-approaching after a long gap). Marked not contacted on 2026-09-10.');
      expect(c.toast).toBe('↺ Indico Capital marked Not contacted.');
    });

    it('Contacted: status only', () => {
      const c = planDrop('contacted', { ...ENTITY, status: 'not_contacted' }, [], NOW, { reason: 'Sent the first outreach' });
      expect(c.status).toBe('contacted');
      expect(c.note).toBe('Not contacted → Contacted. Moved to Contacted — dragged in the Pipeline (Sent the first outreach). Marked contacted on 2026-09-10.');
      expect(c.toast).toBe('💬 Indico Capital marked Contacted.');
    });

    it('Due diligence: status only', () => {
      const c = planDrop('diligence', ENTITY, [], NOW, { reason: 'They asked for the data room' });
      expect(c.status).toBe('diligence');
      expect(c.note).toBe('Contacted → Due diligence. Moved to Due diligence — dragged in the Pipeline (They asked for the data room). Marked due diligence on 2026-09-10.');
      expect(c.toast).toBe('📄 Indico Capital marked Due diligence.');
    });

    it('never touches tasks — planPark/planPass are for exits, and none of these three is one', () => {
      const c = planDrop('diligence', ENTITY, [task({ id: 'a' }), task({ id: 'b' })], NOW, { reason: 'x' });
      expect(c.plan.dispositions).toEqual([]);
    });
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

  it('Not contacted / Contacted / Due diligence: restores status only, worded as a plain revert (nothing was "parked" or "reopened")', () => {
    const u = planUndo('contacted', { status: 'not_contacted', stage: 'not_contacted' }, NOW);
    expect(u.status).toBe('not_contacted');
    expect(u.stage).toBeUndefined();
    expect(u.note).toBe('Undone — reverted moments later; status restored to not contacted on 2026-09-10.');
  });

  it('the Undo window is eight seconds', () => {
    expect(UNDO_WINDOW_MS).toBe(8000);
  });
});
