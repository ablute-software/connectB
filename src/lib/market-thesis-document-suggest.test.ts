// Prompt 471 §A — pure tests for the document-based Market Thesis
// suggestion parser. Same reasoning as market-document-extract.test.ts:
// this is the layer that actually enforces "never a suggestion without a
// real document" and "never overwrite a field the founder already filled
// in" — a live route/DB isn't needed to prove either, and this is exactly
// the layer that would have caught Prompt 457's own half-fixed gate if a
// test like this had existed for it at the time.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseThesisDocumentSuggestions, computeDocumentSuggestSignature, isThesisIncomplete,
  shouldAutoSuggestFromDocuments, recordDocumentSuggestAttempt, type ThesisDocRef,
} from './market-thesis-document-suggest';
import { MARKET_THESIS_TEXT_FIELD_KEYS } from './market-thesis';

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

// ---------------------------------------------------------------------------
// Prompt 473 — the automatic trigger and its cost control. Prompt 471 put
// this pass behind a button precisely so a page load could never fire a
// paid model call; 473 reintroduces the automatic trigger, so these tests
// are the proof that "fires once per document set" is enforced rather than
// hoped for.

describe('computeDocumentSuggestSignature (473 verification (a)) — a function of the document set, never of the clock', () => {
  it('changes when a document is added to the set — this is what lets the pass fire once more after new documents arrive', () => {
    const before = computeDocumentSuggestSignature(['doc-a', 'doc-b']);
    const after = computeDocumentSuggestSignature(['doc-a', 'doc-b', 'doc-c']);
    expect(before).not.toBe(after);
  });

  it('changes when a document is removed from the set', () => {
    expect(computeDocumentSuggestSignature(['doc-a', 'doc-b'])).not.toBe(computeDocumentSuggestSignature(['doc-a']));
  });

  it('is stable across repeated calls for the same set — 50 reloads, one signature, so the pass never re-fires', () => {
    expect(computeDocumentSuggestSignature(['doc-a', 'doc-b'])).toBe(computeDocumentSuggestSignature(['doc-a', 'doc-b']));
  });

  it('is order-independent — the document query is unordered, so ordering must never look like a new set', () => {
    expect(computeDocumentSuggestSignature(['doc-b', 'doc-a'])).toBe(computeDocumentSuggestSignature(['doc-a', 'doc-b']));
  });

  it('ignores duplicate ids — the same set listed twice is still the same set', () => {
    expect(computeDocumentSuggestSignature(['doc-a', 'doc-a', 'doc-b'])).toBe(computeDocumentSuggestSignature(['doc-a', 'doc-b']));
  });
});

describe('isThesisIncomplete — "pelo menos um de MARKET_THESIS_TEXT_FIELD_KEYS vazio"', () => {
  const complete = Object.fromEntries(MARKET_THESIS_TEXT_FIELD_KEYS.map((k) => [k, 'filled in'])) as Record<string, string>;

  it('a thesis with every text field filled in is complete', () => {
    expect(isThesisIncomplete(complete)).toBe(false);
  });

  it.each(MARKET_THESIS_TEXT_FIELD_KEYS)('a thesis missing only %s is incomplete — any single empty field counts', (key) => {
    expect(isThesisIncomplete({ ...complete, [key]: null })).toBe(true);
  });

  it('a whitespace-only field counts as empty, not as filled in', () => {
    expect(isThesisIncomplete({ ...complete, core_problem: '   ' })).toBe(true);
  });

  it('no thesis row at all (null) is incomplete — 10 of 11 production orgs, and the emptiest case there is', () => {
    expect(isThesisIncomplete(null)).toBe(true);
  });
});

describe('shouldAutoSuggestFromDocuments (473 verification (c)) — every clause that can stop a paid pass', () => {
  const eligible = {
    thesisIncomplete: true, candidateDocumentCount: 3,
    currentSignature: 'sig-now', storedSignature: null, markCapabilityAvailable: true,
  };

  it('fires when the thesis is incomplete, documents exist, and this set was never attempted', () => {
    expect(shouldAutoSuggestFromDocuments(eligible)).toBe(true);
  });

  it('a COMPLETE thesis never fires — the prompt\'s own "tese já completa → não dispara"', () => {
    expect(shouldAutoSuggestFromDocuments({ ...eligible, thesisIncomplete: false })).toBe(false);
  });

  it('zero candidate documents never fires — and so never spends the call', () => {
    expect(shouldAutoSuggestFromDocuments({ ...eligible, candidateDocumentCount: 0 })).toBe(false);
  });

  it('the SAME signature as the recorded attempt never fires again — 50 reloads, one pass', () => {
    expect(shouldAutoSuggestFromDocuments({ ...eligible, storedSignature: 'sig-now' })).toBe(false);
  });

  it('a DIFFERENT stored signature fires once more — new documents reopen exactly one automatic attempt', () => {
    expect(shouldAutoSuggestFromDocuments({ ...eligible, storedSignature: 'sig-from-an-older-document-set' })).toBe(true);
  });

  it('fails CLOSED when migration 0281 is not applied — with nowhere to record the attempt, off is the only safe state', () => {
    expect(shouldAutoSuggestFromDocuments({ ...eligible, markCapabilityAvailable: false })).toBe(false);
  });
});

// A hand-rolled fake SupabaseClient, same pattern as reconciliation.test.ts:
// records what was actually written so the test can assert on the payload
// rather than on the call happening at all.
function makeFakeAdmin(opts: { existingRowIds?: string[]; updateError?: string } = {}) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const admin = {
    from: (table: string) => {
      if (table !== 'org_market_thesis') throw new Error(`unexpected table in this fixture: ${table}`);
      return {
        update: (payload: Record<string, unknown>) => ({
          eq: () => ({
            select: () => {
              if (opts.updateError) return Promise.resolve({ data: null, error: { message: opts.updateError } });
              updates.push(payload);
              return Promise.resolve({ data: (opts.existingRowIds ?? []).map((id) => ({ org_id: id })), error: null });
            },
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          inserts.push(payload);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, updates, inserts };
}

const NOW = '2026-08-30T15:00:00.000Z';

describe('recordDocumentSuggestAttempt (473 verification (b)) — the mark, and what it must never touch', () => {
  it('writes BOTH mark columns when the thesis row already exists', async () => {
    const { admin, updates, inserts } = makeFakeAdmin({ existingRowIds: ['org-1'] });
    await recordDocumentSuggestAttempt(admin, 'org-1', 'sig-1', NOW);
    expect(updates).toEqual([{ document_suggest_auto_attempted_at: NOW, document_suggest_auto_signature: 'sig-1' }]);
    expect(inserts).toEqual([]);
  });

  it('touches ONLY the two mark columns — never version, updated_at, or any founder content field', async () => {
    const { admin, updates } = makeFakeAdmin({ existingRowIds: ['org-1'] });
    await recordDocumentSuggestAttempt(admin, 'org-1', 'sig-1', NOW);
    // The data-safety property: a background bookkeeping write must never
    // be able to blank a founder's thesis or move the version that feeds
    // the hypotheses stamp and the market-research cache key.
    expect(Object.keys(updates[0]).sort()).toEqual(['document_suggest_auto_attempted_at', 'document_suggest_auto_signature']);
    for (const key of [...MARKET_THESIS_TEXT_FIELD_KEYS, 'version', 'updated_at', 'adjacent_technologies', 'excluded_markets']) {
      expect(updates[0]).not.toHaveProperty(key);
    }
  });

  it('creates the row when the org has none — otherwise the 10 of 11 orgs with no thesis row would re-fire the pass on every reload', async () => {
    const { admin, updates, inserts } = makeFakeAdmin({ existingRowIds: [] });
    await recordDocumentSuggestAttempt(admin, 'org-1', 'sig-1', NOW);
    expect(updates).toHaveLength(1); // update ran first and matched nothing
    expect(inserts).toEqual([{
      org_id: 'org-1', version: 0,
      document_suggest_auto_attempted_at: NOW, document_suggest_auto_signature: 'sig-1',
    }]);
  });

  it('the row it creates carries version 0, so the founder\'s first real save still lands on version 1 exactly as today', async () => {
    const { admin, inserts } = makeFakeAdmin({ existingRowIds: [] });
    await recordDocumentSuggestAttempt(admin, 'org-1', 'sig-1', NOW);
    expect(inserts[0].version).toBe(0);
  });

  it('never throws when the write fails — losing the mark costs one repeated attempt; failing the founder\'s suggestions over bookkeeping would be worse', async () => {
    const { admin, inserts } = makeFakeAdmin({ updateError: 'connection reset' });
    await expect(recordDocumentSuggestAttempt(admin, 'org-1', 'sig-1', NOW)).resolves.toBeUndefined();
    expect(inserts).toEqual([]); // an errored update must not be mistaken for "no row exists"
  });

  it('takes no outcome parameter at all — the mark structurally CANNOT differ between a pass that found suggestions and one that honestly found none', () => {
    // Prompt 473 §2: "Grava a marca sempre que a passagem corre, sucesso ou
    // 'not found' honesto." Enforced by the signature itself rather than by
    // remembering to call it on both paths.
    expect(recordDocumentSuggestAttempt.length).toBe(4); // admin, orgId, signature, nowIso — no outcome
  });
});

// Source-level guard, same technique as no-fire-and-forget.test.ts: the
// property is about the SHAPE of the route, which cannot be exercised
// without a live Postgres and a real Anthropic key.
describe('the route records the attempt independently of what was found (473 verification (b))', () => {
  const routeSource = readFileSync('src/app/api/market-thesis/suggest-from-documents/route.ts', 'utf8');

  it('writes the mark BEFORE the model response is parsed, so the mark cannot come to depend on the outcome', () => {
    const markAt = routeSource.indexOf('recordDocumentSuggestAttempt(admin, orgId, signature');
    const parseAt = routeSource.indexOf('parseThesisDocumentSuggestions(toolUse?.input');
    expect(markAt).toBeGreaterThan(-1);
    expect(parseAt).toBeGreaterThan(-1);
    expect(markAt).toBeLessThan(parseAt);
  });

  it('never branches on how many suggestions came back — there is no "if we found something" gate anywhere in the route', () => {
    expect(routeSource).not.toContain('Object.keys(suggestions)');
    expect(routeSource).not.toMatch(/if\s*\([^)]*suggestions[^)]*length/);
  });
});
