import { describe, expect, it } from 'vitest';
import {
  countByVisibility, filterByVisibility, levelCountsByFolder, nonZeroLevels, toggleVisibilityFilter,
} from './vault-level-summary';

describe('countByVisibility', () => {
  it('counts all three levels', () => {
    const docs = [{ visibility: 'open' as const }, { visibility: 'open' as const }, { visibility: 'on_grant' as const }, { visibility: 'due_diligence' as const }];
    expect(countByVisibility(docs)).toEqual({ open: 2, on_grant: 1, due_diligence: 1 });
  });

  it('is all zeros for no documents', () => {
    expect(countByVisibility([])).toEqual({ open: 0, on_grant: 0, due_diligence: 0 });
  });
});

describe('levelCountsByFolder', () => {
  const folders = [
    { id: 'root', parent_id: undefined },
    { id: 'child', parent_id: 'root' },
    { id: 'grandchild', parent_id: 'child' },
    { id: 'empty', parent_id: undefined },
  ];

  it('an empty folder counts all zeros', () => {
    const result = levelCountsByFolder(folders, []);
    expect(result.get('empty')).toEqual({ open: 0, on_grant: 0, due_diligence: 0 });
  });

  it('includes documents in subfolders, not just direct children', () => {
    const docs = [
      { id: 'd1', folder_id: 'root', visibility: 'open' as const },
      { id: 'd2', folder_id: 'child', visibility: 'on_grant' as const },
      { id: 'd3', folder_id: 'grandchild', visibility: 'due_diligence' as const },
    ];
    const result = levelCountsByFolder(folders, docs);
    // root sees all three (its own + both descendants').
    expect(result.get('root')).toEqual({ open: 1, on_grant: 1, due_diligence: 1 });
    // child sees only its own + grandchild's, not root's.
    expect(result.get('child')).toEqual({ open: 0, on_grant: 1, due_diligence: 1 });
    // grandchild sees only its own.
    expect(result.get('grandchild')).toEqual({ open: 0, on_grant: 0, due_diligence: 1 });
  });

  it('a document with no folder_id is never counted under any folder', () => {
    const docs = [{ id: 'd1', folder_id: undefined, visibility: 'open' as const }];
    const result = levelCountsByFolder(folders, docs);
    for (const f of folders) expect(result.get(f.id)).toEqual({ open: 0, on_grant: 0, due_diligence: 0 });
  });
});

describe('nonZeroLevels', () => {
  it('drops the zero levels, keeps the rest in a stable order', () => {
    expect(nonZeroLevels({ open: 4, on_grant: 0, due_diligence: 1 }))
      .toEqual([{ visibility: 'open', count: 4 }, { visibility: 'due_diligence', count: 1 }]);
  });

  it('is empty for an all-zero folder', () => {
    expect(nonZeroLevels({ open: 0, on_grant: 0, due_diligence: 0 })).toEqual([]);
  });
});

describe('toggleVisibilityFilter / filterByVisibility', () => {
  it('clicking a level sets the filter; clicking it again clears it', () => {
    expect(toggleVisibilityFilter(null, 'open')).toBe('open');
    expect(toggleVisibilityFilter('open', 'open')).toBeNull();
  });

  it('clicking a different level replaces the filter, not toggles it off', () => {
    expect(toggleVisibilityFilter('open', 'on_grant')).toBe('on_grant');
  });

  it('filterByVisibility(null) returns everything unchanged', () => {
    const docs = [{ visibility: 'open' as const }, { visibility: 'due_diligence' as const }];
    expect(filterByVisibility(docs, null)).toEqual(docs);
  });

  it('filterByVisibility narrows to exactly one level', () => {
    const docs = [{ visibility: 'open' as const }, { visibility: 'due_diligence' as const }, { visibility: 'open' as const }];
    expect(filterByVisibility(docs, 'open')).toHaveLength(2);
  });
});
