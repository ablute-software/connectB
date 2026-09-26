import { describe, expect, it } from 'vitest';
import { EVIDENCE_KIND_LABELS, evidenceKindLabel, evidenceStatusLabel } from './evidence-labels';

const ALL_13_KINDS = [
  'bio', 'interview', 'podcast', 'talk_event', 'article_authored', 'article_about',
  'statement', 'press_release', 'investment', 'fund_announcement', 'social_post', 'photo', 'other',
];

describe('evidenceKindLabel', () => {
  it('covers all 13 evidence_kind values with a real EN and PT label', () => {
    for (const kind of ALL_13_KINDS) {
      expect(EVIDENCE_KIND_LABELS[kind]).toBeDefined();
      expect(evidenceKindLabel(kind, 'en')).not.toBe(kind);
      expect(evidenceKindLabel(kind, 'pt')).not.toBe(kind);
    }
  });

  it('defaults to English', () => {
    expect(evidenceKindLabel('bio')).toBe('Biography');
  });

  it('falls back to the raw kind for an unknown value rather than throwing', () => {
    expect(evidenceKindLabel('made_up_kind')).toBe('made_up_kind');
  });
});

describe('evidenceStatusLabel', () => {
  it('labels the two statuses the dossier actually reads', () => {
    expect(evidenceStatusLabel('found')).toBe('To confirm');
    expect(evidenceStatusLabel('verified')).toBe('Verified');
  });
});
