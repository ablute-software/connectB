import { describe, it, expect } from 'vitest';
import { projectDocScores } from './investor-doc-scores';

describe('projectDocScores', () => {
  it('keys by documentId, keeping only score and note', () => {
    const out = projectDocScores([{ document_id: 'doc-1', score: 8, note: 'Strong team slide' }]);
    expect(out).toEqual({ 'doc-1': { score: 8, note: 'Strong team slide' } });
  });

  it('never leaks any field beyond score/note — the object has exactly those two keys', () => {
    const out = projectDocScores([{ document_id: 'doc-1', score: 5, note: null }]);
    expect(Object.keys(out['doc-1']).sort()).toEqual(['note', 'score']);
  });

  it('multiple rows project independently, one entry per document', () => {
    const out = projectDocScores([
      { document_id: 'doc-1', score: 8, note: null },
      { document_id: 'doc-2', score: 3, note: 'Needs more traction data' },
    ]);
    expect(out).toEqual({
      'doc-1': { score: 8, note: null },
      'doc-2': { score: 3, note: 'Needs more traction data' },
    });
  });

  it('an empty input projects to an empty object', () => {
    expect(projectDocScores([])).toEqual({});
  });
});
