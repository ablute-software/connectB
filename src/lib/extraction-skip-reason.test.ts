import { describe, expect, it } from 'vitest';
import { extractionSkipReasonMessage, extractionSummarySentence } from './extraction-skip-reason';
import type { ExtractionSkipReason } from './document-extraction-pipeline';

// Prompt 463 §B.3 — every ExtractionSkipReason value must have a real
// sentence, `link_unreadable` (new in Prompt 462) included, and none of
// them silent. Listed explicitly rather than derived, so this test itself
// would need editing (and so would visibly fail to compile) the day a new
// reason is added without a matching case in the module under test.
const ALL_REASONS: ExtractionSkipReason[] = [
  'scan_unavailable', 'not_found', 'not_clean', 'not_pdf', 'too_large',
  'download_failed', 'pdf_parse_failed', 'claude_failed', 'link_unreadable',
];

describe('extractionSkipReasonMessage', () => {
  it('returns a non-empty, human sentence for every ExtractionSkipReason value', () => {
    for (const reason of ALL_REASONS) {
      const message = extractionSkipReasonMessage(reason);
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it('link_unreadable — the Prompt 462 case (a link that never returned a readable file) — reads like the prompt\'s own example', () => {
    expect(extractionSkipReasonMessage('link_unreadable')).toBe('that link did not return a readable file');
  });

  it('every reason gets a DIFFERENT sentence — no accidental collapsing of distinct failures into one generic message', () => {
    const messages = ALL_REASONS.map((r) => extractionSkipReasonMessage(r));
    expect(new Set(messages).size).toBe(ALL_REASONS.length);
  });
});

describe('extractionSummarySentence — the screen stops saying "nothing new" when something changed', () => {
  it('says nothing new only when genuinely nothing changed', () => {
    expect(extractionSummarySentence({ itemsProposed: 0, itemsEnriched: 0, competitorsBackfilled: 0, documentNames: ['A.pdf'] }))
      .toBe('Already read — nothing new in these documents.');
  });

  it('reports enrichment when no row was inserted — the exact case that read as "nothing new" in production', () => {
    expect(extractionSummarySentence({ itemsProposed: 0, itemsEnriched: 3, competitorsBackfilled: 0, documentNames: ['Competitive_Landscape_and_Moat.docx.pdf'] }))
      .toBe('Read "Competitive_Landscape_and_Moat.docx.pdf" — no new proposals, but 3 existing suggestions now carry Sherlock\'s classification.');
  });

  it('keeps the singular honest', () => {
    expect(extractionSummarySentence({ itemsProposed: 0, itemsEnriched: 1, competitorsBackfilled: 0, documentNames: ['A.pdf', 'B.pdf'] }))
      .toBe('Read 2 documents — no new proposals, but 1 existing suggestion now carries Sherlock\'s classification.');
    expect(extractionSummarySentence({ itemsProposed: 1, itemsEnriched: 0, competitorsBackfilled: 0, documentNames: ['A.pdf'] }))
      .toBe('Read "A.pdf" — 1 new proposal below.');
  });

  it('reports both when a pass did both', () => {
    expect(extractionSummarySentence({ itemsProposed: 2, itemsEnriched: 3, competitorsBackfilled: 0, documentNames: ['A.pdf', 'B.pdf'] }))
      .toBe('Read 2 documents — 2 new proposals below and 3 existing suggestions now carry Sherlock\'s classification.');
  });
});

describe('extractionSummarySentence — Prompt 483, the third destination', () => {
  it('says accepted competitors separately from proposals and from suggestions (§6)', () => {
    expect(extractionSummarySentence({ itemsProposed: 0, itemsEnriched: 0, competitorsBackfilled: 3, documentNames: ['A.pdf'] }))
      .toBe('Read "A.pdf" — no new proposals, but 3 accepted competitors now carry Sherlock\'s classification.');
  });

  it('keeps the singular honest here too', () => {
    expect(extractionSummarySentence({ itemsProposed: 0, itemsEnriched: 0, competitorsBackfilled: 1, documentNames: ['A.pdf'] }))
      .toBe('Read "A.pdf" — no new proposals, but 1 accepted competitor now carries Sherlock\'s classification.');
  });

  it('says all three when a pass did all three, in one sentence', () => {
    expect(extractionSummarySentence({ itemsProposed: 2, itemsEnriched: 3, competitorsBackfilled: 1, documentNames: ['A.pdf', 'B.pdf'] }))
      .toBe('Read 2 documents — 2 new proposals below, 3 existing suggestions now carry Sherlock\'s classification and 1 accepted competitor now carries Sherlock\'s classification.');
  });

  it('still says nothing new only when all three are zero', () => {
    expect(extractionSummarySentence({ itemsProposed: 0, itemsEnriched: 0, competitorsBackfilled: 0, documentNames: ['A.pdf'] }))
      .toBe('Already read — nothing new in these documents.');
  });
});
