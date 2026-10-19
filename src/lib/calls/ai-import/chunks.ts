// Prompt 909 (Adenda 2b) — splitting the text of the documents into parts that are read in PARALLEL.
//
// Why: the model writes ~70 tokens per question at ~65 tokens/s, so a 52-question form takes ~60 s in ONE answer however the input is sent. The same
// questions read in three parts, side by side, take the time of the longest part (~20 s). The part boundaries are the natural ones: a PDF's page
// breaks, a Word or Excel file's line breaks — never the middle of a line. Pure: no provider, no storage.
import type { SourceKind } from './limits';

/** One piece of text that is never cut: a PDF page, or a few lines of a Word/Excel file. */
export interface Unit { doc: number; kind: SourceKind; label: string; text: string }
export interface Chunk { units: Unit[]; chars: number; label: string }

/** About 900 tokens of text: a part answered in ~15 s (18-20 questions). */
export const CHUNK_TARGET_CHARS = 3500;
/** More parallel readers than this gains nothing and starts to meet the provider's rate limits. */
export const MAX_CHUNKS = 6;
/** A Word or Excel file has no pages: its lines are grouped into pieces of about this size before being grouped into parts. */
const LINE_GROUP_CHARS = 800;

export interface TextDoc { kind: SourceKind; text: string; pageTexts?: string[] }

export function unitsOf(docs: TextDoc[]): Unit[] {
  const units: Unit[] = [];
  docs.forEach((d, doc) => {
    if (d.pageTexts && d.pageTexts.length > 0) {
      d.pageTexts.forEach((t, p) => { if (t.trim()) units.push({ doc, kind: d.kind, label: `page ${p + 1}`, text: t.trim() }); });
      return;
    }
    let buf: string[] = []; let size = 0; let n = 0;
    const flush = () => { if (buf.length) { units.push({ doc, kind: d.kind, label: `part ${++n}`, text: buf.join('\n') }); buf = []; size = 0; } };
    for (const line of d.text.split('\n')) {
      if (size + line.length > LINE_GROUP_CHARS && size > 0) flush();
      buf.push(line); size += line.length + 1;
    }
    flush();
  });
  return units;
}

/** Consecutive units into parts of about `target` characters, in order; a unit is never split. */
function group(units: Unit[], target: number): Unit[][] {
  const out: Unit[][] = []; let cur: Unit[] = []; let size = 0;
  for (const u of units) {
    if (cur.length > 0 && size + u.text.length > target) { out.push(cur); cur = []; size = 0; }
    cur.push(u); size += u.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function planChunks(docs: TextDoc[], opts: { target?: number; max?: number } = {}): Chunk[] {
  const units = unitsOf(docs);
  const total = units.reduce((n, u) => n + u.text.length, 0);
  const max = opts.max ?? MAX_CHUNKS;
  let target = opts.target ?? CHUNK_TARGET_CHARS;
  let parts = group(units, target);
  // Too many parts: make them bigger until they fit the cap (the document is long; its questions are few per part).
  while (parts.length > max && target < total) { target = Math.ceil(target * 1.25); parts = group(units, target); }
  return parts.map((us) => ({ units: us, chars: us.reduce((n, u) => n + u.text.length, 0), label: describe(us) }));
}

/** "page 1–2" / "page 3" / "part 2 to part 4" — for the reader's instruction and for our logs. */
function describe(us: Unit[]): string {
  const first = us[0]; const last = us[us.length - 1];
  if (first.label.startsWith('page') && last.label.startsWith('page') && first.doc === last.doc) {
    const a = first.label.replace('page ', ''); const b = last.label.replace('page ', '');
    return a === b ? `page ${a}` : `pages ${a}–${b}`;
  }
  return first.label === last.label && first.doc === last.doc ? first.label : `${first.label} to ${last.label}`;
}
