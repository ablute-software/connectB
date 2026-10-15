// Prompt 909 (Adenda 2b) — the text of a PDF, page by page, instead of the file: when it can be trusted, and when the PDF goes whole after all.
import { describe, expect, it } from 'vitest';
import { PDF_MIN_TEXT_PER_PAGE, extractDocument, pdfPageTexts } from './extract';
import { scannedPdf, textPdf } from './test-fixtures';

const LINES = ['Application form of the call', '1. Name of the company', '2. Website of the company, if there is one', '3. Number of people in the team today'];

describe('a PDF with readable text', () => {
  it('gives the text page by page, and the document carries it for the reader', async () => {
    const bytes = await textPdf(LINES, 3);
    const pages = await pdfPageTexts(bytes);
    expect(pages).toHaveLength(3);
    for (const p of pages!) { expect(p).toContain('1. Name of the company'); expect(p).toContain('3. Number of people in the team today'); }
    const doc = await extractDocument('form.pdf', bytes);
    expect(doc).toMatchObject({ ok: true, format: 'pdf', pages: 3, pageTexts: expect.any(Array), text: expect.stringContaining('Application form of the call') });
  });
});

describe('a PDF whose text cannot be trusted', () => {
  it('too little text for its pages: no text — the PDF is sent as a file, as before (and it is still not refused as a scan)', async () => {
    const bytes = await textPdf(['A form with some words in it, enough.'], 2);          // above the "is there any text" bar, below the per-page bar
    expect(await pdfPageTexts(bytes)).toBeNull();
    expect(PDF_MIN_TEXT_PER_PAGE).toBeGreaterThan(30);
    expect(await extractDocument('form.pdf', bytes)).toMatchObject({ ok: true, format: 'pdf', text: null });
  });
  it('a scan is still refused before anything else; and a file that is not a PDF never throws', async () => {
    expect(await extractDocument('scan.pdf', await scannedPdf(2))).toMatchObject({ ok: false, code: 'scanned' });
    expect(await pdfPageTexts(Buffer.from('%PDF-1.4 not really'))).toBeNull();
  });
});
