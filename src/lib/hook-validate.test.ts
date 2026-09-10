import { describe, expect, it } from 'vitest';
import { parseHookOutput, validateHookOutput } from './hook-validate';
import type { HookPackEvidence } from './hook-pack';

const evidencePool: HookPackEvidence[] = [
  { id: 'ev-1', kind: 'podcast', title: 'Talked about early cancer detection', publishedAt: '2026-01-01', excerpt: 'She discussed early cancer detection at length', topics: ['oncology'], isPersonal: false },
  { id: 'ev-personal', kind: 'statement', title: 'Personal note', publishedAt: null, excerpt: 'family health matter', topics: [], isPersonal: true },
];

describe('parseHookOutput', () => {
  it('defaults to verdict none for a malformed response', () => {
    expect(parseHookOutput(undefined).verdict).toBe('none');
    expect(parseHookOutput({}).verdict).toBe('none');
  });

  it('parses a well-formed strong verdict', () => {
    const parsed = parseHookOutput({
      verdict: 'strong', hook_text: 'Saw you discussed early cancer detection.',
      claims: [{ text: 'discussed early cancer detection', evidence_ids: ['ev-1'] }],
    });
    expect(parsed.verdict).toBe('strong');
    expect(parsed.claims).toEqual([{ text: 'discussed early cancer detection', evidenceIds: ['ev-1'] }]);
  });

  it('rejects an unrecognized verdict string, falling back to none', () => {
    expect(parseHookOutput({ verdict: 'maybe' }).verdict).toBe('none');
  });
});

describe('validateHookOutput', () => {
  const base = { evidencePool, charLimit: 900, killWords: ['guarantee'], targetKind: 'person' as const };

  it('accepts verdict none without checking anything else', () => {
    const result = validateHookOutput({ ...base, parsed: parseHookOutput({ verdict: 'none', reason_if_none: 'nothing specific' }) });
    expect(result.ok).toBe(true);
  });

  it('accepts a claim whose sentence overlaps the claim text and cites real evidence', () => {
    const parsed = parseHookOutput({
      verdict: 'strong', hook_text: 'Saw you discussed early cancer detection recently.',
      claims: [{ text: 'discussed early cancer detection', evidence_ids: ['ev-1'] }],
    });
    const result = validateHookOutput({ ...base, parsed });
    expect(result.ok).toBe(true);
  });

  it('rejects a claim citing an evidence id not in the pool', () => {
    const parsed = parseHookOutput({
      verdict: 'strong', hook_text: 'Saw you discussed early cancer detection.',
      claims: [{ text: 'discussed early cancer detection', evidence_ids: ['ev-does-not-exist'] }],
    });
    const result = validateHookOutput({ ...base, parsed });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("isn't in the pack"))).toBe(true);
  });

  it('rejects a claim with no evidence id at all', () => {
    const parsed = parseHookOutput({
      verdict: 'strong', hook_text: 'Some claim.',
      claims: [{ text: 'Some claim', evidence_ids: [] }],
    });
    const result = validateHookOutput({ ...base, parsed });
    expect(result.ok).toBe(false);
  });

  it('rejects a sentence with no supporting claim', () => {
    const parsed = parseHookOutput({
      verdict: 'strong', hook_text: 'Saw you discussed early cancer detection. Also I heard you love unrelated skydiving adventures.',
      claims: [{ text: 'discussed early cancer detection', evidence_ids: ['ev-1'] }],
    });
    const result = validateHookOutput({ ...base, parsed });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Sentence not traceable'))).toBe(true);
  });

  it('rejects a kill word appearing in the hook text', () => {
    const parsed = parseHookOutput({
      verdict: 'strong', hook_text: 'We guarantee this will work for your fund.',
      claims: [{ text: 'guarantee this will work for your fund', evidence_ids: ['ev-1'] }],
    });
    const result = validateHookOutput({ ...base, parsed });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('kill word'))).toBe(true);
  });

  it('rejects hook_text over the channel char limit', () => {
    const parsed = parseHookOutput({
      verdict: 'strong', hook_text: 'x'.repeat(50),
      claims: [{ text: 'x'.repeat(50), evidence_ids: ['ev-1'] }],
    });
    const result = validateHookOutput({ ...base, charLimit: 10, parsed });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds'))).toBe(true);
  });

  it('rejects an entity-target hook citing personal evidence', () => {
    const parsed = parseHookOutput({
      verdict: 'strong', hook_text: 'A family health matter came up.',
      claims: [{ text: 'family health matter', evidence_ids: ['ev-personal'] }],
    });
    const result = validateHookOutput({ ...base, targetKind: 'entity', parsed });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('personal evidence'))).toBe(true);
  });

  it('rejects an empty hook_text when verdict is not none', () => {
    const parsed = parseHookOutput({ verdict: 'weak', hook_text: '', claims: [] });
    const result = validateHookOutput({ ...base, parsed });
    expect(result.ok).toBe(false);
  });
});
