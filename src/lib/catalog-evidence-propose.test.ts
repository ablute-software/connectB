import { describe, expect, it } from 'vitest';
import { validateEvidenceProposal } from './catalog-evidence-propose';

const base = { url: 'https://example.com/article', kind: 'article_about', title: 'A real title' };

describe('validateEvidenceProposal', () => {
  it('accepts a minimal valid proposal', () => {
    const result = validateEvidenceProposal(base);
    expect(result.ok).toBe(true);
    expect(result.normalized).toEqual({ url: base.url, kind: 'article_about', title: base.title, excerpt: null, publishedAt: null });
  });

  it('rejects a missing url — no url, no row', () => {
    const result = validateEvidenceProposal({ ...base, url: '' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('link is required'))).toBe(true);
  });

  it('rejects a non-absolute or non-http(s) url', () => {
    expect(validateEvidenceProposal({ ...base, url: 'not a url' }).ok).toBe(false);
    expect(validateEvidenceProposal({ ...base, url: 'ftp://example.com/x' }).ok).toBe(false);
    expect(validateEvidenceProposal({ ...base, url: '/relative/path' }).ok).toBe(false);
  });

  it('rejects an unknown kind', () => {
    const result = validateEvidenceProposal({ ...base, kind: 'photo' });
    expect(result.ok).toBe(false);
  });

  it('rejects a missing title', () => {
    expect(validateEvidenceProposal({ ...base, title: '  ' }).ok).toBe(false);
  });

  it('rejects an excerpt over 600 chars', () => {
    const result = validateEvidenceProposal({ ...base, excerpt: 'x'.repeat(601) });
    expect(result.ok).toBe(false);
  });

  it('accepts an excerpt at exactly 600 chars', () => {
    const result = validateEvidenceProposal({ ...base, excerpt: 'x'.repeat(600) });
    expect(result.ok).toBe(true);
  });

  it('rejects a malformed date', () => {
    expect(validateEvidenceProposal({ ...base, publishedAt: '10/09/2026' }).ok).toBe(false);
  });

  it('accepts a well-formed date', () => {
    const result = validateEvidenceProposal({ ...base, publishedAt: '2026-09-10' });
    expect(result.ok).toBe(true);
    expect(result.normalized?.publishedAt).toBe('2026-09-10');
  });

  it('trims whitespace from title and excerpt', () => {
    const result = validateEvidenceProposal({ ...base, title: '  Padded  ', excerpt: '  quote  ' });
    expect(result.normalized?.title).toBe('Padded');
    expect(result.normalized?.excerpt).toBe('quote');
  });
});
