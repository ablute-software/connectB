import { describe, expect, it } from 'vitest';
import { classifyLinkCandidates, normalizePersonName, type LinkCandidate } from './person-link';

describe('normalizePersonName', () => {
  it('strips accents, case, punctuation and extra whitespace', () => {
    expect(normalizePersonName('João Coelho-Borges')).toBe('joao coelho borges');
    expect(normalizePersonName('  Maria   Villas-Boas ')).toBe('maria villas boas');
    expect(normalizePersonName('Jake Wombwell-Povey')).toBe('jake wombwell povey');
    expect(normalizePersonName('NUNO Gonçalves')).toBe('nuno goncalves');
  });

  it('does NOT strip legal-suffix words the firm normalizer strips — those are names here', () => {
    expect(normalizePersonName('Marco Co')).toBe('marco co');
    expect(normalizePersonName('Ana Partners')).toBe('ana partners');
  });

  it('treats an empty or symbol-only name as empty (never matches anything)', () => {
    expect(normalizePersonName('')).toBe('');
    expect(normalizePersonName('---')).toBe('');
  });
});

const firmA = 'firm-a';
const firmB = 'firm-b';
const c = (id: string, entityId: string | null, affiliationEntityIds: string[] = []): LinkCandidate =>
  ({ id, fullName: 'Same Name', entityId, affiliationEntityIds });

describe('classifyLinkCandidates', () => {
  it('layer 3 when there is no same-name candidate', () => {
    expect(classifyLinkCandidates([], firmA).layer).toBe(3);
  });

  it('layer 1 only when exactly one candidate exists AND its firm matches', () => {
    const r = classifyLinkCandidates([c('x', firmA)], firmA);
    expect(r.layer).toBe(1);
    expect(r.firmMatches.map((m) => m.id)).toEqual(['x']);
    expect(r.others).toEqual([]);
  });

  it('firm match also counts through a non-primary affiliation', () => {
    expect(classifyLinkCandidates([c('x', firmB, [firmA])], firmA).layer).toBe(1);
  });

  it('layer 2 when the single candidate is at a different firm', () => {
    const r = classifyLinkCandidates([c('x', firmB)], firmA);
    expect(r.layer).toBe(2);
    expect(r.others.map((m) => m.id)).toEqual(['x']);
  });

  it('layer 2 when the private row has no firm link to compare against', () => {
    expect(classifyLinkCandidates([c('x', firmA)], null).layer).toBe(2);
  });

  it('layer 2 (never 1) when more than one candidate exists, even if only one firm-matches', () => {
    const r = classifyLinkCandidates([c('x', firmA), c('y', firmB)], firmA);
    expect(r.layer).toBe(2);
    expect(r.firmMatches.map((m) => m.id)).toEqual(['x']);
    expect(r.others.map((m) => m.id)).toEqual(['y']);
  });

  it('layer 2 when two candidates both firm-match', () => {
    expect(classifyLinkCandidates([c('x', firmA), c('y', firmA)], firmA).layer).toBe(2);
  });
});
