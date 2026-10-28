// Prompt 922 (I3) — the pure state behind the autosave: what is pending, how two pending changes merge, and what the screen shows on top of the server's scores.
import { describe, expect, it } from 'vitest';
import { isEmptyDraft, mergeDraft, withDraft } from './eval-draft';

describe('the pending changes', () => {
  it('nothing pending is empty; any score, comment or note makes it not', () => {
    expect(isEmptyDraft({})).toBe(true);
    expect(isEmptyDraft({ scores: {} })).toBe(true);
    expect(isEmptyDraft({ scores: { a: { score: 3 } } })).toBe(false);
    expect(isEmptyDraft({ overallComment: '' })).toBe(false);                       // an erased comment is still something to save
    expect(isEmptyDraft({ privateNote: 'x' })).toBe(false);
  });
  it('a later change wins field by field; a comment typed after a score keeps both; other criteria are untouched', () => {
    const merged = mergeDraft({ scores: { a: { score: 2 }, b: { score: 4, comment: 'ok' } }, overallComment: 'first' }, { scores: { a: { score: 5, comment: 'great' } }, privateNote: 'n' });
    expect(merged).toEqual({ scores: { a: { score: 5, comment: 'great' }, b: { score: 4, comment: 'ok' } }, overallComment: 'first', privateNote: 'n' });
    expect(mergeDraft({}, {})).toEqual({});
    expect(mergeDraft({ scores: { a: { score: 1 } } }, { scores: { a: { score: null } } })).toEqual({ scores: { a: { score: null } } });   // clearing a score is a change too
  });
  it('the screen shows the server\'s scores with the pending changes on top — a score cleared, a comment added, a new criterion', () => {
    const server = { a: { score: 3, comment: 'fine' }, b: { score: 5, comment: '' } };
    expect(withDraft(server, { scores: { a: { comment: 'better' }, b: { score: null }, c: { score: 2 } } })).toEqual({ a: { score: 3, comment: 'better' }, b: { score: null, comment: '' }, c: { score: 2, comment: '' } });
    expect(withDraft(server, {})).toEqual(server);
  });
});
