// Prompt 691 — a renamed Vault display name must never make an otherwise-
// readable PDF unreadable. Confirmed in production: "Market Comparison"
// (renamed from "SherlockDeal_Market_Comparison_Sep2026.pdf") failed every
// extraction route sharing prepareDocumentForAi, while storage_path still
// correctly ended in .pdf the whole time.
import { describe, expect, it } from 'vitest';
import { isPdfDocument } from './document-extraction-pipeline';

describe('isPdfDocument', () => {
  it('accepts a normal upload — both name and storage_path end in .pdf', () => {
    expect(isPdfDocument('deck.pdf', 'org/uuid-deck.pdf')).toBe(true);
  });

  it('accepts a document renamed to a display label with no extension, as long as storage_path still has one', () => {
    expect(isPdfDocument('Market Comparison', 'org/uuid-SherlockDeal_Market_Comparison_Sep2026.pdf')).toBe(true);
  });

  it('falls back to name when storage_path itself has no extension', () => {
    expect(isPdfDocument('report.pdf', 'org/uuid-report')).toBe(true);
  });

  it('rejects a genuinely non-PDF file', () => {
    expect(isPdfDocument('notes.docx', 'org/uuid-notes.docx')).toBe(false);
  });

  it('rejects when neither name nor storage_path indicates a PDF', () => {
    expect(isPdfDocument('Market Comparison', 'org/uuid-notes')).toBe(false);
  });

  it('handles a null name — storage_path alone is enough', () => {
    expect(isPdfDocument(null, 'org/uuid-deck.pdf')).toBe(true);
  });
});
