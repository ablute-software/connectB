// Prompt 917 (Adenda 1, Part B) — the platform's reader of TEMPLATE TABLES: a table-model whose columns are numbered ("Competitor #1  Competitor #2  Competitor #…") and whose
// rows are the criteria ("Products & Services", "Business Model", …). In the call it becomes a repeatable group shown as a TABLE: each row is one of the numbered
// companies (the first columns set by the entity: "Your solution/company", "Competitor #1", …) and each column one criterion the applicant fills in.
//
// Narrow on purpose: it reads this one shape, which text extraction flattens into a header line and short label lines. Anything else stays unresolved (the AI gets it).
import { defaultGroupConfig, newSubField, parseSimpleValidations } from '../../field-config';
import type { GroupConfig } from '../../types';
import { fold } from './cues';

export interface TemplateTable { title: string; instruction: string | null; group: GroupConfig; note: string }

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
  const rows: string[][] = [];
  if (prefix) rows.push([tidy(prefix)]);
  for (const c of cols) rows.push([tidy(c[0])]);
  const criteria = labels(lines.slice(end + 1));
  if (criteria.length < 2) return null;

  const g = defaultGroupConfig();
  g.entryLabel = 'Company'; g.display = 'table'; g.presetRows = rows; g.min = rows.length; g.max = rows.length;
  const company = newSubField('short_text'); company.label = tidy(firstLabel.replace(/^relevant\s+/i, '')) || 'Company'; company.label = 'Company';
  g.subFields = [company, ...criteria.map((c) => { const s = newSubField(/\(%\)|%/.test(c) ? 'short_text' : 'long_text'); s.label = c; s.validations = parseSimpleValidations(s.kind, {}); return s; })];
  const instruction = lines.slice(0, start).join(' ').replace(/\s+/g, ' ').trim();
  const title = tidy(block.title.replace(/^\s*exemplo\s*[-–:]\s*/i, '').replace(/\btemplate\b/i, '').trim()) || 'Template table';
  return {
    title, instruction: instruction || null, group: g,
    note: `The table has ${criteria.length} criteria (${criteria.slice(0, 3).join(', ')}…) and ${rows.length} rows (${rows.map((r) => r[0]).join(', ')}). The template continues with “…”: only the rows written out were kept.`,
  };
}
