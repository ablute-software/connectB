// Prompt 471 §A — pure tests for the document-based Market Thesis
// suggestion parser. Same reasoning as market-document-extract.test.ts:
// this is the layer that actually enforces "never a suggestion without a
// real document" and "never overwrite a field the founder already filled
// in" — a live route/DB isn't needed to prove either, and this is exactly
// the layer that would have caught Prompt 457's own half-fixed gate if a
// test like this had existed for it at the time.
import { describe, expect, it } from 'vitest';
import { parseThesisDocumentSuggestions, type ThesisDocRef } from './market-thesis-document-suggest';

const DOCS = new Map<number, ThesisDocRef>([
  [1, { id: 'doc-deck', name: 'ablute_ investor deck.pdf' }],
  [2, { id: 'doc-onepager', name: 'One-pager.pdf' }],
]);

const EMPTY_THESIS = {};

describe('parseThesisDocumentSuggestions', () => {
  it('returns a suggestion for a field the document answers, carrying its origin (Prompt 471 verification #1/#4)', () => {
    const raw = { suggestions: [{ field: 'core_problem', value: 'Late diagnosis costs lives.', document_index: 1, page: 3 }] };
    const out = parseThesisDocumentSuggestions(raw, DOCS, EMPTY_THESIS);
    expect(out.core_problem).toEqual({
      value: 'Late diagnosis costs lives.', documentId: 'doc-deck', documentName: 'ablute_ investor deck.pdf', page: 3,
    });
  });

  it('produces no suggestion for a field the documents do not answer (Prompt 471 verification #2)', () => {
    const raw = { suggestions: [{ field: 'core_problem', value: 'Late diagnosis costs lives.', document_index: 1, page: 3 }] };
    const out = parseThesisDocumentSuggestions(raw, DOCS, EMPTY_THESIS);
    expect(out.primary_user).toBeUndefined();
    expect(out.geography).toBeUndefined();
    expect(Object.keys(out)).toEqual(['core_problem']);
  });

  it('never overwrites a field the founder already filled in, even when the document disagrees (Prompt 471 verification #3)', () => {
    const raw = { suggestions: [{ field: 'geography', value: 'Spain', document_index: 1, page: 2 }] };
    const out = parseThesisDocumentSuggestions(raw, DOCS, { geography: 'Portugal' });
    expect(out.geography).toBeUndefined();
  });

  it('a whitespace-only founder value still counts as empty — the suggestion is not blocked', () => {
    const raw = { suggestions: [{ field: 'geography', value: 'Portugal', document_index: 1, page: 2 }] };
    const out = parseThesisDocumentSuggestions(raw, DOCS, { geography: '   ' });
    expect(out.geography?.value).toBe('Portugal');
  });

  it('drops a suggestion whose document_index does not resolve to a real document — never a fact without a real source', () => {
    const raw = { suggestions: [{ field: 'core_problem', value: 'X', document_index: 99, page: 1 }] };
    expect(parseThesisDocumentSuggestions(raw, DOCS, EMPTY_THESIS)).toEqual({});
  });

  it('drops a suggestion with no document_index at all', () => {
    const raw = { suggestions: [{ field: 'core_problem', value: 'X', page: 1 }] };
    expect(parseThesisDocumentSuggestions(raw, DOCS, EMPTY_THESIS)).toEqual({});
  });

  it('drops a suggestion for an unknown/invalid field name — the model can only answer the 7 real fields', () => {
    const raw = { suggestions: [{ field: 'favorite_color', value: 'blue', document_index: 1 }] };
    expect(parseThesisDocumentSuggestions(raw, DOCS, EMPTY_THESIS)).toEqual({});
  });

  it('drops a suggestion whose value is empty or whitespace-only', () => {
    const raw = { suggestions: [{ field: 'core_problem', value: '   ', document_index: 1 }] };
    expect(parseThesisDocumentSuggestions(raw, DOCS, EMPTY_THESIS)).toEqual({});
  });

  it('page is null when the model does not give one — never invented', () => {
    const raw = { suggestions: [{ field: 'core_problem', value: 'X', document_index: 1 }] };
    const out = parseThesisDocumentSuggestions(raw, DOCS, EMPTY_THESIS);
    expect(out.core_problem?.page).toBeNull();
  });

  it('covers all 7 fields in a single pass, not just core_problem — the exact half-fixed gate Prompt 457 left behind', () => {
    const raw = {
      suggestions: [
        { field: 'product_summary', value: 'A', document_index: 1 },
        { field: 'core_problem', value: 'B', document_index: 1 },
        { field: 'primary_user', value: 'C', document_index: 1 },
        { field: 'economic_buyer', value: 'D', document_index: 1 },
        { field: 'beachhead', value: 'E', document_index: 1 },
        { field: 'geography', value: 'F', document_index: 1 },
        { field: 'primary_use_case', value: 'G', document_index: 1 },
      ],
    };
    const out = parseThesisDocumentSuggestions(raw, DOCS, EMPTY_THESIS);
    expect(Object.keys(out).sort()).toEqual(
      ['beachhead', 'core_problem', 'economic_buyer', 'geography', 'primary_use_case', 'primary_user', 'product_summary'].sort(),
    );
  });

  it('an empty raw response produces no suggestions', () => {
    expect(parseThesisDocumentSuggestions({}, DOCS, EMPTY_THESIS)).toEqual({});
    expect(parseThesisDocumentSuggestions(undefined, DOCS, EMPTY_THESIS)).toEqual({});
  });

  it('the first usable suggestion for a field wins if the model reports the same field twice', () => {
    const raw = {
      suggestions: [
        { field: 'geography', value: 'First', document_index: 1 },
        { field: 'geography', value: 'Second', document_index: 2 },
      ],
    };
    const out = parseThesisDocumentSuggestions(raw, DOCS, EMPTY_THESIS);
    expect(out.geography?.value).toBe('First');
  });

  it('truncates an overlong value to MARKET_THESIS_TEXT_MAX rather than forwarding it untouched', () => {
    const long = 'x'.repeat(400);
    const raw = { suggestions: [{ field: 'core_problem', value: long, document_index: 1 }] };
    const out = parseThesisDocumentSuggestions(raw, DOCS, EMPTY_THESIS);
    expect(out.core_problem?.value.length).toBe(300);
  });

  it('a non-array suggestions field (malformed tool output) produces no suggestions rather than throwing', () => {
    expect(parseThesisDocumentSuggestions({ suggestions: 'not an array' }, DOCS, EMPTY_THESIS)).toEqual({});
  });
});
