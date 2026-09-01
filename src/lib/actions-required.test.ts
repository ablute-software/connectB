// Prompt 216 §C — a montagem pura do "Actions required" do founder: uma
// fonte para o badge e para a lista, para nunca discordarem.
import { describe, expect, it } from 'vitest';
import { founderActionsRequired, investorActionsRequired, overdueRevisitTasks, type FounderActionsInput, type InvestorActionsInput, documentRequestTaskHref } from './actions-required';
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
      task({ id: 'a', title: 'Revisit Adara — frozen on 2026-07-01', due_at: '2026-08-01T00:00:00Z' }),
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
    // Prompt 518 §1 — was '/documents' (the whole Vault page, where the
    // request was unreachable); now the per-request review screen.
    expect(items.find((i) => i.kind === 'access_request')?.href).toBe('/documents/requests/ar1');
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

describe('investorActionsRequired', () => {
  function invBase(over: Partial<InvestorActionsInput> = {}): InvestorActionsInput {
    return { unreadThreads: [], ndaPending: [], respondedAccessRequests: [], newDocs: [], pendingDecisions: [], ...over };
  }

  it('empty inputs -> zero items, zero count', () => {
    expect(investorActionsRequired(invBase())).toEqual({ items: [], count: 0 });
  });

  it('every item carries an href into the acting startup page (rule 1)', () => {
    const { items, count } = investorActionsRequired(invBase({
      unreadThreads: [{ orgId: 'o1', orgName: 'ablute_', lastMessageAt: '2026-08-15T10:00:00Z' }],
      ndaPending: [{ orgId: 'o1', orgName: 'ablute_', count: 2 }],
      respondedAccessRequests: [{ id: 'ar1', orgId: 'o1', orgName: 'ablute_', status: 'granted', respondedAt: '2026-08-14T10:00:00Z' }],
      newDocs: [{ orgId: 'o1', orgName: 'ablute_', count: 3 }],
      pendingDecisions: [{ orgId: 'o2', orgName: 'OtherCo' }],
    }));
    expect(count).toBe(5);
    for (const item of items) expect(item.href).toMatch(/^\/portal\/startup\//);
    expect(items.find((i) => i.kind === 'unread_message')?.href).toBe('/portal/startup/o1?tab=messages');
    expect(items.find((i) => i.kind === 'nda_pending')?.href).toBe('/portal/startup/o1?tab=documents');
    expect(items.find((i) => i.kind === 'pending_decision')?.href).toBe('/portal/startup/o2');
  });

  it('zero-count NDA/doc groups are dropped, not rendered as empty noise', () => {
    const { count } = investorActionsRequired(invBase({
      ndaPending: [{ orgId: 'o1', orgName: 'ablute_', count: 0 }],
      newDocs: [{ orgId: 'o1', orgName: 'ablute_', count: 0 }],
    }));
    expect(count).toBe(0);
  });
});

// Prompt 518 §1 — the task Nuno clicked that "just opened the normal Vault".
describe('documentRequestTaskHref', () => {
  const REQ = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  it('links a document_request task straight to its request', () => {
    expect(documentRequestTaskHref({ source: 'document_request', notes: `priority:2|request:${REQ}` }))
      .toBe(`/documents/requests/${REQ}`);
  });

  it('handles the id being the only thing in notes', () => {
    expect(documentRequestTaskHref({ source: 'document_request', notes: `request:${REQ}` }))
      .toBe(`/documents/requests/${REQ}`);
  });

  // Falling back to null is what keeps the caller's existing entity link
  // working — a malformed note must not produce /documents/requests/null.
  it('returns null when the note carries no usable id', () => {
    expect(documentRequestTaskHref({ source: 'document_request', notes: 'priority:2' })).toBeNull();
    expect(documentRequestTaskHref({ source: 'document_request', notes: null })).toBeNull();
    expect(documentRequestTaskHref({ source: 'document_request', notes: 'request:not-a-uuid' })).toBeNull();
  });

  it('ignores tasks from any other source', () => {
    expect(documentRequestTaskHref({ source: 'interest_level_request', notes: `request:${REQ}` })).toBeNull();
    expect(documentRequestTaskHref({ source: undefined, notes: `request:${REQ}` })).toBeNull();
  });
});
