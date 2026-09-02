import { describe, expect, it } from 'vitest';
import {
  looksLikeEmail, normaliseShareEmail, searchSuggestionOrder, shouldOfferShareByEmail,
} from './share-by-email';

// Prompt 545 — the regression these guard against is the original bug: the
// founder types a real address, and the only thing the product offers him is
// "Unlock on Pipeline" for a catalog entity he never asked about.

describe('looksLikeEmail', () => {
  it.each([
    'nunomarujo@gmail.com',
    'alex.teste@example.com',
    'a@b.co',
    'first+tag@sub.domain.pt',
  ])('accepts %s', (v) => {
    expect(looksLikeEmail(v)).toBe(true);
  });

  it('ignores surrounding whitespace, which a paste routinely brings', () => {
    expect(looksLikeEmail('  nunomarujo@gmail.com  ')).toBe(true);
  });

  it.each([
    ['Hoxton Ventures', 'a firm name'],
    ['nunomarujo', 'no domain'],
    ['nunomarujo@', 'no domain part'],
    ['@gmail.com', 'no local part'],
    ['nuno@gmail', 'no dot in the domain'],
    ['two words@x.com', 'a space'],
    ['', 'empty'],
  ])('rejects %s (%s)', (v) => {
    expect(looksLikeEmail(v)).toBe(false);
  });

  it('treats null and undefined as not an email rather than throwing', () => {
    expect(looksLikeEmail(null)).toBe(false);
    expect(looksLikeEmail(undefined)).toBe(false);
  });
});

describe('shouldOfferShareByEmail', () => {
  it('offers when the query is an address nothing in the pipeline matches', () => {
    expect(shouldOfferShareByEmail({ query: 'nunomarujo@gmail.com', pipelineMatchCount: 0 })).toBe(true);
  });

  it('stays quiet when an entity the founder already has matches', () => {
    // Sharing with a known investor should go through that investor's record,
    // not around it.
    expect(shouldOfferShareByEmail({ query: 'partner@hoxton.vc', pipelineMatchCount: 1 })).toBe(false);
  });

  it('stays quiet for an ordinary name search', () => {
    expect(shouldOfferShareByEmail({ query: 'Hoxton', pipelineMatchCount: 0 })).toBe(false);
  });
});

describe('searchSuggestionOrder', () => {
  it('puts share-by-email FIRST, above catalog matches', () => {
    // The exact reported failure: catalog matches appeared instead of the
    // thing he wanted, so they must rank below it and never replace it.
    expect(searchSuggestionOrder({
      query: 'nunomarujo@gmail.com', pipelineMatchCount: 0, catalogMatchCount: 3,
    })).toEqual(['share_by_email', 'catalog_match']);
  });

  it('keeps catalog matches visible rather than suppressing them', () => {
    const order = searchSuggestionOrder({
      query: 'nunomarujo@gmail.com', pipelineMatchCount: 0, catalogMatchCount: 2,
    });
    expect(order).toContain('catalog_match');
  });

  it('leaves a name search exactly as it was', () => {
    expect(searchSuggestionOrder({
      query: 'Hoxton', pipelineMatchCount: 1, catalogMatchCount: 2,
    })).toEqual(['pipeline_entity', 'catalog_match']);
  });

  it('prefers the founder\'s own entity over the email offer', () => {
    expect(searchSuggestionOrder({
      query: 'partner@hoxton.vc', pipelineMatchCount: 1, catalogMatchCount: 0,
    })).toEqual(['pipeline_entity']);
  });

  it('falls back to the empty state only when there is genuinely nothing', () => {
    expect(searchSuggestionOrder({
      query: 'zzzz', pipelineMatchCount: 0, catalogMatchCount: 0,
    })).toEqual(['empty']);
  });

  it('an unmatched address is never the empty state', () => {
    // "No matching entities found" was the dead end he hit.
    expect(searchSuggestionOrder({
      query: 'nunomarujo@gmail.com', pipelineMatchCount: 0, catalogMatchCount: 0,
    })).toEqual(['share_by_email']);
  });
});

describe('normaliseShareEmail', () => {
  it('trims and lowercases what gets pre-filled', () => {
    expect(normaliseShareEmail('  Nuno.Marujo@Gmail.COM ')).toBe('nuno.marujo@gmail.com');
  });
});
