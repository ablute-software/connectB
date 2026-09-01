// Prompt 518 — the three places a pending access request has to be reachable
// from. Each of these was, before this prompt, pointing somewhere that did
// not answer the request: the task at the generic entity dossier, the
// Actions-required item at the bare Vault, and "Pending requests" at a Grant
// button that 409'd invisibly. They are tested together because the whole
// failure was that they disagreed.
import { describe, it, expect } from 'vitest';
import {
  documentRequestHref, requestIdFromTaskNotes, taskDocumentRequestHref,
} from './document-request-logic';
import { founderActionsRequired } from './actions-required';

const REQ = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('requestIdFromTaskNotes', () => {
  it('reads the id out of the notes shape the creating route actually writes', () => {
    expect(requestIdFromTaskNotes(`priority:document_request_other|request:${REQ}`)).toBe(REQ);
    expect(requestIdFromTaskNotes(`priority:document_request_diligence|request:${REQ}|item_type:cap_table`)).toBe(REQ);
  });

  it('returns null rather than a broken link when there is nothing to read', () => {
    // notes is free text a human can edit — every one of these has to fall
    // back to the old behaviour, never produce /documents/requests/undefined.
    for (const n of [null, undefined, '', 'priority:x', 'request:not-a-uuid', 'requested:something']) {
      expect(requestIdFromTaskNotes(n), String(n)).toBeNull();
    }
  });

  it('does not match a partial id', () => {
    expect(requestIdFromTaskNotes('request:3f2504e0-4f89')).toBeNull();
  });
});

describe('taskDocumentRequestHref', () => {
  it('links a document_request task straight to its own request', () => {
    expect(taskDocumentRequestHref({ source: 'document_request', notes: `priority:a|request:${REQ}` }))
      .toBe(`/documents/requests/${REQ}`);
  });

  it('leaves every other task alone', () => {
    // The regression this guards: a blanket link would send follow-ups and
    // interest requests to a request screen that has nothing to do with them.
    expect(taskDocumentRequestHref({ source: 'follow_up', notes: `request:${REQ}` })).toBeNull();
    expect(taskDocumentRequestHref({ source: 'interest_level_request', notes: null })).toBeNull();
    expect(taskDocumentRequestHref({ source: null, notes: null })).toBeNull();
  });

  it('returns null for a document_request task whose id was lost', () => {
    expect(taskDocumentRequestHref({ source: 'document_request', notes: 'priority:a' })).toBeNull();
  });
});

describe('founderActionsRequired — access requests', () => {
  const base = {
    pendingInterest: [], unreadThreads: [], unclassifiedReplies: [], tasks: [], now: new Date('2026-09-01T10:00:00Z'),
  };

  it('points an access request at its own review screen, never the bare Vault', () => {
    const { items } = founderActionsRequired({
      ...base,
      pendingAccessRequests: [{ id: REQ, requesterName: 'Nuno M', requestedAt: '2026-08-30T10:00:00Z' }],
    });
    const item = items.find((i) => i.kind === 'access_request');
    expect(item?.href).toBe(`/documents/requests/${REQ}`);
    // The old value, explicitly asserted against: '/documents' dropped the
    // founder on the Vault with no idea which request they were answering.
    expect(item?.href).not.toBe('/documents');
  });

  it('still names who is waiting', () => {
    const { items } = founderActionsRequired({
      ...base, pendingAccessRequests: [{ id: REQ, requesterName: 'Nuno M', requestedAt: '2026-08-30T10:00:00Z' }],
    });
    expect(items.find((i) => i.kind === 'access_request')?.label).toContain('Nuno M');
  });

  it('accepts an explicit href when a caller has one', () => {
    const { items } = founderActionsRequired({
      ...base,
      pendingAccessRequests: [{ id: REQ, requesterName: null, requestedAt: '2026-08-30T10:00:00Z', href: '/custom' }],
    });
    expect(items.find((i) => i.kind === 'access_request')?.href).toBe('/custom');
  });
});

describe('documentRequestHref', () => {
  it('is the single definition the other three call sites share', () => {
    expect(documentRequestHref(REQ)).toBe(`/documents/requests/${REQ}`);
  });
});
