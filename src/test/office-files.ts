// Prompt 922 (Adenda 1, 29/10/2026) — small REAL Office files for the tests, built byte by byte: a zip (the new formats are zips inside) and an OLE2 compound file (the old ones), with only the parts the platform's
// detection looks at. Test-only.
import { OLE2_SIGNATURE } from '@/lib/calls/applicant/ole2';

/** A zip with every entry stored (no compression): enough for the platform's own zip reader. */
export function zipOf(entries: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30 + nameBytes.length + data.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30); data.copy(local, 30 + nameBytes.length);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42); nameBytes.copy(central, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(centrals.length, 8); eocd.writeUInt16LE(centrals.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

export const docxOf = (extra: Record<string, string | Buffer> = {}, contentTypes = '<Types/>'): Buffer => zipOf({ '[Content_Types].xml': contentTypes, 'word/document.xml': '<w:document/>', ...extra });
export const xlsxOf = (extra: Record<string, string | Buffer> = {}, contentTypes = '<Types/>'): Buffer => zipOf({ '[Content_Types].xml': contentTypes, 'xl/workbook.xml': '<workbook/>', ...extra });
export const pptxOf = (extra: Record<string, string | Buffer> = {}, contentTypes = '<Types/>'): Buffer => zipOf({ '[Content_Types].xml': contentTypes, 'ppt/presentation.xml': '<presentation/>', ...extra });

const NONE = 0xffffffff;
/** An OLE2 compound file (512-byte sectors) with a root entry and the named storages (type 1) and streams (type 2). */
export function cfbOf(entries: { name: string; type: 1 | 2 }[]): Buffer {
  const all = [{ name: 'Root Entry', type: 5 }, ...entries];
  const dirSectors = Math.ceil(all.length / 4);
  const buf = Buffer.alloc(512 * (2 + dirSectors), 0);
  Buffer.from(OLE2_SIGNATURE).copy(buf, 0);
  buf.writeUInt16LE(0x3e, 0x18); buf.writeUInt16LE(3, 0x1a); buf.writeUInt16LE(0xfffe, 0x1c); buf.writeUInt16LE(9, 0x1e); buf.writeUInt16LE(6, 0x20);
  buf.writeUInt32LE(1, 0x2c); buf.writeUInt32LE(1, 0x30); buf.writeUInt32LE(4096, 0x38); buf.writeUInt32LE(0xfffffffe, 0x3c); buf.writeUInt32LE(0xfffffffe, 0x44); buf.writeUInt32LE(0, 0x48);
  buf.writeUInt32LE(0, 0x4c); for (let i = 1; i < 109; i++) buf.writeUInt32LE(NONE, 0x4c + i * 4);
  // sector 0 = the FAT: itself, then the directory chain 1 → 2 → … → end
  const fat = 512;
  for (let i = 0; i < 128; i++) buf.writeUInt32LE(NONE, fat + i * 4);
  buf.writeUInt32LE(0xfffffffd, fat);
  for (let i = 1; i <= dirSectors; i++) buf.writeUInt32LE(i < dirSectors ? i + 1 : 0xfffffffe, fat + i * 4);
  all.forEach((e, i) => {
    const p = 512 * 2 + i * 128;
    const name = Buffer.from(e.name, 'utf16le');
    name.copy(buf, p);
    buf.writeUInt16LE(name.length + 2, p + 64); buf[p + 66] = e.type; buf[p + 67] = 1;
    buf.writeUInt32LE(NONE, p + 68); buf.writeUInt32LE(NONE, p + 72); buf.writeUInt32LE(NONE, p + 76);
  });
  return buf;
}

/** The streams a real file of each old format holds (and the ones a macro project adds). */
export const XLS_STREAMS = [{ name: 'Workbook', type: 2 as const }, { name: '\u0005SummaryInformation', type: 2 as const }];
export const DOC_STREAMS = [{ name: 'WordDocument', type: 2 as const }, { name: '1Table', type: 2 as const }];
export const PPT_STREAMS = [{ name: 'PowerPoint Document', type: 2 as const }, { name: 'Current User', type: 2 as const }];
export const xlsOf = (extra: { name: string; type: 1 | 2 }[] = []): Buffer => cfbOf([...XLS_STREAMS, ...extra]);
export const docOf = (extra: { name: string; type: 1 | 2 }[] = []): Buffer => cfbOf([...DOC_STREAMS, ...extra]);
export const pptOf = (extra: { name: string; type: 1 | 2 }[] = []): Buffer => cfbOf([...PPT_STREAMS, ...extra]);
