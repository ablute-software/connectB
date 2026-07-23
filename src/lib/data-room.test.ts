import { describe, expect, it } from 'vitest';
import {
  collectFolderSelectionKeys, cycleGrantState, diffGrantSelection, isEditableLink,
  normalizeDocumentUrl, resolveDocumentAccess, sanitizeStorageKey, unlockedGrants,
} from './data-room';

describe('sanitizeStorageKey', () => {
  it('folds diacritics, replaces spaces/parentheses, and keeps the extension', () => {
    expect(sanitizeStorageKey('Consulta de Certidão Permanente 07-2026 (1).pdf'))
      .toBe('Consulta-de-Certidao-Permanente-07-2026-1.pdf');
  });

  it('leaves an already-safe filename untouched', () => {
    expect(sanitizeStorageKey('deck-v3.pdf')).toBe('deck-v3.pdf');
  });

  it('handles a file with no extension', () => {
    expect(sanitizeStorageKey('README')).toBe('README');
  });

  it('never produces an empty base name', () => {
    expect(sanitizeStorageKey('日本語.pdf')).toBe('file.pdf');
  });

  it('strips illegal characters from the extension too', () => {
    expect(sanitizeStorageKey('weird.p?d#f')).toBe('weird.pdf');
  });
});

describe('normalizeDocumentUrl', () => {
  it('normalizes a Google Docs edit link to /preview', () => {
    expect(normalizeDocumentUrl('https://docs.google.com/document/d/1AbC23/edit?usp=sharing'))
      .toBe('https://docs.google.com/document/d/1AbC23/preview');
  });

  it('normalizes a Google Sheets edit link to /preview', () => {
    expect(normalizeDocumentUrl('https://docs.google.com/spreadsheets/d/1AbC23/edit#gid=0'))
      .toBe('https://docs.google.com/spreadsheets/d/1AbC23/preview');
  });

  it('normalizes a Google Slides edit link to /preview', () => {
    expect(normalizeDocumentUrl('https://docs.google.com/presentation/d/1AbC23/edit'))
      .toBe('https://docs.google.com/presentation/d/1AbC23/preview');
  });

  it('normalizes a Google Drive file edit link to /view', () => {
    expect(normalizeDocumentUrl('https://drive.google.com/file/d/1AbC23/edit?usp=sharing'))
      .toBe('https://drive.google.com/file/d/1AbC23/view');
  });

  it('leaves a non-Google /edit link untouched', () => {
    const url = 'https://www.notion.so/workspace/Some-Page-abc123/edit';
    expect(normalizeDocumentUrl(url)).toBe(url);
  });

  it('leaves an already view-only Google link untouched', () => {
    const url = 'https://docs.google.com/document/d/1AbC23/preview';
    expect(normalizeDocumentUrl(url)).toBe(url);
  });
});

describe('isEditableLink', () => {
  it('accepts a Google Docs edit link once normalized', () => {
    expect(isEditableLink('https://docs.google.com/document/d/1AbC23/edit?usp=sharing')).toBe(false);
  });

  it('still rejects a literal non-Google /edit link', () => {
    expect(isEditableLink('https://www.notion.so/workspace/Some-Page-abc123/edit')).toBe(true);
  });

  it('accepts an ordinary view-only link', () => {
    expect(isEditableLink('https://example.com/deck.pdf')).toBe(false);
  });
});

describe('unlockedGrants (F5 portal NDA gate)', () => {
  it('includes a grant that never required an NDA', () => {
    const grants = [{ document_id: 'd1', nda_required: false }];
    expect(unlockedGrants(grants)).toEqual(grants);
  });

  it('excludes an nda_required grant before the NDA is on file', () => {
    const grants = [{ document_id: 'd1', nda_required: true }];
    expect(unlockedGrants(grants)).toEqual([]);
  });

  it('includes an nda_required grant once accepted', () => {
    const grants = [{ document_id: 'd1', nda_required: true, nda_accepted_at: '2026-01-01T00:00:00Z' }];
    expect(unlockedGrants(grants)).toEqual(grants);
  });

  it('filters a mixed set to only the unlocked ones', () => {
    const grants = [
      { document_id: 'd1', nda_required: false },
      { document_id: 'd2', nda_required: true },
      { document_id: 'd3', nda_required: true, nda_accepted_at: '2026-01-01T00:00:00Z' },
    ];
    expect(unlockedGrants(grants).map((g) => g.document_id)).toEqual(['d1', 'd3']);
  });
});

describe('resolveDocumentAccess (F4 per-doc override vs its folder grant)', () => {
  it('a document with only a folder-level grant is visible when that grant is unlocked', () => {
    const grants = [{ folder_id: 'f1', nda_required: false }];
    const docs = [{ id: 'd1', folder_id: 'f1' }];
    expect(resolveDocumentAccess(grants, docs)).toEqual({ visibleIds: ['d1'], pendingCount: 0 });
  });

  it('a document-level override to require an NDA wins even though its folder is shared without one', () => {
    const grants = [
      { folder_id: 'f1', nda_required: false },
      { document_id: 'd1', nda_required: true },
    ];
    const docs = [{ id: 'd1', folder_id: 'f1' }, { id: 'd2', folder_id: 'f1' }];
    const result = resolveDocumentAccess(grants, docs);
    expect(result.visibleIds).toEqual(['d2']);
    expect(result.pendingCount).toBe(1);
  });

  it('a document-level override to NOT require an NDA wins even though its folder requires one', () => {
    const grants = [
      { folder_id: 'f1', nda_required: true },
      { document_id: 'd1', nda_required: false },
    ];
    const docs = [{ id: 'd1', folder_id: 'f1' }, { id: 'd2', folder_id: 'f1' }];
    const result = resolveDocumentAccess(grants, docs);
    expect(result.visibleIds).toEqual(['d1']);
    expect(result.pendingCount).toBe(1);
  });

  it('a document with no applicable grant at all is neither visible nor pending', () => {
    const grants: { folder_id?: string; document_id?: string; nda_required: boolean }[] = [];
    const docs = [{ id: 'd1', folder_id: 'f1' }];
    expect(resolveDocumentAccess(grants, docs)).toEqual({ visibleIds: [], pendingCount: 0 });
  });

  it('an accepted document-level NDA makes it visible', () => {
    const grants = [{ document_id: 'd1', nda_required: true, nda_accepted_at: '2026-01-01T00:00:00Z' }];
    const docs = [{ id: 'd1', folder_id: 'f1' }];
    expect(resolveDocumentAccess(grants, docs)).toEqual({ visibleIds: ['d1'], pendingCount: 0 });
  });
});

describe('cycleGrantState (F4 tri-state)', () => {
  it('cycles none -> shared -> shared_nda -> none', () => {
    expect(cycleGrantState('none')).toBe('shared');
    expect(cycleGrantState('shared')).toBe('shared_nda');
    expect(cycleGrantState('shared_nda')).toBe('none');
  });
});

describe('collectFolderSelectionKeys (F4 cascade)', () => {
  const folders = [
    { id: 'root', parent_id: undefined },
    { id: 'child', parent_id: 'root' },
    { id: 'grandchild', parent_id: 'child' },
    { id: 'unrelated', parent_id: undefined },
  ];
  const documents = [
    { id: 'doc-root', folder_id: 'root' },
    { id: 'doc-child', folder_id: 'child' },
    { id: 'doc-unrelated', folder_id: 'unrelated' },
  ];

  it('cascades to every descendant folder and document, never siblings', () => {
    const keys = collectFolderSelectionKeys('root', folders, documents);
    const expected = ['folder:root', 'doc:doc-root', 'folder:child', 'doc:doc-child', 'folder:grandchild'];
    expect([...keys].sort()).toEqual([...expected].sort());
    expect(keys).not.toContain('folder:unrelated');
    expect(keys).not.toContain('doc:doc-unrelated');
  });

  it('a leaf folder with no children returns only itself', () => {
    expect(collectFolderSelectionKeys('grandchild', folders, documents)).toEqual(['folder:grandchild']);
  });
});

describe('diffGrantSelection (F4 tri-state scoping)', () => {
  it('produces an add for a newly selected item with no existing grant', () => {
    const diff = diffGrantSelection({ 'doc:d1': 'shared' }, {});
    expect(diff).toEqual([{ key: 'doc:d1', action: 'add', ndaRequired: false }]);
  });

  it('produces an add with ndaRequired true for shared_nda', () => {
    const diff = diffGrantSelection({ 'doc:d1': 'shared_nda' }, {});
    expect(diff).toEqual([{ key: 'doc:d1', action: 'add', ndaRequired: true }]);
  });

  it('is a no-op when the selection already matches the existing grant', () => {
    const diff = diffGrantSelection({ 'doc:d1': 'shared' }, { 'doc:d1': { id: 'g1', nda_required: false } });
    expect(diff).toEqual([]);
  });

  it('revokes and re-adds when the NDA requirement changes', () => {
    const diff = diffGrantSelection({ 'doc:d1': 'shared_nda' }, { 'doc:d1': { id: 'g1', nda_required: false } });
    expect(diff).toEqual([
      { key: 'doc:d1', action: 'revoke', existingId: 'g1', ndaRequired: false },
      { key: 'doc:d1', action: 'add', ndaRequired: true },
    ]);
  });

  it('revokes an item that was un-selected back to none', () => {
    const diff = diffGrantSelection({ 'doc:d1': 'none' }, { 'doc:d1': { id: 'g1', nda_required: false } });
    expect(diff).toEqual([{ key: 'doc:d1', action: 'revoke', existingId: 'g1', ndaRequired: false }]);
  });

  it('re-submitting the exact same selection twice is a total no-op', () => {
    const existing = { 'doc:d1': { id: 'g1', nda_required: true } };
    const diff = diffGrantSelection({ 'doc:d1': 'shared_nda' }, existing);
    expect(diff).toEqual([]);
  });
});
