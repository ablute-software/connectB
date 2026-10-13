// Prompt 909 (I4) — reading the promoter's documents before anything is sent anywhere: which format it really is
// (by its bytes, not its name), how many pages, whether a PDF has text at all, and the text of a Word or Excel file.
// No OCR (decided): a PDF that is only images of pages is refused with an explanation. Nothing here calls a provider.
import 'server-only';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';
import { IMPORT_MAX_PDF_PAGES, IMPORT_MAX_TEXT_CHARS, SCANNED_PDF_MESSAGE, type FileFormat } from './limits';

export type ExtractResult =
  | { ok: true; format: FileFormat; pages: number | null; text: string | null }
  | { ok: false; code: 'unsupported' | 'unreadable' | 'scanned' | 'too_many_pages' | 'empty' | 'too_long'; error: string };

const fail = (code: Extract<ExtractResult, { ok: false }>['code'], error: string): ExtractResult => ({ ok: false, code, error });
export const UNSUPPORTED_MESSAGE = 'Only PDF, Word (.docx) and Excel (.xlsx) files can be imported.';

// --- The format, from the bytes ---------------------------------------------------------------------------------------

const isPdf = (b: Buffer) => b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-';
const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

// --- A minimal zip reader (a .docx and an .xlsx are zips), with the limits a hostile file needs ------------------------

const MAX_ENTRY_BYTES = 30 * 1024 * 1024;

export function readZipEntry(zip: Buffer, wanted: string): Buffer | null {
  // End of central directory: scan back from the end.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  if (count > 5000) return null;
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const rawSize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === wanted) {
      if (rawSize > MAX_ENTRY_BYTES || localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const data = zip.subarray(start, start + compSize);
      try {
        if (method === 0) return Buffer.from(data);
        if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch { return null; }
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');

/** The text of a Word document: paragraphs on their own lines, table cells separated, runs joined. */
export function docxText(xml: string): string {
  return decodeXml(
    xml.replace(/<w:(?:instrText|delText)(?:\s[^>]*)?>[\s\S]*?<\/w:(?:instrText|delText)>/g, '') // field codes and deleted text are not the document
      .replace(/<w:tab\s*\/>/g, '\t').replace(/<w:br\s*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, ' | ')
      .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (_, t) => `\u0001${t}\u0002`).replace(/<[^>]+>/g, '')
      .replace(/\u0002\u0001/g, '').replace(/[\u0001\u0002]/g, ''),
  ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function xlsxText(bytes: Buffer): string {
  const wb = XLSX.read(bytes, { type: 'buffer', cellDates: true });
  const parts: string[] = [];
  for (const name of wb.SheetNames.slice(0, 20)) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false }).trim();
    if (csv) parts.push(`## Sheet: ${name}\n${csv}`);
  }
  return parts.join('\n\n');
}

// --- PDF: pages, and whether there is any text to read -----------------------------------------------------------------

/** How many characters of shown text a PDF's page streams carry (text operators Tj/TJ with string operands). */
export function pdfTextCharacters(pdf: Buffer): number {
  const raw = pdf.toString('latin1');
  let total = 0;
  const count = (content: string) => {
    for (const m of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|\[((?:\\.|[^\]\\])*)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
      if (m[1] !== undefined) total += m[1].replace(/\\./g, 'x').trim().length;
      else if (m[2] !== undefined) for (const s of m[2].matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g)) total += s[1] !== undefined ? s[1].replace(/\\./g, 'x').length : Math.floor(s[2].replace(/\s/g, '').length / 2);
      else if (m[3] !== undefined) total += Math.floor(m[3].replace(/\s/g, '').length / 2);
    }
  };
  count(raw); // content streams that are not compressed
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = (m.index ?? 0) + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    try { count(inflateSync(pdf.subarray(start, end)).toString('latin1')); } catch { /* not a Flate stream (an image, a font): nothing to read */ }
  }
  return total;
}

/** Fewer characters than this and the file is treated as having no text (a page number is not a document). */
export const PDF_MIN_TEXT_CHARACTERS = 40;

// --- The entry point ---------------------------------------------------------------------------------------------------------

export async function extractDocument(fileName: string, bytes: Buffer): Promise<ExtractResult> {
  const name = fileName.toLowerCase();
  if (isPdf(bytes)) {
    let pages: number;
    try { pages = (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).getPageCount(); }
    catch { return fail('unreadable', `We could not read “${fileName}”. Is it damaged or protected?`); }
    if (pages > IMPORT_MAX_PDF_PAGES) return fail('too_many_pages', `This PDF has ${pages} pages and the limit is ${IMPORT_MAX_PDF_PAGES}. Upload the part that matters.`);
    if (pdfTextCharacters(bytes) < PDF_MIN_TEXT_CHARACTERS) return fail('scanned', SCANNED_PDF_MESSAGE);
    return { ok: true, format: 'pdf', pages, text: null };
  }
  if (isZip(bytes)) {
    if (!readZipEntry(bytes, '[Content_Types].xml')) return fail('unreadable', `We could not read “${fileName}”. Is it damaged or protected?`);
    const doc = readZipEntry(bytes, 'word/document.xml');
    if (doc && name.endsWith('.docx')) {
      const text = docxText(doc.toString('utf8'));
      if (!text) return fail('empty', 'This file has no text to read.');
      if (text.length > IMPORT_MAX_TEXT_CHARS) return fail('too_long', 'This document is too long to read. Upload the part that matters.');
      return { ok: true, format: 'docx', pages: null, text };
    }
    if (readZipEntry(bytes, 'xl/workbook.xml') && name.endsWith('.xlsx')) {
      let text: string;
      try { text = xlsxText(bytes); } catch { return fail('unreadable', `We could not read “${fileName}”. Is it damaged or protected?`); }
      if (!text) return fail('empty', 'This file has no text to read.');
      if (text.length > IMPORT_MAX_TEXT_CHARS) return fail('too_long', 'This spreadsheet is too long to read. Upload the sheets that matter.');
      return { ok: true, format: 'xlsx', pages: null, text };
    }
  }
  return fail('unsupported', UNSUPPORTED_MESSAGE);
}
