import { describe, expect, it } from 'vitest';
import { buildFactualSummary } from './person-summary';

describe('buildFactualSummary', () => {
  it('returns null with no primary firm — nothing grounded enough to summarize', () => {
    expect(buildFactualSummary({
      primaryTitle: null, primaryFirmName: null, strongEvidenceCount: 0, topTopicLabel: null,
    })).toBeNull();
  });

  it('base sentence only, when there is a firm but nothing else', () => {
    expect(buildFactualSummary({
      primaryTitle: 'Partner', primaryFirmName: 'Acme Ventures', strongEvidenceCount: 0, topTopicLabel: null,
    })).toBe('Partner at Acme Ventures.');
  });

  it('falls back to an honest "unknown" rather than a blank when title is missing', () => {
    expect(buildFactualSummary({
      primaryTitle: null, primaryFirmName: 'Acme Ventures', strongEvidenceCount: 0, topTopicLabel: null,
    })).toBe('Current role unknown at Acme Ventures.');
  });

  it('adds the strong-evidence clause, singular vs plural', () => {
    expect(buildFactualSummary({
      primaryTitle: 'CEO', primaryFirmName: 'Portugal Ventures', strongEvidenceCount: 1, topTopicLabel: null,
    })).toBe('CEO at Portugal Ventures. 1 verified fact on file.');
    expect(buildFactualSummary({
      primaryTitle: 'CEO', primaryFirmName: 'Portugal Ventures', strongEvidenceCount: 20, topTopicLabel: null,
    })).toBe('CEO at Portugal Ventures. 20 verified facts on file.');
  });

  it('adds the topic clause only when a top topic exists', () => {
    expect(buildFactualSummary({
      primaryTitle: 'CEO', primaryFirmName: 'Portugal Ventures', strongEvidenceCount: 20, topTopicLabel: 'Deep tech',
    })).toBe('CEO at Portugal Ventures. 20 verified facts on file. Most associated with Deep tech.');
  });
});
