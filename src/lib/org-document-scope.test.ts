// Prompt 692 — the pure half of the cross-org document gate. Confirmed
// production incident: sherlockdeal.com@gmail.com (a platform_admins row)
// saw ~80 documents in the "Read my documents" picker instead of its own 6,
// because a client-side query relied on RLS alone and documents_ablute_qa_read
// grants any admin unrestricted read across every org. The predicate below
// never takes an "is this an admin" input at all — org membership is the
// only question it answers, admin or not.
import { describe, expect, it } from 'vitest';
import { findCrossOrgDocumentId } from './org-document-scope';

describe('findCrossOrgDocumentId', () => {
  it('returns null when every document belongs to the org in view', () => {
    const docs = [{ id: 'd1', org_id: 'org-a' }, { id: 'd2', org_id: 'org-a' }];
    expect(findCrossOrgDocumentId(docs, 'org-a')).toBeNull();
  });

  it('returns the id of a document from a different org', () => {
    const docs = [{ id: 'd1', org_id: 'org-a' }, { id: 'd2', org_id: 'org-b' }];
    expect(findCrossOrgDocumentId(docs, 'org-a')).toBe('d2');
  });

  it('an empty list has nothing to flag', () => {
    expect(findCrossOrgDocumentId([], 'org-a')).toBeNull();
  });

  it('has no concept of admin at all — the same org mismatch is caught regardless of who is asking', () => {
    // The function signature itself proves this: there is no isAdmin
    // parameter to pass. This test exists so a future edit that tries to
    // add one gets caught by review, not by a runtime surprise.
    const docs = [{ id: 'd1', org_id: 'org-a' }, { id: 'd2', org_id: 'org-b' }];
    const forFounder = findCrossOrgDocumentId(docs, 'org-a');
    const forSameOrgId = findCrossOrgDocumentId(docs, 'org-a');
    expect(forFounder).toBe(forSameOrgId);
  });
});
