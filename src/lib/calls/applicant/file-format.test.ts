// Prompt 922 (Adenda 1, 29/10/2026) — what a file REALLY is, decided by its bytes: Excel is .xls and .xlsx, Word is .doc and .docx, PowerPoint is .ppt and .pptx. The old ones are OLE2 compound files (D0 CF 11 E0): the
// streams inside say which of the three it is, and it has to agree with the extension. A file with macros is never accepted (by name, by a VBA project inside a normal-looking zip, by a VBA storage inside an old file),
// and every refusal says why and which formats are accepted. One file of each format, old and new, and several with macros.
import { describe, expect, it } from 'vitest';
import { cfbOf, docOf, docxOf, pptOf, pptxOf, xlsOf, xlsxOf, zipOf } from '@/test/office-files';
import { checkFile, formatOfBytes } from './file-format';
import { isOle2, oleHasMacros, oleKindOf, readOleNames } from './ole2';
import { MACROS_REFUSED, acceptedFilesText, mimeOfName } from '../field-config';
import type { FileFormatKey } from '../types';

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ALL: FileFormatKey[] = ['pdf', 'word', 'excel', 'powerpoint', 'image'];

describe('one file of each format, new and old, is recognised by what it holds', () => {
  const cases: [string, Buffer, FileFormatKey][] = [
    ['deck.pdf', PDF, 'pdf'], ['logo.png', PNG, 'image'],
    ['cv.docx', docxOf(), 'word'], ['cv.doc', docOf(), 'word'],
    ['plan.xlsx', xlsxOf(), 'excel'], ['plan.xls', xlsOf(), 'excel'],
    ['pitch.pptx', pptxOf(), 'powerpoint'], ['pitch.ppt', pptOf(), 'powerpoint'],
  ];
  for (const [name, bytes, format] of cases) {
    it(`${name} is ${format}`, () => {
      expect(checkFile(bytes, name, ALL)).toEqual({ ok: true, format });
      expect(checkFile(bytes, name, [format])).toEqual({ ok: true, format });
      expect(formatOfBytes(bytes, name)).toBe(format);
    });
  }
  it('an Excel question takes both Excel formats — the old .xls was refused before', () => {
    expect(checkFile(xlsOf(), 'plan.xls', ['excel'])).toEqual({ ok: true, format: 'excel' });
    expect(checkFile(xlsxOf(), 'plan.xlsx', ['excel'])).toEqual({ ok: true, format: 'excel' });
  });
  it('the extension is not case-sensitive', () => { expect(checkFile(xlsOf(), 'PLAN.XLS', ['excel'])).toEqual({ ok: true, format: 'excel' }); });
  it('the content type said for each is the right one', () => {
    expect(mimeOfName('a.xls')).toBe('application/vnd.ms-excel'); expect(mimeOfName('a.doc')).toBe('application/msword'); expect(mimeOfName('a.ppt')).toBe('application/vnd.ms-powerpoint');
    expect(mimeOfName('a.xlsx')).toContain('spreadsheetml'); expect(mimeOfName('a.png')).toBe('image/png'); expect(mimeOfName('a.jpeg')).toBe('image/jpeg');
  });
});

describe('the old formats are told apart by the streams inside, and must agree with the name', () => {
  it('an .xls that is really a Word file, a .doc that is really Excel, a .ppt that is really Word — refused, in words', () => {
    for (const [name, bytes] of [['plan.xls', docOf()], ['cv.doc', xlsOf()], ['pitch.ppt', docOf()], ['cv.doc', pptOf()]] as const) {
      const r = checkFile(bytes, name, ALL);
      expect(r, name).toMatchObject({ ok: false });
      expect(!r.ok && r.error, name).toContain(`The content of “${name}” is not what its name says`);
    }
  });
  it('a compound file that is none of the three (an installer, an Outlook message) is refused even with an Office name', () => {
    const other = cfbOf([{ name: '__properties_version1.0', type: 2 }, { name: '__substg1.0_0037001F', type: 2 }]);
    expect(checkFile(other, 'plan.xls', ALL)).toMatchObject({ ok: false });
    expect(oleKindOf(readOleNames(other)!)).toBeNull();
  });
  it('the old name on a zip, a zip name on an old file, a damaged compound file, a text file called .xls — all refused', () => {
    expect(checkFile(xlsxOf(), 'plan.xls', ALL)).toMatchObject({ ok: false });
    expect(checkFile(xlsOf(), 'plan.xlsx', ALL)).toMatchObject({ ok: false });
    const damaged = Buffer.from(xlsOf()); damaged.writeUInt32LE(0xdeadbeef, 0x30);                  // the directory starts in a sector that does not exist
    expect(checkFile(damaged, 'plan.xls', ALL)).toMatchObject({ ok: false });
    expect(checkFile(Buffer.from('a,b,c\n1,2,3\n'), 'plan.xls', ALL)).toMatchObject({ ok: false });
    expect(checkFile(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'plan.xls', ALL)).toMatchObject({ ok: false });   // the signature and nothing else
  });
  it('a hostile directory (a chain that loops) ends, and gives nothing', () => {
    const loop = Buffer.from(xlsOf());
    loop.writeUInt32LE(1, 512 + 4);                                                                 // FAT[1] → 1: the directory chain points at itself
    expect(readOleNames(loop)).toBeNull();
  });
  it('the signature is recognised, and only with a header the size of one', () => {
    expect(isOle2(xlsOf())).toBe(true); expect(isOle2(Buffer.from('%PDF-1.7'))).toBe(false); expect(isOle2(Buffer.alloc(100))).toBe(false);
  });
});

describe('files with macros are never accepted', () => {
  it('by name: .xlsm, .docm, .pptm (and the template and add-in variants), whatever is inside', () => {
    for (const name of ['plan.xlsm', 'cv.docm', 'pitch.pptm', 'a.xltm', 'a.dotm', 'a.potm', 'a.xlam', 'a.ppsm', 'a.sldm', 'PLAN.XLSM']) {
      expect(checkFile(xlsxOf(), name, ALL), name).toEqual({ ok: false, error: MACROS_REFUSED });
    }
    expect(MACROS_REFUSED).toBe('Files with macros are not accepted. Save it as a normal Excel/Word/PowerPoint file and upload again.');
  });
  it('a normal-looking .xlsx / .docx / .pptx that holds a VBA project is refused', () => {
    expect(checkFile(xlsxOf({ 'xl/vbaProject.bin': Buffer.from([1, 2, 3]) }), 'plan.xlsx', ALL)).toEqual({ ok: false, error: MACROS_REFUSED });
    expect(checkFile(docxOf({ 'word/vbaProject.bin': Buffer.from([1, 2, 3]) }), 'cv.docx', ALL)).toEqual({ ok: false, error: MACROS_REFUSED });
    expect(checkFile(pptxOf({ 'ppt/vbaProject.bin': Buffer.from([1, 2, 3]) }), 'pitch.pptx', ALL)).toEqual({ ok: false, error: MACROS_REFUSED });
  });
  it('a macro-enabled content type saved under a normal name (a .docm renamed .docx) is refused', () => {
    expect(checkFile(docxOf({}, '<Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>'), 'cv.docx', ALL)).toEqual({ ok: false, error: MACROS_REFUSED });
    expect(checkFile(xlsxOf({}, '<Types><Override ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>'), 'plan.xlsx', ALL)).toEqual({ ok: false, error: MACROS_REFUSED });
  });
  it('an old .xls / .doc / .ppt that holds a VBA project is refused (the platform\'s own scan of its structure)', () => {
    expect(checkFile(xlsOf([{ name: '_VBA_PROJECT_CUR', type: 1 }, { name: 'VBA', type: 1 }]), 'plan.xls', ALL)).toEqual({ ok: false, error: MACROS_REFUSED });
    expect(checkFile(docOf([{ name: 'Macros', type: 1 }, { name: 'VBA', type: 1 }]), 'cv.doc', ALL)).toEqual({ ok: false, error: MACROS_REFUSED });
    expect(checkFile(pptOf([{ name: 'VBA', type: 1 }]), 'pitch.ppt', ALL)).toEqual({ ok: false, error: MACROS_REFUSED });
    expect(oleHasMacros(readOleNames(xlsOf([{ name: 'VBA', type: 1 }]))!)).toBe(true);
    expect(oleHasMacros(readOleNames(xlsOf())!)).toBe(false);
    expect(formatOfBytes(xlsOf([{ name: 'VBA', type: 1 }]), 'plan.xls')).toBeNull();
  });
});

describe('every refusal says why, and which formats are accepted', () => {
  it('a real file of ANOTHER format: it says what it is and what the question takes', () => {
    expect(checkFile(docOf(), 'cv.doc', ['excel'])).toEqual({ ok: false, error: 'This file is a Word document, but this question accepts Excel files (.xlsx, .xls).' });
    expect(checkFile(xlsOf(), 'plan.xls', ['pdf', 'word'])).toEqual({ ok: false, error: 'This file is an Excel workbook, but this question accepts PDF or Word files (.pdf, .docx, .doc).' });
    expect(checkFile(pptxOf(), 'deck.pptx', ['pdf'])).toEqual({ ok: false, error: 'This file is a PowerPoint presentation, but this question accepts PDF files (.pdf).' });
    expect(checkFile(PDF, 'deck.pdf', ['word', 'excel'])).toMatchObject({ ok: false, error: 'This file is a PDF, but this question accepts Word or Excel files (.docx, .doc, .xlsx, .xls).' });
  });
  it('a type the platform has no format for, a renamed or damaged file, a ZIP', () => {
    expect(checkFile(Buffer.from('hello'), 'notes.txt', ['excel'])).toEqual({ ok: false, error: '“notes.txt” is not an accepted file type. This question accepts Excel files (.xlsx, .xls).' });
    expect(checkFile(Buffer.from('MZ\u0090\u0000'), 'plan.xlsx', ['excel'])).toEqual({ ok: false, error: 'The content of “plan.xlsx” is not what its name says (a renamed or damaged file), so it cannot be accepted. This question accepts Excel files (.xlsx, .xls).' });
    expect(checkFile(zipOf({ 'a.txt': 'x' }), 'plan.xlsx', ['excel'])).toMatchObject({ ok: false });                       // a zip with no workbook inside
    expect(checkFile(zipOf({ 'a.txt': 'x' }), 'archive.zip', ['excel'])).toMatchObject({ ok: false, error: expect.stringContaining('ZIP files are not accepted') });
  });
  it('the accepted formats are listed with their extensions', () => {
    expect(acceptedFilesText(['excel'])).toBe('Excel files (.xlsx, .xls)');
    expect(acceptedFilesText(['pdf', 'word', 'powerpoint'])).toBe('PDF, Word or PowerPoint files (.pdf, .docx, .doc, .pptx, .ppt)');
  });
});
