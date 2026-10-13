// Prompt 909 (I4) — documents for the tests, made on the fly: a PDF with text, a PDF that is only the image of a
// page (a scan), a Word file, an Excel file. Test-only helper (not imported by the application).
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as XLSX from 'xlsx';

/** A 1x1 PNG: enough to put an image on a page without any text. */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export async function textPdf(lines: string[], pages = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([595, 842]);
    lines.forEach((l, i) => page.drawText(l, { x: 40, y: 800 - i * 16, size: 11, font }));
  }
  return Buffer.from(await pdf.save());
}

/** A scan: every page is an image and nothing else (no text operators at all). */
export async function scannedPdf(pages = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const img = await pdf.embedPng(PNG_1X1);
  for (let p = 0; p < pages; p++) { const page = pdf.addPage([595, 842]); page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 }); }
  return Buffer.from(await pdf.save());
}

// --- a minimal zip writer (stored, no compression): enough for a .docx --------------------------------------------------

function zip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameB = Buffer.from(name); const data = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameB.length, 26);
    parts.push(local, nameB, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameB.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A Word file whose paragraphs are the given lines; a line may be split in several runs with `|`. */
export function docx(paragraphs: string[], extraXml = ''): Buffer {
  const body = paragraphs.map((p) => `<w:p>${p.split('|').map((r) => `<w:r><w:t xml:space="preserve">${esc(r)}</w:t></w:r>`).join('')}</w:p>`).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${extraXml}</w:body></w:document>`,
  });
}

export function xlsx(sheets: Record<string, string[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
