// Prompt 313 §A — Anthropic's `document` content block takes only raw bytes
// (no page-range parameter in the block schema itself — confirmed before
// adding this), so "send only the first N pages" of a long PDF can only be
// done by producing a genuinely shorter PDF before base64-encoding it. This
// is the only PDF-manipulation code in the app (nda-upload/gap-assist send
// whichever bytes they're given, unmodified) — pdf-lib is a new dependency
// added specifically for this, not a parser: it only copies whole pages,
// never reads or reinterprets their content.
import 'server-only';
import { PDFDocument } from 'pdf-lib';

export interface TruncatedPdf { bytes: Buffer; pagesRead: number; totalPages: number }

export async function truncatePdfToPages(bytes: Buffer, maxPages: number): Promise<TruncatedPdf> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPages = doc.getPageCount();
  if (totalPages <= maxPages) return { bytes, pagesRead: totalPages, totalPages };

  const truncated = await PDFDocument.create();
  const indices = Array.from({ length: maxPages }, (_, i) => i);
  const pages = await truncated.copyPages(doc, indices);
  for (const page of pages) truncated.addPage(page);
  const outBytes = Buffer.from(await truncated.save());
  return { bytes: outBytes, pagesRead: maxPages, totalPages };
}
