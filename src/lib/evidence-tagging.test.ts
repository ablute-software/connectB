import { describe, expect, it } from 'vitest';
import { buildEvidenceTaggingPrompt, parseEvidenceTaggingOutput } from './evidence-tagging';

describe('buildEvidenceTaggingPrompt', () => {
  it('includes the title, excerpt, and every topic slug offered', () => {
    const prompt = buildEvidenceTaggingPrompt(
      { title: 'Podcast interview', excerpt: 'She discussed early cancer detection.' },
      [{ slug: 'oncology', labelEn: 'Oncology' }, { slug: 'diagnostics', labelEn: 'Diagnostics' }],
    );
    expect(prompt).toContain('Podcast interview');
    expect(prompt).toContain('She discussed early cancer detection.');
    expect(prompt).toContain('oncology — Oncology');
    expect(prompt).toContain('diagnostics — Diagnostics');
  });

  it('states "no excerpt" honestly rather than an empty string when excerpt is null', () => {
    const prompt = buildEvidenceTaggingPrompt({ title: 'A title', excerpt: null }, []);
    expect(prompt).toContain('(no excerpt — title only)');
  });
});

describe('parseEvidenceTaggingOutput', () => {
  const validSlugs = new Set(['oncology', 'diagnostics']);

  it('keeps tags whose slug is in the real taxonomy', () => {
    const result = parseEvidenceTaggingOutput(
      { tags: [{ slug: 'oncology', confidence: 0.9 }], polarity: 'neutral', is_personal: false },
      validSlugs,
    );
    expect(result.tags).toEqual([{ slug: 'oncology', confidence: 0.9 }]);
    expect(result.rejectedSlugs).toEqual([]);
  });

  it('rejects a slug the model invented that is not in the real taxonomy — never creates a new topic', () => {
    const result = parseEvidenceTaggingOutput(
      { tags: [{ slug: 'oncology', confidence: 0.8 }, { slug: 'made-up-topic', confidence: 0.5 }], polarity: 'neutral', is_personal: false },
      validSlugs,
    );
    expect(result.tags).toEqual([{ slug: 'oncology', confidence: 0.8 }]);
    expect(result.rejectedSlugs).toEqual(['made-up-topic']);
  });

  it('caps at 5 tags even if the model returns more', () => {
    const manyTags = ['oncology', 'diagnostics', 'oncology', 'diagnostics', 'oncology', 'diagnostics']
      .map((slug) => ({ slug, confidence: 0.5 }));
    const result = parseEvidenceTaggingOutput({ tags: manyTags, polarity: 'neutral', is_personal: false }, validSlugs);
    expect(result.tags.length).toBeLessThanOrEqual(5);
  });

  it('clamps an out-of-range confidence into [0,1]', () => {
    const result = parseEvidenceTaggingOutput(
      { tags: [{ slug: 'oncology', confidence: 5 }], polarity: 'neutral', is_personal: false },
      validSlugs,
    );
    expect(result.tags[0].confidence).toBe(1);
  });

  it('returns null polarity/isPersonal rather than a guessed default when the model omits them', () => {
    const result = parseEvidenceTaggingOutput({ tags: [] }, validSlugs);
    expect(result.polarity).toBeNull();
    expect(result.isPersonal).toBeNull();
  });

  it('handles a completely malformed response without throwing', () => {
    const result = parseEvidenceTaggingOutput(undefined, validSlugs);
    expect(result).toEqual({ tags: [], polarity: null, isPersonal: null, rejectedSlugs: [] });
  });
});
