// Prompt 917 (Adenda 2, B) — the "Table" question: a grid with headers. Everything about it that is not a screen, in one pure module that the entity's editor, the preview, the applicant's form, the server
// (sanitising and the final check), the Submissions tab, the import and the conversion of an old group all share. No I/O, no React.
//
//   configuration   rows (the criteria, first column) · columns (the things compared, first row) · the type of the cells (one for the table, or one per row) · what the applicant may add · what is required
//   answer          { columns: [added by the applicant], rows: [added by the applicant], cells: { rowId: { columnId: text } } } — by stable ids, never by position
//   the rule        the applicant may rename and remove ONLY what they added; the entity's headers are never part of the answer, so no request can change or remove them
import {
  MAX_NUMBER_DIGITS, MAX_TABLE_CELL_LONG, MAX_TABLE_CELL_SHORT, MAX_TABLE_COLUMNS, MAX_TABLE_HEADER, MAX_TABLE_ROWS, TABLE_CELL_KINDS,
  type AnswerValue, type FormField, type GroupConfig, type GroupEntry, type SimpleAnswer, type TableAddRule, type TableAnswer, type TableCellKind, type TableConfig, type TableExtra, type TableHeader, type TableRequired,
} from './types';

// randomUUID exists only in a secure context (https, localhost): an editor opened over plain http on a LAN address, or a bare test page, has getRandomValues only.
const newId = (): string => {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};
const shortId = (prefix: string): string => `${prefix}_${newId().replace(/-/g, '').slice(0, 10)}`;
export const newTableRowId = (): string => shortId('r');
export const newTableColumnId = (): string => shortId('c');
/** What the applicant's own rows and columns are called in the data: never confusable with an entity id. */
export const newTableExtraId = (): string => shortId('x');
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;
/** The applicant's own ids are minted by the browser as x_ + 10 characters: shorter ones are not ours. */
const EXTRA_ID_OK = /^[A-Za-z0-9_-]{4,64}$/;

const clampInt = (v: unknown, min: number, max: number): number | undefined => {
  if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && v.trim() === '')) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : undefined;
};
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '');

// --- Configuration ---------------------------------------------------------------------------------------------------------------------------

export function defaultTableConfig(): TableConfig {
  return {
    cornerTitle: '',
    rows: [1, 2, 3].map(() => ({ id: newTableRowId(), label: '' })),
    columns: [{ id: newTableColumnId(), label: 'Column 1' }, { id: newTableColumnId(), label: 'Column 2' }],
    cellKind: 'short_text', rowKinds: {},
    addColumns: { allowed: false, max: 6, defaultName: 'Column #' },
    addRows: { allowed: false, max: 10, defaultName: 'Row #' },
    required: 'none',
  };
}

const parseHeaders = (raw: unknown, max: number, prefix: 'r' | 'c', labelsOptional: boolean): TableHeader[] => {
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]).slice(0, max) : [];
  const seen = new Set<string>();
  const out: TableHeader[] = [];
  for (const h of list) {
    if (!h || typeof h !== 'object') continue;
    const label = text(h.label, MAX_TABLE_HEADER);
    if (!label && !labelsOptional) continue;
    let id = typeof h.id === 'string' && ID_OK.test(h.id) ? h.id : shortId(prefix);
    if (seen.has(id)) id = shortId(prefix);
    seen.add(id);
    out.push({ id, label });
  }
  return out;
};

const parseAddRule = (raw: unknown, own: number, ceiling: number, fallbackName: string): TableAddRule => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const allowed = r.allowed === true;
  const max = clampInt(r.max, Math.max(own, 1), ceiling) ?? Math.min(ceiling, Math.max(own, own + 3));
  return { allowed, max: allowed ? Math.max(max, own) : Math.max(own, 1), defaultName: text(r.defaultName, 60) || fallbackName };
};

export type ParsedTable = { ok: true; config: TableConfig } | { ok: false; error: string };

/** The configuration the editor sent, read strictly: nothing that does not fit survives, and a configuration that cannot be filled in is refused with a sentence. */
export function parseTableConfig(raw: unknown): ParsedTable {
  const t = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (!t) return { ok: false, error: 'A table needs its configuration.' };
  const columns = parseHeaders(t.columns, MAX_TABLE_COLUMNS, 'c', false);
  if (columns.length === 0) return { ok: false, error: 'A table needs at least one column with a name.' };
  const rows = parseHeaders(t.rows, MAX_TABLE_ROWS, 'r', true);       // a row with no name is shown by its number
  const addRows = parseAddRule(t.addRows, rows.length, MAX_TABLE_ROWS, 'Row #');
  const addColumns = parseAddRule(t.addColumns, columns.length, MAX_TABLE_COLUMNS, 'Column #');
  if (rows.length === 0 && !addRows.allowed) return { ok: false, error: 'A table needs at least one row, or the applicant must be allowed to add rows.' };
  const cellKind = (TABLE_CELL_KINDS as readonly string[]).includes(t.cellKind as string) ? (t.cellKind as TableCellKind) : 'short_text';
  const rowKinds: Record<string, TableCellKind> = {};
  const rk = (t.rowKinds && typeof t.rowKinds === 'object' && !Array.isArray(t.rowKinds) ? t.rowKinds : {}) as Record<string, unknown>;
  for (const r of rows) {
    const k = rk[r.id];
    if ((TABLE_CELL_KINDS as readonly string[]).includes(k as string) && k !== cellKind) rowKinds[r.id] = k as TableCellKind;
  }
  const required: TableRequired = t.required === 'all' || t.required === 'first_column' ? t.required : 'none';
  return { ok: true, config: { cornerTitle: text(t.cornerTitle, 100), rows, columns, cellKind, rowKinds, addColumns, addRows, required } };
}

export const tableOf = (field: Pick<FormField, 'kind' | 'validations'>): TableConfig | null => (field.kind === 'table' ? field.validations.table ?? null : null);

export const cellKindOf = (cfg: TableConfig, rowId: string): TableCellKind => cfg.rowKinds[rowId] ?? cfg.cellKind;

/** "Competitor #" -> "Competitor #3" (the next number after the ones in use); a name without "#" gets a number only when it would repeat one. */
export function nextDefaultName(defaultName: string, existing: string[]): string {
  const base = defaultName.trim() || 'New';
  const at = base.indexOf('#');
  if (at >= 0) {
    const prefix = base.slice(0, at + 1);
    let n = 0;
    for (const e of existing) {
      if (!e.startsWith(prefix)) continue;
      const k = Number(e.slice(prefix.length).match(/^\d+/)?.[0] ?? '0');
      n = Math.max(n, k);
    }
    return `${prefix}${n + 1}`;
  }
  if (!existing.includes(base)) return base;
  let i = 2; while (existing.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

// --- The answer -----------------------------------------------------------------------------------------------------------------------------

export const isTableAnswer = (v: unknown): v is TableAnswer =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !!(v as TableAnswer).cells && typeof (v as TableAnswer).cells === 'object' && !Array.isArray((v as TableAnswer).cells);

export const emptyTableAnswer = (): TableAnswer => ({ columns: [], rows: [], cells: {} });
export const tableAnswerOf = (v: AnswerValue): TableAnswer => (isTableAnswer(v) ? { columns: v.columns ?? [], rows: v.rows ?? [], cells: v.cells } : emptyTableAnswer());

/** One header as shown: the entity's or the applicant's. */
export interface TableHeaderView { id: string; label: string; own: boolean }

/** The columns of a table for this answer, in order: the entity's, then the applicant's. */
export function tableColumns(cfg: TableConfig, answer: AnswerValue): TableHeaderView[] {
  return [...cfg.columns.map((c) => ({ id: c.id, label: c.label, own: false })), ...tableAnswerOf(answer).columns.map((c) => ({ id: c.id, label: c.name, own: true }))];
}
/** The rows: the entity's (a row with no name is its number), then the applicant's. */
export function tableRows(cfg: TableConfig, answer: AnswerValue): TableHeaderView[] {
  return [...cfg.rows.map((r, i) => ({ id: r.id, label: r.label || String(i + 1), own: false })), ...tableAnswerOf(answer).rows.map((r) => ({ id: r.id, label: r.name, own: true }))];
}

export const cellOf = (answer: AnswerValue, rowId: string, columnId: string): string => tableAnswerOf(answer).cells[rowId]?.[columnId] ?? '';

/** Has the person put anything in a cell? (A header they added on its own is not an answer.) */
export function isTableAnswered(v: AnswerValue): boolean {
  if (!isTableAnswer(v)) return false;
  return Object.values(v.cells).some((row) => row && Object.values(row).some((c) => typeof c === 'string' && c.trim() !== ''));
}

const PERCENT_TYPED = /^\d{0,3}([.,]\d{0,2})?$/;
const PERCENT_FINAL = /^\d{1,3}(\.\d{1,2})?$/;

/** What a cell keeps of what was typed (half-typed text survives the autosave; the final check refuses what is wrong). undefined = nothing to keep. */
export function coerceCell(kind: TableCellKind, v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  switch (kind) {
    case 'short_text': return v.trim() === '' ? undefined : v.slice(0, MAX_TABLE_CELL_SHORT);
    case 'long_text': return v.trim() === '' ? undefined : v.slice(0, MAX_TABLE_CELL_LONG);
    case 'number':
    case 'amount': { const d = v.replace(/\D/g, '').slice(0, MAX_NUMBER_DIGITS).replace(/^0+(?=\d)/, ''); return d || undefined; }      // digits only, no leading zeros: the rule of a Number question
    case 'percent': { const t = v.trim(); return t !== '' && PERCENT_TYPED.test(t) ? t.replace(',', '.') : undefined; }
  }
}

/** null = fine. Only for a cell that holds something. */
export function validateCell(kind: TableCellKind, value: string): string | null {
  switch (kind) {
    case 'short_text': return value.length > MAX_TABLE_CELL_SHORT ? `Please keep it under ${MAX_TABLE_CELL_SHORT} characters.` : null;
    case 'long_text': return value.length > MAX_TABLE_CELL_LONG ? `Please keep it under ${MAX_TABLE_CELL_LONG} characters.` : null;
    case 'number': return /^\d+$/.test(value) && value.length <= MAX_NUMBER_DIGITS ? null : 'Digits only, please.';
    case 'amount': return /^\d+$/.test(value) && value.length <= MAX_NUMBER_DIGITS ? null : 'Enter an amount in digits only.';
    case 'percent': return PERCENT_FINAL.test(value) && Number(value) <= 100 ? null : 'Enter a percentage between 0 and 100.';
  }
}

/**
 * What the server keeps of a table answer: ONLY what the applicant is allowed to author. The entity's headers are not read from the request at all; the applicant's own columns and rows are kept only
 * when the entity allows them and only up to its maximum (counting its own); their names are text, never an id of the entity's; a cell is kept only when its row AND its column exist, coerced to
 * the type of its row. undefined = nothing to keep.
 */
export function coerceTable(cfg: TableConfig, raw: unknown): TableAnswer | undefined {
  if (!isTableAnswer(raw)) return undefined;
  const ownCols = new Set(cfg.columns.map((c) => c.id));
  const ownRows = new Set(cfg.rows.map((r) => r.id));
  const extras = (list: unknown, rule: TableAddRule, own: number, ownIds: Set<string>, taken: Set<string>): TableExtra[] => {
    if (!rule.allowed || !Array.isArray(list)) return [];
    const room = Math.max(0, rule.max - own);
    const out: TableExtra[] = [];
    for (const e of list as Record<string, unknown>[]) {
      if (out.length >= room) break;
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !EXTRA_ID_OK.test(e.id) || ownIds.has(e.id) || taken.has(e.id)) continue;
      taken.add(e.id);
      out.push({ id: e.id, name: text(e.name, MAX_TABLE_HEADER) || rule.defaultName.replace('#', String(out.length + 1)), addedBy: 'applicant' });
    }
    return out;
  };
  const columns = extras(raw.columns, cfg.addColumns, cfg.columns.length, ownCols, new Set());
  const rows = extras(raw.rows, cfg.addRows, cfg.rows.length, ownRows, new Set());
  const colIds = new Set([...cfg.columns.map((c) => c.id), ...columns.map((c) => c.id)]);
  const rowIds = [...cfg.rows.map((r) => r.id), ...rows.map((r) => r.id)];
  const cells: Record<string, Record<string, string>> = {};
  for (const rowId of rowIds) {
    const inRow = raw.cells[rowId];
    if (!inRow || typeof inRow !== 'object' || Array.isArray(inRow)) continue;
    const kind = cellKindOf(cfg, rowId);
    for (const colId of colIds) {
      if (!Object.prototype.hasOwnProperty.call(inRow, colId)) continue;
      const v = coerceCell(kind, (inRow as Record<string, unknown>)[colId]);
      if (v !== undefined) (cells[rowId] ??= {})[colId] = v;
    }
  }
  if (columns.length === 0 && rows.length === 0 && Object.keys(cells).length === 0) return undefined;
  return { columns, rows, cells };
}

// --- The final check -------------------------------------------------------------------------------------------------------------------------

export interface TableIssue { key: string; message: string }

/**
 * EVERY problem of a table, one by one (the final check lists them all): the counts first, then each cell. Which cells are required: the table's own setting — none, every cell of the entity's columns, or
 * only the first of them — applies once the person has started the table or the question is required; a required question with "none" needs at least one cell. The applicant's own columns are never required.
 */
export function tableIssues(field: FormField, value: AnswerValue): TableIssue[] {
  const cfg = tableOf(field);
  if (!cfg) return [];
  const answer = tableAnswerOf(value);
  const issues: TableIssue[] = [];
  const started = isTableAnswered(value);
  const rows = tableRows(cfg, value);
  const cols = tableColumns(cfg, value);
  if (answer.columns.length > 0 && (!cfg.addColumns.allowed || cfg.columns.length + answer.columns.length > cfg.addColumns.max)) issues.push({ key: `${field.id}#columns`, message: `At most ${cfg.addColumns.allowed ? cfg.addColumns.max : cfg.columns.length} columns.` });
  if (answer.rows.length > 0 && (!cfg.addRows.allowed || cfg.rows.length + answer.rows.length > cfg.addRows.max)) issues.push({ key: `${field.id}#rows`, message: `At most ${cfg.addRows.allowed ? cfg.addRows.max : cfg.rows.length} rows.` });
  if (!started && field.required && cfg.required === 'none') { issues.push({ key: field.id, message: 'This answer is required.' }); return issues; }
  const mustFill = (colIndex: number, own: boolean) => !own && (cfg.required === 'all' || (cfg.required === 'first_column' && colIndex === 0));
  const applies = field.required || started;
  for (const r of rows) {
    const kind = cellKindOf(cfg, r.id);
    cols.forEach((c, ci) => {
      const v = answer.cells[r.id]?.[c.id] ?? '';
      const where = `${r.label} — ${c.label}`;
      if (v.trim() === '') { if (applies && mustFill(ci, c.own)) issues.push({ key: `${field.id}#${r.id}/${c.id}`, message: `${where}: This answer is required.` }); return; }
      const err = validateCell(kind, v);
      if (err) issues.push({ key: `${field.id}#${r.id}/${c.id}`, message: `${where}: ${err}` });
    });
  }
  return issues;
}

// --- Reading it as text (the Submissions tab, exports, the final check's summaries) ------------------------------------------------------------

/** "3 rows × 4 columns, 9 cells filled". */
export function tableSummary(field: Pick<FormField, 'kind' | 'validations'>, value: AnswerValue): string {
  const cfg = tableOf(field);
  if (!cfg) return '';
  const rows = tableRows(cfg, value).length; const cols = tableColumns(cfg, value).length;
  const filled = Object.values(tableAnswerOf(value).cells).reduce((n, r) => n + Object.values(r).filter((c) => c.trim() !== '').length, 0);
  return `${rows} row${rows === 1 ? '' : 's'} × ${cols} column${cols === 1 ? '' : 's'} · ${filled} cell${filled === 1 ? '' : 's'} filled`;
}

// --- From an old repeatable group in table mode to a Table -----------------------------------------------------------------------------------

export type GroupConversion =
  | { ok: true; table: TableConfig; answer: (value: AnswerValue) => TableAnswer | undefined; summary: string }
  | { ok: false; reason: string };

const CELL_OF_SUB: Record<string, TableCellKind> = { short_text: 'short_text', long_text: 'long_text', number: 'number' };

/**
 * A group in table mode with rows the entity set ("Your company", "Competitor 1", "Competitor 2" in the first column; the criteria as the other questions) becomes a Table TRANSPOSED: those rows become the
 * COLUMNS and the questions become the criteria (rows). Entry ids ("row1"…) are kept as the column ids, so a draft answer is re-keyed, not rewritten. Only the shape the import produces is converted
 * (the first question's column holds the entity's own text); anything else is refused with the reason, and the entity rebuilds it by hand. Applicants may add columns (more competitors), up to six in all.
 */
export function convertGroupToTable(field: Pick<FormField, 'kind' | 'validations' | 'required'>): GroupConversion {
  const g: GroupConfig | null = field.kind === 'group' ? field.validations.group ?? null : null;
  if (!g) return { ok: false, reason: 'Only a repeatable group can be converted.' };
  if (g.display !== 'table' || g.presetRows.length === 0) return { ok: false, reason: 'Only a group shown as a table, with the rows set by you, can be converted.' };
  const presetCols = g.subFields.map((_, i) => g.presetRows.some((r) => (r[i] ?? '') !== '')).map((has, i) => (has ? i : -1)).filter((i) => i >= 0);
  if (presetCols.length !== 1 || presetCols[0] !== 0) return { ok: false, reason: 'This table cannot be converted automatically (its fixed text is not only in the first column).' };
  const criteria = g.subFields.slice(1);
  if (criteria.length === 0) return { ok: false, reason: 'This table has no criteria to turn into rows.' };
  const unsupported = criteria.find((s) => !(s.kind in CELL_OF_SUB));
  if (unsupported) return { ok: false, reason: `“${unsupported.label}” is a ${unsupported.kind.replace('_', ' ')} question: a Table holds text and numbers only.` };

  const columns: TableHeader[] = g.presetRows.map((r, i) => ({ id: `row${i + 1}`, label: r[0] }));      // the entry ids stay as the column ids
  const rows: TableHeader[] = criteria.map((s) => ({ id: s.id, label: s.label }));
  const rowKinds: Record<string, TableCellKind> = {};
  for (const s of criteria) if (CELL_OF_SUB[s.kind] !== 'short_text') rowKinds[s.id] = CELL_OF_SUB[s.kind];
  const required: TableRequired = criteria.every((s) => s.required) ? 'all' : 'none';
  const table: TableConfig = {
    cornerTitle: g.subFields[0].label === 'Untitled question' ? '' : g.subFields[0].label,
    rows, columns, cellKind: 'short_text', rowKinds,
    addColumns: { allowed: true, max: Math.max(6, columns.length), defaultName: 'Competitor #' },
    addRows: { allowed: false, max: rows.length, defaultName: 'Row #' },
    required,
  };
  const parsed = parseTableConfig(table);
  if (!parsed.ok) return { ok: false, reason: parsed.error };
  const answer = (value: AnswerValue): TableAnswer | undefined => {
    const entries: GroupEntry[] = Array.isArray(value) ? (value as unknown[]).filter((e): e is GroupEntry => !!e && typeof e === 'object' && typeof (e as GroupEntry).id === 'string' && !!(e as GroupEntry).values) : [];
    const cells: Record<string, Record<string, string>> = {};
    for (const e of entries) {
      if (!columns.some((c) => c.id === e.id)) continue;
      for (const s of criteria) {
        const v: SimpleAnswer = e.values[s.id];
        const kept = coerceCell(CELL_OF_SUB[s.kind], typeof v === 'string' ? v : undefined);
        if (kept !== undefined) (cells[s.id] ??= {})[e.id] = kept;
      }
    }
    return Object.keys(cells).length > 0 ? { columns: [], rows: [], cells } : undefined;
  };
  return {
    ok: true, table: parsed.config, answer,
    summary: `${g.presetRows.length} fixed row${g.presetRows.length === 1 ? '' : 's'} became columns, ${criteria.length} question${criteria.length === 1 ? '' : 's'} became criteria (rows); applicants can add columns.${required === 'all' ? ' Every cell is required.' : ''}`,
  };
}

