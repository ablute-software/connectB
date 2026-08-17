// Prompt 216 §C — a montagem pura do "Actions required" do founder: uma
// fonte para o badge e para a lista, para nunca discordarem.
import { describe, expect, it } from 'vitest';
import { founderActionsRequired, overdueRevisitTasks, type FounderActionsInput } from './actions-required';
import type { TaskItem } from './types';

const NOW = new Date('2026-08-17T12:00:00Z');

function task(over: Partial<TaskItem>): TaskItem {
  return { id: 't1', title: 'x', kind: 'follow_up', action_type: 'follow_up_thread' as TaskItem['action_type'], done: false, ...over };
}

function base(over: Partial<FounderActionsInput> = {}): FounderActionsInput {
  return { pendingInterest: [], unreadThreads: [], pendingAccessRequests: [], unclassifiedReplies: [], tasks: [], now: NOW, ...over };
}

describe('overdueRevisitTasks', () => {
  it('only overdue, undone, Revisit-titled tasks qualify', () => {
    const tasks = [
      task({ id: 'a', title: 'Revisit Adara — parked on 2026-07-01', due_at: '2026-08-01T00:00:00Z' }),
      task({ id: 'b', title: 'Revisit Foo', due_at: '2026-09-01T00:00:00Z' }),          // futura
      task({ id: 'c', title: 'Follow up with Bar', due_at: '2026-08-01T00:00:00Z' }),   // não é revisit
      task({ id: 'd', title: 'Revisit Baz', due_at: '2026-08-01T00:00:00Z', done: true }),
    ];
    expect(overdueRevisitTasks(tasks, NOW).map((t) => t.id)).toEqual(['a']);
  });
});

describe('founderActionsRequired', () => {
  it('empty inputs -> zero items, zero count', () => {
    expect(founderActionsRequired(base())).toEqual({ items: [], count: 0 });
  });

  it('badge count IS the item count — same source, cannot disagree', () => {
    const { items, count } = founderActionsRequired(base({
      pendingInterest: [{ id: 'r1', investorName: 'Adara', requestedAt: '2026-08-16T17:02:00Z', entityId: 'e1' }],
      unreadThreads: [
        { threadId: 'th1', investorName: 'Faber', lastMessageAt: '2026-08-15T10:00:00Z', unread: true },
        { threadId: 'th2', investorName: 'Indico', lastMessageAt: '2026-08-14T10:00:00Z', unread: false },
      ],
      unclassifiedReplies: [{ id: 'i1', entityId: 'e2', entityName: 'Faber', excerpt: 'Thanks, we…', at: '2026-08-13T10:00:00Z' }],
    }));
    expect(count).toBe(items.length);
    expect(count).toBe(3); // thread lida NÃO conta
  });

  it('every non-interest item carries an href to the acting place (rule 1)', () => {
    const { items } = founderActionsRequired(base({
      unreadThreads: [{ threadId: 'th1', investorName: 'Faber', lastMessageAt: '2026-08-15T10:00:00Z', unread: true }],
      pendingAccessRequests: [{ id: 'ar1', requesterName: 'Nuno M', requestedAt: '2026-08-12T10:00:00Z' }],
      unclassifiedReplies: [{ id: 'i1', entityId: 'e2', entityName: null, excerpt: 'ok', at: '2026-08-13T10:00:00Z' }],
      tasks: [task({ id: 'a', title: 'Revisit Adara', due_at: '2026-08-01T00:00:00Z', entity_id: 'e9' })],
    }));
    for (const item of items) expect(item.href).toBeTruthy();
    expect(items.find((i) => i.kind === 'unread_message')?.href).toBe('/messages');
    expect(items.find((i) => i.kind === 'access_request')?.href).toBe('/documents');
    expect(items.find((i) => i.kind === 'unclassified_reply')?.href).toBe('/entities/e2');
    expect(items.find((i) => i.kind === 'overdue_revisit')?.href).toBe('/entities/e9');
  });

  it('interest requests act inline: requestId present, entity link for context', () => {
    const { items } = founderActionsRequired(base({
      pendingInterest: [{ id: 'r1', investorName: 'Adara', requestedAt: '2026-08-16T17:02:00Z', entityId: 'e1' }],
    }));
    expect(items[0]).toMatchObject({ kind: 'interest_request', requestId: 'r1', entityHref: '/entities/e1' });
    expect(items[0].href).toBeUndefined();
  });

  it('interest requests come first — the case that motivated the prompt', () => {
    const { items } = founderActionsRequired(base({
      unreadThreads: [{ threadId: 'th1', investorName: 'Faber', lastMessageAt: '2026-08-15T10:00:00Z', unread: true }],
      pendingInterest: [{ id: 'r1', investorName: 'Adara', requestedAt: '2026-08-16T17:02:00Z', entityId: null }],
    }));
    expect(items[0].kind).toBe('interest_request');
  });
});
