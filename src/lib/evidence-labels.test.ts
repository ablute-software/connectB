import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_KIND_LABELS, evidenceKindLabel, evidenceStatusLabel,
  researchScopeLabel, roleTypeLabel,
} from './evidence-labels';

const ALL_16_KINDS = [
  'bio', 'interview', 'podcast', 'talk_event', 'article_authored', 'article_about',
  'statement', 'press_release', 'investment', 'fund_announcement', 'social_post', 'photo', 'other',
  'role_history', 'education', 'portfolio_relationship',
];

describe('evidenceKindLabel', () => {
  it('covers all 16 evidence_kind values (13 original + Passo 3\'s 3) with a real EN and PT label', () => {
    for (const kind of ALL_16_KINDS) {
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

describe('roleTypeLabel', () => {
  it('labels both role_type_kind values', () => {
    expect(roleTypeLabel('employment')).toBe('Executive / employment');
    expect(roleTypeLabel('board_advisory')).toBe('Board / advisory');
  });

  it('returns null for null/undefined rather than a placeholder — role_type is only ever set for role_history', () => {
    expect(roleTypeLabel(null)).toBeNull();
    expect(roleTypeLabel(undefined)).toBeNull();
  });
});

describe('researchScopeLabel', () => {
  it('covers all 11 research_scope values', () => {
    const scopes = [
      'career', 'education', 'board_seats', 'statements', 'interviews',
      'articles', 'podcasts', 'events', 'topics', 'portfolio', 'personal_signals',
    ];
    for (const s of scopes) {
      expect(researchScopeLabel(s)).not.toBe(s);
    }
  });
});
