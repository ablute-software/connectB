// Prompt 463 §B.3 — one sentence per ExtractionSkipReason, so a skipped
// document is always named and explained, never dropped in silence. No
// 'server-only': this is imported by MarketDataPanel.tsx (a client
// component) — only a type-only import from document-extraction-pipeline.ts
// below, erased at compile time, so the server-only boundary there is never
// crossed at runtime. Same already-established pattern as market-data-gate.ts,
// a pure function imported by both a client component and a server route.
//
// The switch has no default on purpose: with every ExtractionSkipReason
// literal covered and each case returning, TypeScript proves the function
// always returns a string — a future 10th reason with no case here fails
// tsc, not just a missed test. That's the "sem caminho silencioso" the
// prompt asks for, enforced at compile time, not only by the test below.
import type { ExtractionSkipReason } from './document-extraction-pipeline';

export function extractionSkipReasonMessage(reason: ExtractionSkipReason): string {
  switch (reason) {
    case 'scan_unavailable': return 'security scanning is not available right now';
    case 'not_found': return 'that document could not be found';
    case 'not_clean': return 'that document has not cleared its security scan yet';
    case 'not_pdf': return 'that document is not a PDF';
    case 'too_large': return 'that document is too large to read';
    case 'download_failed': return 'that document could not be downloaded';
    case 'pdf_parse_failed': return 'that PDF could not be opened';
    case 'claude_failed': return 'reading that document failed — try again';
    case 'link_unreadable': return 'that link did not return a readable file';
  }
}
