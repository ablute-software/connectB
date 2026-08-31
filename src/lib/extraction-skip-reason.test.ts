import { describe, expect, it } from 'vitest';
import { crossDocumentNoticeSentence, extractionSkipReasonMessage, extractionSummarySentence } from './extraction-skip-reason';
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

// ---------------------------------------------------------------------------
// Prompt 495 — the number Prompt 492 started counting, finally said out loud.
//
// This is the whole client-visible decision, tested where it can be tested:
// this project has no jsdom, no @testing-library and no JSX transform for
// vitest, so the rule "what does the founder see" is pinned in the pure
// module the component calls, not by rendering the component.

describe('crossDocumentNoticeSentence — Prompt 495', () => {
  it('says nothing at all when there were no cross-document collisions', () => {
    // The prompt's own criterion, and it is not a formality: a reassurance
    // line on every ordinary pass would be a sentence to read in exchange
    // for nothing, which is exactly the weight the Sherlock golden rule
    // exists to remove. null, not '' — so the component's `&&` renders no
    // element rather than an empty paragraph holding vertical space.
    expect(crossDocumentNoticeSentence(0)).toBeNull();
  });

  it('never speaks for a negative or nonsense count either', () => {
    expect(crossDocumentNoticeSentence(-1)).toBeNull();
  });

  it('says the line when there was one', () => {
    expect(crossDocumentNoticeSentence(1)).toBe(
      'Sherlock also noticed 1 item that matched something already on file,'
      + " from a different document — worth a second look if that's not what you'd expect.",
    );
  });

  it('agrees with itself in the plural', () => {
    expect(crossDocumentNoticeSentence(3)).toBe(
      'Sherlock also noticed 3 items that matched something already on file,'
      + " from a different document — worth a second look if that's not what you'd expect.",
    );
  });

  it('never claims to know what the swallowed proposal said', () => {
    // The reason Prompt 492 exists is that the two readings were NEVER
    // compared and the losing one was never stored. A sentence hinting at
    // the content would be inventing it (invariable 7).
    const line = crossDocumentNoticeSentence(2)!;
    for (const forbidden of ['contained', 'said', 'about', 'value', 'number']) {
      expect(line.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('stays out of the alarm register — this is a notice, not a failure', () => {
    // Tone is the feature here, so it is pinned rather than left to the
    // next editor's judgement. "Perdido"/"falhou"/"erro" are explicitly out
    // of tone per the prompt.
    const line = crossDocumentNoticeSentence(5)!;
    for (const forbidden of ['lost', 'fail', 'error', 'warning', 'problem', 'wrong', 'should have']) {
      expect(line.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('is a separate statement from what the pass achieved', () => {
    // extractionSummarySentence answers "what did this pass do"; this one
    // answers "what could it not tell you". Keeping them apart is what stops
    // a swallowed proposal being read as a fourth kind of win.
    const achieved = extractionSummarySentence({
      itemsProposed: 0, itemsEnriched: 0, competitorsBackfilled: 0, documentNames: ['A deck.pdf'],
    });
    expect(achieved).toBe('Already read — nothing new in these documents.');
    expect(achieved).not.toContain('already on file');
    expect(crossDocumentNoticeSentence(2)).toContain('already on file');
  });
});
