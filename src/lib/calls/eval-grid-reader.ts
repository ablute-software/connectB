// Prompt 922 (I1) — reading an evaluation grid out of a document (PDF with text, Word, Excel) with the PLATFORM'S OWN reader. Evaluation grids are confidential to the entity and are NEVER sent to an AI provider,
// not as a fallback either: this module imports nothing that could (a test fails if it, or anything it imports, does). It proposes criteria with their weights, scales, level descriptions and sections,
// each with WHERE it came from (the line of the text), and says what it could not read. The administrator only verifies and corrects; every correction is kept for this call.
//
// Pure: text in, proposal out.
import type { LevelDescription } from './eval-grid';

export interface ProposedCriterion {
  name: string;
  section: string | null;
  weight: number | null;
  scaleMin: number | null;
  scaleMax: number | null;
  levels: LevelDescription[];
  guidance: string;
  /** Where it was read: the line number in the text of the document and the line itself. */
  source: { line: number; text: string };
}
export interface GridProposal {
  criteria: ProposedCriterion[];
  /** The scale most of the document talks about, used where a criterion names none. */
  scaleGuess: { min: number; max: number } | null;
  /** What the person should know: weights that do not add up, nothing found, a criterion with no weight… */
  notes: string[];
}

const HEADER = /\b(crit[eé]rio|criteria|criterion|peso|weight|escala|scale|descri[cç][aã]o|description|pontua[cç][aã]o|score|item)\b/i;
const NUM = '\\d{1,3}(?:[.,]\\d{1,2})?';
const WEIGHT_CELL = new RegExp(`^(${NUM})\\s*%$`);
const BARE_NUMBER = new RegExp(`^(${NUM})$`);
const SCALE_CELL = /^(?:(?:scale|escala)[:\s]*)?(\d{1,3})\s*(?:-|–|—|to|a|até|ate)\s*(\d{1,3})$/i;
const LEVEL_LINE = /^\s*(?:[-•*]\s*)?(\d{1,3})(?:\s*(?:-|–|—)\s*(\d{1,3}))?\s*(?:[:=)]|\.\s|–\s|—\s|-\s)\s*(.+?)\s*$/;

const num = (s: string): number => Number(s.replace(',', '.'));

/** Cells of one line: a table row (| or tab), a CSV line (an Excel sheet), or wide gaps; a plain line is one cell. */
export function splitCells(line: string): string[] {
  if (line.includes('|')) return line.split('|').map((c) => c.trim()).filter((c, i, a) => c !== '' || (i > 0 && i < a.length - 1));
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if ((line.match(/,/g) ?? []).length >= 2 && !/\s{2,}/.test(line)) {
    const out: string[] = []; let cur = ''; let q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; }
    out.push(cur.trim());
    return out;
  }
  if (/\s{3,}/.test(line)) return line.split(/\s{3,}/).map((c) => c.trim());
  return [line.trim()];
}

const stripNumbering = (s: string): string => s.replace(/^\s*[-•*]\s+/, '').replace(/^\s*(?:\d{1,2}(?:\.\d{1,2})*[.)]?|[a-z][.)])\s+/i, '').replace(/^["'“”]+|["'“”]+$/g, '').replace(/[:：]\s*$/, '').trim();

interface Row { line: number; raw: string; name: string; weight: number | null; scale: { min: number; max: number } | null; extra: string[]; isHeader: boolean }

function parseRow(raw: string, line: number): Row {
  const cells = splitCells(raw).filter((c) => c !== '');
  let weight: number | null = null; let scale: Row['scale'] = null; const rest: string[] = [];
  for (const cell of cells) {
    const w = cell.match(WEIGHT_CELL);
    const s = cell.match(SCALE_CELL);
    if (w && weight === null) weight = num(w[1]);
    else if (s && scale === null && num(s[2]) > num(s[1])) scale = { min: num(s[1]), max: num(s[2]) };
    else rest.push(cell);
  }
  // A plain line: "Team 25%" / "Team – 25 %" / "Team (25%)"
  if (cells.length === 1 && weight === null) {
    const m = cells[0].match(new RegExp(`^(.*?\\S)[\\s:–—(-]+(${NUM})\\s*%\\)?\\s*(.*)$`));
    if (m) { weight = num(m[2]); rest.length = 0; rest.push(m[1], ...(m[3] ? [m[3]] : [])); }
  }
  const nameCell = rest.find((c) => /[a-zà-ÿ]/i.test(c) && !BARE_NUMBER.test(c)) ?? '';
  const extra = rest.filter((c) => c !== nameCell);
  return { line, raw, name: stripNumbering(nameCell), weight, scale, extra, isHeader: cells.length >= 2 && cells.filter((c) => HEADER.test(c)).length >= 2 };
}

/** The proposal for a document's text. Deterministic: the same text always gives the same proposal. */
export function proposeGrid(text: string): GridProposal {
  const notes: string[] = [];
  const lines = text.split(/\r?\n/);
  const rows: Row[] = [];
  lines.forEach((raw, i) => { const t = raw.trim(); if (t && !/^##\s*Sheet:/i.test(t)) rows.push(parseRow(t, i + 1)); });

  // The scale the document talks about most ("1 to 5", "1–10", "scale 0-10").
  const tally = new Map<string, number>();
  for (const m of text.matchAll(/(?:scale|escala|pontua[cç][aã]o|score)[^\n]{0,20}?(\d{1,2})\s*(?:-|–|—|to|a|até|ate)\s*(\d{1,2})/gi)) if (num(m[2]) > num(m[1])) tally.set(`${m[1]}-${m[2]}`, (tally.get(`${m[1]}-${m[2]}`) ?? 0) + 1);
  for (const r of rows) if (r.scale) tally.set(`${r.scale.min}-${r.scale.max}`, (tally.get(`${r.scale.min}-${r.scale.max}`) ?? 0) + 1);
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const scaleGuess = best ? { min: Number(best[0].split('-')[0]), max: Number(best[0].split('-')[1]) } : null;

  // A weight column written without "%": when the plain numbers of the criterion rows add up to about 100.
  const plain = rows.filter((r) => r.weight === null && !r.isHeader && r.name && r.extra.some((e) => BARE_NUMBER.test(e)));
  const plainSum = plain.reduce((n, r) => n + num(r.extra.find((e) => BARE_NUMBER.test(e)) as string), 0);
  const plainWeights = plain.length >= 2 && Math.abs(plainSum - 100) < 1;

  const criteria: ProposedCriterion[] = [];
  let section: string | null = null;
  let pendingHeading: string | null = null;
  const seen = new Set<string>();
  const hasWeight = (r: Row | undefined): boolean => !!r && (r.weight !== null || (plainWeights && !!r.name && r.extra.some((e) => BARE_NUMBER.test(e))));
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    if (r.isHeader) { pendingHeading = null; continue; }
    const weight = r.weight ?? (plainWeights && r.name ? (() => { const v = r.extra.find((e) => BARE_NUMBER.test(e)); return v ? num(v) : null; })() : null);
    // A description of a level of the criterion above: "1 - weak", "4–5: strong".
    const level = r.raw.match(LEVEL_LINE);
    const last = criteria[criteria.length - 1];
    if (level && weight === null && last && !(r.name && r.raw.length > 90)) {
      const from = Number(level[1]); const to = level[2] ? Number(level[2]) : from;
      const hi = last.scaleMax ?? scaleGuess?.max ?? 10;
      if (to >= from && to <= Math.max(hi, 10)) { last.levels.push({ from, to, text: level[3].trim().slice(0, 300) }); continue; }
    }
    if (weight !== null && r.name) {
      const key = r.name.toLowerCase();
      if (seen.has(key)) { notes.push(`“${r.name}” appears more than once (line ${r.line}): only the first was taken.`); continue; }
      seen.add(key);
      criteria.push({
        name: r.name.slice(0, 160), section, weight, scaleMin: r.scale?.min ?? null, scaleMax: r.scale?.max ?? null, levels: [],
        guidance: r.extra.filter((e) => e.length > 12 && !SCALE_CELL.test(e)).join(' — ').slice(0, 1500), source: { line: r.line, text: r.raw.slice(0, 240) },
      });
      pendingHeading = null;
      continue;
    }
    // A short line with no number that is followed by weighted rows is a section heading.
    if (!r.name || weight !== null) continue;
    if (r.raw.length <= 80 && r.extra.length === 0 && !/[.!?]$/.test(r.raw) && hasWeight(rows[idx + 1])) { pendingHeading = stripNumbering(r.raw); section = pendingHeading; }
  }
  // A heading that came BEFORE no criterion at all is not a section.
  if (criteria.length === 0) notes.push('No criteria with a weight were found. Add them by hand, or check that the document has the criteria and their weights as text (a scanned file cannot be read).');
  const sum = Math.round(criteria.reduce((n, c) => n + (c.weight ?? 0), 0) * 1000) / 1000;
  if (criteria.length > 0 && Math.abs(sum - 100) > 0.001) notes.push(`The weights read add up to ${sum} %, not 100 %: check them.`);
  if (criteria.length > 0 && criteria.every((c) => c.scaleMin === null) && !scaleGuess) notes.push('No scale was found in the document: choose one for the criteria.');
  if (criteria.some((c) => c.levels.length > 0)) notes.push('Descriptions of levels were read from lines like “1 – weak”: check that each is under the right criterion.');
  return { criteria, scaleGuess, notes };
}

/** The proposal as the payload of the grid (what the editor sends): the scale of a criterion, else the document's, else the default. */
export function proposalToCriteria(p: GridProposal, fallback: { min: number; max: number } = { min: 1, max: 5 }): unknown[] {
  return p.criteria.map((c, i) => ({
    name: c.name, section: c.section, weight: c.weight ?? 0, scaleMin: c.scaleMin ?? p.scaleGuess?.min ?? fallback.min, scaleMax: c.scaleMax ?? p.scaleGuess?.max ?? fallback.max,
    levels: c.levels, guidance: c.guidance, commentRequired: false, minScore: null, position: i,
  }));
}

export interface GridCorrection { kind: 'removed' | 'added' | 'renamed' | 'weight' | 'scale' | 'levels' | 'section'; name: string; from?: unknown; to?: unknown }

/** What the administrator changed in the proposal (matched by position of the proposed item, then by name): kept per call, so the reader can be improved. */
export function diffProposal(p: GridProposal, applied: { name: string; weight: number; scaleMin: number; scaleMax: number; section: string | null; levels: LevelDescription[] }[]): GridCorrection[] {
  const out: GridCorrection[] = [];
  const left = [...applied];
  for (const orig of p.criteria) {
    const at = left.findIndex((a) => a.name.toLowerCase() === orig.name.toLowerCase());
    if (at < 0) { out.push({ kind: 'removed', name: orig.name }); continue; }
    const a = left.splice(at, 1)[0];
    if ((orig.weight ?? 0) !== a.weight) out.push({ kind: 'weight', name: a.name, from: orig.weight, to: a.weight });
    const os = `${orig.scaleMin ?? p.scaleGuess?.min ?? ''}-${orig.scaleMax ?? p.scaleGuess?.max ?? ''}`;
    if (os !== `${a.scaleMin}-${a.scaleMax}`) out.push({ kind: 'scale', name: a.name, from: os, to: `${a.scaleMin}-${a.scaleMax}` });
    if ((orig.section ?? null) !== (a.section ?? null)) out.push({ kind: 'section', name: a.name, from: orig.section, to: a.section });
    if (JSON.stringify(orig.levels) !== JSON.stringify(a.levels)) out.push({ kind: 'levels', name: a.name, from: orig.levels.length, to: a.levels.length });
  }
  for (const a of left) out.push({ kind: 'added', name: a.name });
  return out;
}
