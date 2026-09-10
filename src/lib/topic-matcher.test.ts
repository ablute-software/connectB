import { describe, expect, it } from 'vitest';
import { matchTopics, type TopicNode } from './topic-matcher';

const ONCOLOGY: TopicNode = { id: 'oncology', synonyms: ['oncology', 'oncologia', 'oncología', 'cancer', 'cancro', 'cáncer'] };
const BREAST_CANCER: TopicNode = { id: 'oncology-breast-cancer', synonyms: ['breast cancer', 'cancro da mama', 'cáncer de mama'] };
const PROSTATE_CANCER: TopicNode = { id: 'oncology-prostate-cancer', synonyms: ['prostate cancer', 'cancro da próstata', 'cáncer de próstata'] };
const EARLY_DETECTION: TopicNode = { id: 'diagnostics-early-detection', synonyms: ['early detection', 'deteção precoce', 'detección precoz'] };
const BIOMARKERS: TopicNode = { id: 'diagnostics-biomarkers', synonyms: ['biomarkers', 'biomarcadores'] };

const TAXONOMY = [ONCOLOGY, BREAST_CANCER, PROSTATE_CANCER, EARLY_DETECTION, BIOMARKERS];

describe('matchTopics', () => {
  it('EN: matches two distinct, non-overlapping topics in the same text', () => {
    const matches = matchTopics('She spoke about early detection of breast cancer in her podcast.', TAXONOMY);
    expect(matches.map((m) => m.topicId)).toEqual(['diagnostics-early-detection', 'oncology-breast-cancer']);
  });

  it('PT with diacritics: matches accented synonyms after normalization', () => {
    const matches = matchTopics('Ela falou sobre deteção precoce do cancro da mama.', TAXONOMY);
    expect(matches.map((m) => m.topicId)).toEqual(['diagnostics-early-detection', 'oncology-breast-cancer']);
  });

  it('ES with diacritics: matches accented synonyms after normalization', () => {
    const matches = matchTopics('Habló sobre el cáncer de próstata en la conferencia.', TAXONOMY);
    expect(matches).toEqual([{ topicId: 'oncology-prostate-cancer', matchedTerm: 'cáncer de próstata', position: expect.any(Number) }]);
  });

  it('longest match wins over a shorter overlapping synonym for a different topic', () => {
    // "cancer" alone would match ONCOLOGY; "breast cancer" is longer and
    // overlaps it — only the specific topic should be returned, not both.
    const matches = matchTopics('A story about breast cancer research.', TAXONOMY);
    expect(matches.map((m) => m.topicId)).toEqual(['oncology-breast-cancer']);
  });

  it('known accepted false positive: a bare "cancer" substring still marks oncology when nothing longer overlaps', () => {
    const matches = matchTopics('A grant from Cancer Research UK funded the study.', TAXONOMY);
    expect(matches.map((m) => m.topicId)).toEqual(['oncology']);
  });

  it('plural/singular: single-word synonym matches both forms', () => {
    expect(matchTopics('The panel discussed novel biomarker discovery.', TAXONOMY).map((m) => m.topicId)).toEqual(['diagnostics-biomarkers']);
    expect(matchTopics('The panel discussed novel biomarkers.', TAXONOMY).map((m) => m.topicId)).toEqual(['diagnostics-biomarkers']);
  });

  it('returns zero tags for text with no matching terms', () => {
    expect(matchTopics('The weather in Lisbon was lovely this week.', TAXONOMY)).toEqual([]);
  });

  it('returns zero tags for empty text', () => {
    expect(matchTopics('', TAXONOMY)).toEqual([]);
    expect(matchTopics('   ', TAXONOMY)).toEqual([]);
  });

  it('one match per topic even when a synonym appears twice', () => {
    const matches = matchTopics('Breast cancer research. More on breast cancer later.', TAXONOMY);
    expect(matches).toHaveLength(1);
    expect(matches[0].topicId).toBe('oncology-breast-cancer');
    expect(matches[0].position).toBe(0);
  });

  it('word-boundary safe: does not match a synonym as a substring of an unrelated word', () => {
    // "oncologically" contains "oncolog" but not the whole-word "oncology".
    expect(matchTopics('This drug behaves oncologically inert.', TAXONOMY)).toEqual([]);
  });
});
