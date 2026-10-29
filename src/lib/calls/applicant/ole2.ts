// Prompt 922 (Adenda 1, bug dos ficheiros, 29/10/2026) — the OLD Office formats (.xls, .doc, .ppt) are OLE2 "compound files" (signature D0 CF 11 E0 A1 B1 1A E1), not zips. Which of the three one really is can only be
// told from what is INSIDE: a directory of named streams — "Workbook" (or "Book") for Excel, "WordDocument" for Word, "PowerPoint Document" for PowerPoint — and whether it carries macros (a "VBA" storage, Excel's
// "_VBA_PROJECT_CUR", Word's "Macros"). This reads only that directory, with every offset and length checked: a damaged or hostile file gives `null`, never an exception and never an endless loop. Pure (no server-only):
// the tests build small compound files and read them back.
export const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
export const isOle2 = (bytes: Buffer): boolean => bytes.length >= 512 && OLE2_SIGNATURE.every((b, i) => bytes[i] === b);

const FREE = 0xffffffff; const END = 0xfffffffe; const MAX_SECTORS = 4_000_000;

/** The names of every storage and stream in the file's directory (lower case), or null when it is not a readable compound file. */
export function readOleNames(bytes: Buffer): string[] | null {
  if (!isOle2(bytes)) return null;
  try {
    const shift = bytes.readUInt16LE(0x1e);
    if (shift !== 9 && shift !== 12) return null;
    const size = 1 << shift;
    const sectorOffset = (id: number) => (id + 1) * size;
    const inside = (off: number, len: number) => off >= 0 && off + len <= bytes.length;
    const nFat = bytes.readUInt32LE(0x2c); const firstDir = bytes.readUInt32LE(0x30); let difat = bytes.readUInt32LE(0x44); const nDifat = bytes.readUInt32LE(0x48);
    if (nFat === 0 || nFat > MAX_SECTORS || nDifat > MAX_SECTORS) return null;

    // The sectors that hold the FAT: the first 109 are in the header, the rest in a chain of DIFAT sectors.
    const fatSectors: number[] = [];
    for (let i = 0; i < 109 && fatSectors.length < nFat; i++) { const id = bytes.readUInt32LE(0x4c + i * 4); if (id !== FREE) fatSectors.push(id); }
    for (let d = 0; d < nDifat && difat !== END && difat !== FREE && fatSectors.length < nFat; d++) {
      const off = sectorOffset(difat);
      if (!inside(off, size)) return null;
      for (let i = 0; i < size / 4 - 1 && fatSectors.length < nFat; i++) { const id = bytes.readUInt32LE(off + i * 4); if (id !== FREE) fatSectors.push(id); }
      difat = bytes.readUInt32LE(off + size - 4);
    }
    const fat: number[] = [];
    for (const id of fatSectors) {
      const off = sectorOffset(id);
      if (!inside(off, size)) return null;
      for (let i = 0; i < size / 4; i++) fat.push(bytes.readUInt32LE(off + i * 4));
    }

    // The directory is a chain of sectors; each holds size/128 entries.
    const names: string[] = [];
    let sector = firstDir; let steps = 0;
    while (sector !== END && sector !== FREE) {
      if (++steps > MAX_SECTORS || sector >= fat.length) return null;
      const off = sectorOffset(sector);
      if (!inside(off, size)) return null;
      for (let e = 0; e < size / 128; e++) {
        const p = off + e * 128;
        const type = bytes[p + 66];
        const len = bytes.readUInt16LE(p + 64);
        if ((type !== 1 && type !== 2 && type !== 5) || len < 2 || len > 64) continue;
        names.push(bytes.subarray(p, p + len - 2).toString('utf16le').toLowerCase());
      }
      sector = fat[sector];
    }
    return names;
  } catch { return null; }
}

export type OleKind = 'xls' | 'doc' | 'ppt';

/** Which Office program wrote it, from the streams it holds; null when it is none of the three (some other compound file: an Outlook message, an installer…). */
export function oleKindOf(names: string[]): OleKind | null {
  const has = (n: string) => names.includes(n);
  if (has('workbook') || has('book')) return 'xls';
  if (has('worddocument')) return 'doc';
  if (has('powerpoint document')) return 'ppt';
  return null;
}

/** A VBA project inside: a "VBA" storage (any of the three), Excel's "_VBA_PROJECT_CUR", Word's "Macros", the project stream itself. */
export const oleHasMacros = (names: string[]): boolean => names.some((n) => n === 'vba' || n === '_vba_project_cur' || n === '_vba_project' || n === 'macros' || n === 'project' || n === 'projectwm');
