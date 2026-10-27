// Prompt 917 (Adenda 1, Part B; Adenda 2, B3) — the platform's reader of TEMPLATE TABLES: a table-model whose columns are numbered ("Competitor #1  Competitor #2  Competitor #…") and whose
// rows are the criteria ("Products & Services", "Business Model", …). In the call it becomes a TABLE (the "Table" question, not a repeatable group): the criteria are the ROWS (the first
// column, set by the entity), the companies the COLUMNS ("Your solution/company", "Competitor #1", …), the applicant fills in the cells and may add columns (more competitors). A criterion
// that is a percentage ("Market Share (%)") is a percentage row.
//
// Narrow on purpose: it reads this one shape, which text extraction flattens into a header line and short label lines. Anything else stays unresolved (the AI gets it).
import { newTableColumnId, newTableRowId, parseTableConfig } from '../../table';
import type { TableConfig } from '../../types';
import { fold } from './cues';

export interface TemplateTable { title: string; instruction: string | null; table: TableConfig; note: string }

const HEADER_START = /^(?:\S+\s+)?(criteri\w*|criteria|item\w*|aspect\w*|parameter\w*|parametro\w*|feature\w*|caracteristic\w*)\b/;
const NUMBERED_COLUMN = /([A-ZÀ-Þ][\wÀ-ÿ]*)\s?#\s?(\d+)/g;

const tidy = (s: string): string => s.replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();

/** The row labels of the table, from the short lines the extraction left: a label wrapped over several lines is put back together. */
function labels(lines: string[]): string[] {
  const out: string[] = []; let cur = ''; let fragment = false;
  const open = (s: string) => (s.match(/\(/g) ?? []).length > (s.match(/\)/g) ?? []).length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || /^[.…]+$/.test(l)) { if (cur) { out.push(cur); cur = ''; } if (/^[.…]+$/.test(l)) break; continue; }
    if (cur) {
      const continues = fragment || open(cur) || /^[&\-–,)]/.test(l) || /^\p{Ll}/u.test(l);
      if (continues) { cur = `${cur} ${l}`; fragment = false; continue; }
      out.push(cur); cur = '';
    }
    // a one-word line is a fragment ("Target" / "Market (size…)"): it joins the next line
    if (!/\s/.test(l) && i + 1 < lines.length && !/^[.…]+$/.test(lines[i + 1].trim())) { cur = l; fragment = true; continue; }
    cur = l;
  }
  if (cur) out.push(cur);
  return out.map(tidy).filter(Boolean);
}

export function readTemplateTable(block: { title: string; text: string }): TemplateTable | null {
  const lines = block.text.split('\n').map((l) => l.trim()).filter(Boolean).slice(1);          // without the title line
  const start = lines.findIndex((l) => HEADER_START.test(fold(l)));
  if (start < 0) return null;
  // the header: from there to the line that ends the numbered columns ("… Competitor #…")
  let end = start; let header = lines[start];
  while (end + 1 < lines.length && end - start < 3 && ((header.match(/#/g) ?? []).length < 3 || !/#\s?(?:\.{2,3}|…)/.test(header))) { end++; header = `${header} ${lines[end]}`; }
  const cols = [...header.matchAll(NUMBERED_COLUMN)];
  if (cols.length < 2) return null;
  const first = HEADER_START.exec(fold(header));
  const firstLabel = first ? header.slice(0, header.toLowerCase().search(/criteri|criteria|item|aspect|parameter|parametro|feature|caracteristic/) + (first[1]?.length ?? 0)).trim() : 'Criteria';
  const prefix = header.slice(firstLabel.length, header.indexOf(cols[0][0])).trim();             // "Your solution/ company"
  const companies: string[] = [];
  if (prefix) companies.push(tidy(prefix));
  for (const c of cols) companies.push(tidy(c[0]));
  const criteria = labels(lines.slice(end + 1));
  if (criteria.length < 2) return null;
  // "Competitor #1", "Competitor #2", "Competitor #…": what a new column is called until the applicant renames it is "Competitor #3"…
  const numberedWord = cols[0][1];

  const parsed = parseTableConfig({
    cornerTitle: tidy(firstLabel),
    columns: companies.map((label) => ({ id: newTableColumnId(), label })),
    rows: criteria.map((label) => ({ id: newTableRowId(), label })),
    cellKind: 'long_text',
    addColumns: { allowed: true, max: Math.max(6, companies.length), defaultName: `${numberedWord} #` },
    addRows: { allowed: false, max: criteria.length, defaultName: 'Row #' },
    required: 'none',
  });
  if (!parsed.ok) return null;
  const table = parsed.config;
  // a criterion that is a percentage ("Market Share (%)") is a percentage row
  table.rows.forEach((r) => { if (/\(%\)|%/.test(r.label)) table.rowKinds[r.id] = 'percent'; });
  const instruction = lines.slice(0, start).join(' ').replace(/\s+/g, ' ').trim();
  const title = tidy(block.title.replace(/^\s*exemplo\s*[-–:]\s*/i, '').replace(/\btemplate\b/i, '').trim()) || 'Template table';
  return {
    title, instruction: instruction || null, table,
    note: `It has ${criteria.length} criteria (${criteria.slice(0, 3).join(', ')}…) and ${companies.length} columns (${companies.join(', ')}). The template continues with “…”: only the columns written out were kept, and applicants can add more.`,
  };
}
