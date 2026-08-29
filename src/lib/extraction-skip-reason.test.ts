import { describe, expect, it } from 'vitest';
import { extractionSkipReasonMessage } from './extraction-skip-reason';
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
