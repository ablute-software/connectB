import { describe, expect, it } from 'vitest';
import { effectiveGrantForDoc, isDocLocked, isDocNew, groupByFolder, type DataRoomGrantLike } from './data-room-investor-view';

function grant(overrides: Partial<DataRoomGrantLike> = {}): DataRoomGrantLike {
  return { nda_required: false, granted_at: '2026-08-01T00:00:00Z', ...overrides };
}

describe('effectiveGrantForDoc — document-level grant overrides its folder\'s', () => {
  it('picks the document-level grant when both exist', () => {
    const doc = { id: 'doc-1', folder_id: 'folder-1' };
    const grants = [grant({ folder_id: 'folder-1', granted_at: '2026-08-01T00:00:00Z' }), grant({ document_id: 'doc-1', granted_at: '2026-08-05T00:00:00Z' })];
    expect(effectiveGrantForDoc(doc, grants)?.granted_at).toBe('2026-08-05T00:00:00Z');
  });

  it('falls back to the folder grant when there is no document-level one', () => {
    const doc = { id: 'doc-1', folder_id: 'folder-1' };
    const grants = [grant({ folder_id: 'folder-1', granted_at: '2026-08-01T00:00:00Z' })];
    expect(effectiveGrantForDoc(doc, grants)?.granted_at).toBe('2026-08-01T00:00:00Z');
  });

  it('returns undefined when nothing covers the document', () => {
    const doc = { id: 'doc-1', folder_id: 'folder-1' };
    expect(effectiveGrantForDoc(doc, [grant({ folder_id: 'other-folder' })])).toBeUndefined();
  });
});

describe('isDocLocked — NDA pending, never a client-clickable accept', () => {
  it('locked when nda_required and not yet accepted', () => {
    expect(isDocLocked(grant({ nda_required: true, nda_accepted_at: null }))).toBe(true);
  });

  it('unlocked once nda_accepted_at is set', () => {
    expect(isDocLocked(grant({ nda_required: true, nda_accepted_at: '2026-08-02T00:00:00Z' }))).toBe(false);
  });

  it('unlocked when nda_required is false regardless of nda_accepted_at', () => {
    expect(isDocLocked(grant({ nda_required: false }))).toBe(false);
  });

  it('undefined grant (nothing covers the doc) is never locked — it is simply not shown at all by the caller', () => {
    expect(isDocLocked(undefined)).toBe(false);
  });
});

describe('isDocNew — Prompt 338, "new since your last visit"', () => {
  it('never marks anything new when there is no prior visit (first-ever load)', () => {
    expect(isDocNew('2026-08-20T00:00:00Z', null)).toBe(false);
  });

  it('marks new when granted after the last visit', () => {
    expect(isDocNew('2026-08-20T00:00:00Z', '2026-08-15T00:00:00Z')).toBe(true);
  });

  it('does not mark new when granted before the last visit', () => {
    expect(isDocNew('2026-08-10T00:00:00Z', '2026-08-15T00:00:00Z')).toBe(false);
  });

  it('does not mark new when granted at exactly the last-seen timestamp (boundary is exclusive)', () => {
    expect(isDocNew('2026-08-15T00:00:00Z', '2026-08-15T00:00:00Z')).toBe(false);
  });
});

describe('groupByFolder', () => {
  it('groups documents by their folder name, preserving relative order within a folder', () => {
    const docs = [
      { id: 'a', folderName: 'Financials' }, { id: 'b', folderName: 'Legal' }, { id: 'c', folderName: 'Financials' },
    ];
    const grouped = groupByFolder(docs);
    expect([...grouped.keys()]).toEqual(['Financials', 'Legal']);
    expect(grouped.get('Financials')?.map((d) => d.id)).toEqual(['a', 'c']);
    expect(grouped.get('Legal')?.map((d) => d.id)).toEqual(['b']);
  });

  it('an empty list groups to an empty map', () => {
    expect(groupByFolder([]).size).toBe(0);
  });
});
