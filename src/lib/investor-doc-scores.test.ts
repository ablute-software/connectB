import { describe, it, expect } from 'vitest';
import { projectDocScoresWithHistory } from './investor-doc-scores';

describe('projectDocScoresWithHistory', () => {
  it('a score matching the current version is "current", with no history and no re-rate flag', () => {
    const out = projectDocScoresWithHistory(
      [{ document_id: 'doc-1', document_version_id: 'v2', score: 8, note: 'Strong team slide', updated_at: '2026-08-20T00:00:00Z' }],
      { 'doc-1': 'v2' },
    );
    expect(out).toEqual({
      'doc-1': { current: { score: 8, note: 'Strong team slide' }, needsReRate: false, history: [] },
    });
  });

  it('a score on a SUPERSEDED version becomes history, current is null, needsReRate is true', () => {
    const out = projectDocScoresWithHistory(
      [{ document_id: 'doc-1', document_version_id: 'v1', score: 8, note: 'Old note', updated_at: '2026-08-01T00:00:00Z' }],
      { 'doc-1': 'v2' },
    );
    expect(out['doc-1'].current).toBeNull();
    expect(out['doc-1'].needsReRate).toBe(true);
    expect(out['doc-1'].history).toEqual([{ score: 8, note: 'Old note', updatedAt: '2026-08-01T00:00:00Z' }]);
  });

  it('re-rating after a version change keeps the old score as history, never deletes it', () => {
    const out = projectDocScoresWithHistory(
      [
        { document_id: 'doc-1', document_version_id: 'v1', score: 8, note: 'Old note', updated_at: '2026-08-01T00:00:00Z' },
        { document_id: 'doc-1', document_version_id: 'v2', score: 5, note: 'Weaker after the update', updated_at: '2026-08-20T00:00:00Z' },
      ],
      { 'doc-1': 'v2' },
    );
    expect(out['doc-1'].current).toEqual({ score: 5, note: 'Weaker after the update' });
    expect(out['doc-1'].needsReRate).toBe(false);
    expect(out['doc-1'].history).toEqual([{ score: 8, note: 'Old note', updatedAt: '2026-08-01T00:00:00Z' }]);
  });

  it('multiple past versions sort newest-first in history', () => {
    const out = projectDocScoresWithHistory(
      [
        { document_id: 'doc-1', document_version_id: 'v1', score: 7, note: null, updated_at: '2026-08-01T00:00:00Z' },
        { document_id: 'doc-1', document_version_id: 'v2', score: 6, note: null, updated_at: '2026-08-10T00:00:00Z' },
      ],
      { 'doc-1': 'v3' },
    );
    expect(out['doc-1'].history.map((h) => h.updatedAt)).toEqual(['2026-08-10T00:00:00Z', '2026-08-01T00:00:00Z']);
  });

  it('an external-link document (no version rows at all) matches on a null version id, same as before versioning existed', () => {
    const out = projectDocScoresWithHistory(
      [{ document_id: 'doc-ext', document_version_id: null, score: 9, note: null, updated_at: '2026-08-01T00:00:00Z' }],
      { 'doc-ext': null },
    );
    expect(out['doc-ext']).toEqual({ current: { score: 9, note: null }, needsReRate: false, history: [] });
  });

  it('a document with no score at all has no entry', () => {
    expect(projectDocScoresWithHistory([], { 'doc-1': 'v1' })).toEqual({});
  });
});
