// Prompt 917 (I1) — which of the formats a File question can take a file really is, decided by its BYTES (the extension only has to agree).
// Built on the platform's own detection (detectAllowedKind: magic bytes, "a declared type must match the content") and tightened for the Office
// formats, which are zip files inside: a zip is only accepted as Word / Excel / PowerPoint when it really holds that format's main part, so a
// renamed archive is refused. A ZIP is never accepted as such: its content cannot be checked or read, which is why a question that needs several
// files takes several (or sits inside a repeatable group) instead.
import 'server-only';
import { detectAllowedKind } from '@/lib/upload-security';
import { readZipEntry } from '@/lib/calls/ai-import/extract';
import type { FileFormatKey } from '../types';

const OOXML_MAIN: Record<'docx' | 'xlsx' | 'pptx', { part: string; format: FileFormatKey }> = {
  docx: { part: 'word/document.xml', format: 'word' },
  xlsx: { part: 'xl/workbook.xml', format: 'excel' },
  pptx: { part: 'ppt/presentation.xml', format: 'powerpoint' },
};

export function formatOfBytes(bytes: Buffer, fileName: string): FileFormatKey | null {
  const kind = detectAllowedKind(bytes, fileName);
  if (kind === 'pdf') return 'pdf';
  if (kind === 'jpg' || kind === 'png') return 'image';
  if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx') {
    const o = OOXML_MAIN[kind];
    return readZipEntry(bytes, '[Content_Types].xml') && readZipEntry(bytes, o.part) ? o.format : null;
  }
  return null;
}

export const ZIP_REFUSED = 'ZIP files are not accepted: their content cannot be checked. Attach the documents one by one.';
export const isZipName = (name: string): boolean => /\.zip$/i.test(name.trim());
