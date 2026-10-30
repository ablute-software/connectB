// Prompt 917 (I1) + Prompt 922 (Adenda 1, 29/10/2026) — which of the formats a File question can take a file really is, decided by its BYTES (the extension only has to agree).
// Built on the platform's own detection (detectAllowedKind: magic bytes, "a declared type must match the content") and tightened for the Office formats:
//   • the NEW ones (.docx, .xlsx, .pptx) are zip files inside: a zip is only accepted as Word / Excel / PowerPoint when it really holds that format's main part, so a renamed archive is refused;
//   • the OLD ones (.doc, .xls, .ppt) are OLE2 compound files (D0 CF 11 E0): which of the three it is comes from the streams INSIDE (ole2.ts) and has to agree with the extension;
//   • a file WITH MACROS is never accepted — by name (.xlsm, .docm, .pptm…), by a VBA project inside a normal-looking zip, or by a VBA storage inside an old file.
// A ZIP is never accepted as such: its content cannot be checked or read, which is why a question that needs several files takes several (or sits inside a repeatable group) instead.
// Every refusal says WHY and which formats are accepted. The malware scan is the caller's (the same one as for every other upload).
import 'server-only';
import { detectAllowedKind } from '@/lib/upload-security';
import { readZipEntry } from '@/lib/calls/ai-import/extract';
import { FILE_FORMATS, MACROS_REFUSED, contentMismatchMessage, isMacroName, notAcceptedMessage, wrongFormatMessage } from '@/lib/calls/field-config';
import { FILE_FORMAT_KEYS, type FileFormatKey } from '../types';
import { oleHasMacros, oleKindOf, readOleNames } from './ole2';

const OOXML: Record<'docx' | 'xlsx' | 'pptx', { part: string; macroPart: string; format: FileFormatKey }> = {
  docx: { part: 'word/document.xml', macroPart: 'word/vbaProject.bin', format: 'word' },
  xlsx: { part: 'xl/workbook.xml', macroPart: 'xl/vbaProject.bin', format: 'excel' },
  pptx: { part: 'ppt/presentation.xml', macroPart: 'ppt/vbaProject.bin', format: 'powerpoint' },
};
const OLE: Record<'doc' | 'xls' | 'ppt', FileFormatKey> = { doc: 'word', xls: 'excel', ppt: 'powerpoint' };
const extOf = (name: string): string => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();

export type FileCheck = { ok: true; format: FileFormatKey } | { ok: false; error: string };

/** What the file REALLY is, and whether the question takes it. */
export function checkFile(bytes: Buffer, fileName: string, accepted: FileFormatKey[]): FileCheck {
  const refuse = (error: string): FileCheck => ({ ok: false, error });
  if (isZipName(fileName)) return refuse(ZIP_REFUSED);
  if (isMacroName(fileName)) return refuse(MACROS_REFUSED);
  const ext = extOf(fileName);
  // An extension the platform has no format for: not an accepted type, whatever is inside.
  if (!FILE_FORMAT_KEYS.some((k) => FILE_FORMATS[k].extensions.includes(ext))) return refuse(notAcceptedMessage(accepted, fileName));
  const kind = detectAllowedKind(bytes, fileName);
  if (!kind) return refuse(contentMismatchMessage(accepted, fileName));

  let format: FileFormatKey | null = null;
  if (kind === 'pdf') format = 'pdf';
  else if (kind === 'jpg' || kind === 'png') format = 'image';
  else if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx') {
    const o = OOXML[kind];
    if (!readZipEntry(bytes, '[Content_Types].xml') || !readZipEntry(bytes, o.part)) return refuse(contentMismatchMessage(accepted, fileName));
    // A VBA project inside a normal-looking file, or a macro-enabled content type (a .docm saved as .docx).
    if (readZipEntry(bytes, o.macroPart) || /macroEnabled/i.test(readZipEntry(bytes, '[Content_Types].xml')?.toString('utf8') ?? '')) return refuse(MACROS_REFUSED);
    format = o.format;
  } else if (kind === 'doc' || kind === 'xls' || kind === 'ppt') {
    const names = readOleNames(bytes);
    // The streams inside say which program wrote it; it has to be the one the name says.
    if (!names || oleKindOf(names) !== kind) return refuse(contentMismatchMessage(accepted, fileName));
    if (oleHasMacros(names)) return refuse(MACROS_REFUSED);
    format = OLE[kind];
  }
  if (!format) return refuse(notAcceptedMessage(accepted, fileName));
  if (!accepted.includes(format)) return refuse(wrongFormatMessage(format, accepted));
  return { ok: true, format };
}

/** The format a file really is (any of the platform's), or null — a file that would be refused for any reason (not recognised, macros, a ZIP) is null. */
export function formatOfBytes(bytes: Buffer, fileName: string): FileFormatKey | null {
  const r = checkFile(bytes, fileName, [...FILE_FORMAT_KEYS]);
  return r.ok ? r.format : null;
}

export const ZIP_REFUSED = 'ZIP files are not accepted: their content cannot be checked. Attach the documents one by one.';
export const isZipName = (name: string): boolean => /\.zip$/i.test(name.trim());
