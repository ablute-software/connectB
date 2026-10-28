'use client';
// Prompt 917 (Adenda 2, B1) — the entity's side of a Table question: the headers of its rows (the criteria, the first column) and of its columns (the first row), the corner title, the type of the
// cells (one for the table, or one per row), what the applicant may add (columns, rows: how many in all and what a new one is called), what is required — and a preview of the table, in the
// panel itself, drawn as cards so that it fits (nothing in this panel is wider than the panel). Every change goes up as a new configuration; the server reads it all again (parseTableConfig).
import { useEffect, useState } from 'react';
import { newTableColumnId, newTableRowId } from '@/lib/calls/table';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, TABLE_CELL_KINDS, TABLE_CELL_KIND_LABELS, type AnswerValue, type FormField, type TableAddRule, type TableCellKind, type TableConfig, type TableHeader, type TableRequired } from '@/lib/calls/types';
import { AutoTextarea } from './AutoTextarea';
import { TablePreview } from './TablePreview';

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500';

const headersToText = (list: TableHeader[]): string => list.map((h) => h.label).join('\n');
/** One header per line. A line keeps the id of the line at the same place before (so the type of a row survives its being renamed); blank lines go unless `keepBlank` (numbered rows). */
function textToHeaders(text: string, before: TableHeader[], make: () => string, max: number): TableHeader[] {
  const lines = text.split('\n').map((l) => l.slice(0, 200));
  const kept = lines.map((l) => l.trim()).filter((l) => l !== '').slice(0, max);
  return kept.map((label, i) => ({ id: before[i]?.id ?? make(), label }));
}

/**
 * A list of headers, one per line. The text is kept HERE while it is being typed — the configuration drops blank lines, so building the text back from it on every keystroke would swallow the Enter
 * that starts a new line — and only re-read from the configuration when that changed from outside (a different question was selected).
 */
function HeadersText({ id, headers, rows, disabled, placeholder, testId, onText }: {
  id: string; headers: TableHeader[]; rows: number; disabled?: boolean; placeholder: string; testId: string; onText: (text: string) => void;
}) {
  const [text, setText] = useState(headersToText(headers));
  const canonical = headersToText(headers);
  useEffect(() => { if (text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n') !== canonical) setText(canonical); }, [canonical]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <textarea id={id} rows={rows} autoComplete="off" className={INPUT} disabled={disabled} value={text} data-testid={testId} placeholder={placeholder}
      onChange={(e) => { setText(e.target.value); onText(e.target.value); }} />
  );
}

function AddRuleEditor({ title, noun, value, own, ceiling, disabled, onChange }: {
  title: string; noun: 'columns' | 'rows'; value: TableAddRule; own: number; ceiling: number; disabled?: boolean; onChange: (r: TableAddRule) => void;
}) {
  return (
    <div className="space-y-1.5" data-testid={`add-${noun}-config`}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.allowed} disabled={disabled} onChange={(e) => onChange({ ...value, allowed: e.target.checked, max: Math.max(value.max, own + 1) })} data-testid={`allow-${noun}`} /> {title}</label>
      {value.allowed && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
          <div>
            <label className={LABEL} htmlFor={`add-${noun}-max`}>Maximum {noun}</label>
            <input id={`add-${noun}-max`} type="number" min={own} max={ceiling} autoComplete="off" className={INPUT} disabled={disabled} value={value.max} data-testid={`max-${noun}`}
              onChange={(e) => onChange({ ...value, max: Math.min(ceiling, Math.max(own, Number(e.target.value) || own)) })} />
          </div>
          <div>
            <label className={LABEL} htmlFor={`add-${noun}-name`}>New one is called</label>
            <AutoTextarea id={`add-${noun}-name`} className={INPUT} disabled={disabled} value={value.defaultName} maxLength={60} placeholder={noun === 'columns' ? 'Competitor #' : 'Criterion #'}
              onChange={(defaultName) => onChange({ ...value, defaultName })} />
          </div>
          <p className="col-span-2 -mt-0.5 text-[11px] text-gray-400">The maximum counts your own {noun} too. “#” becomes the next number (“{value.defaultName.includes('#') ? value.defaultName.replace('#', String(own + 1)) : `${value.defaultName || 'New'} 2`}”); the applicant can rename what they add.</p>
        </div>
      )}
    </div>
  );
}

export function TableEditor({ value, disabled, onChange }: { value: TableConfig; disabled?: boolean; onChange: (t: TableConfig) => void }) {
  const set = (patch: Partial<TableConfig>) => onChange({ ...value, ...patch });
  const numbered = value.rows.length > 0 && value.rows.every((r) => !r.label);
  const [sample, setSample] = useState<AnswerValue>(null);

  const setRowsText = (text: string) => {
    if (text.trim() === '') {                                                  // empty: the rows are just numbered; keep how many there were
      const n = Math.max(1, value.rows.length);
      set({ rows: Array.from({ length: n }, (_, i) => ({ id: value.rows[i]?.id ?? newTableRowId(), label: '' })) });
      return;
    }
    const rows = textToHeaders(text, value.rows, newTableRowId, MAX_TABLE_ROWS);
    set({ rows, rowKinds: Object.fromEntries(Object.entries(value.rowKinds).filter(([id]) => rows.some((r) => r.id === id))) });
  };
  const setRowCount = (n: number) => {
    const count = Math.min(MAX_TABLE_ROWS, Math.max(1, n || 1));
    set({ rows: Array.from({ length: count }, (_, i) => ({ id: value.rows[i]?.id ?? newTableRowId(), label: '' })) });
  };
  const setRowKind = (rowId: string, kind: string) => {
    const next = { ...value.rowKinds };
    if (kind === '' || kind === value.cellKind) delete next[rowId]; else next[rowId] = kind as TableCellKind;
    set({ rowKinds: next });
  };

  const previewField: FormField = {
    id: 'table-preview', page: 1, position: 0, kind: 'table', label: 'Preview', instruction: null, required: false, options: [], validations: { table: value },
    condition: null, platformMapping: null, expectedType: null, maxAgeMonths: null,
  };

  return (
    <div className="min-w-0 space-y-3" data-testid="table-config">
      <p className="rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-500">A table has headers on both sides: you set the <b>rows</b> (the criteria, down the first column) and the <b>columns</b> (the things compared, along the first row); the applicant fills in the cells. For a list of entries that each answer the same questions (team members), use a repeatable group instead.</p>

      <div>
        <label className={LABEL} htmlFor="tbl-corner">Corner title (optional)</label>
        <AutoTextarea id="tbl-corner" className={INPUT} disabled={disabled} value={value.cornerTitle} maxLength={100} placeholder="Relevant criteria" onChange={(cornerTitle) => set({ cornerTitle })} />
      </div>

      <div>
        <label className={LABEL} htmlFor="tbl-rows">Row headers — the first column</label>
        <HeadersText id="tbl-rows" headers={numbered ? [] : value.rows} rows={Math.min(8, Math.max(3, value.rows.length + 1))} disabled={disabled} testId="rows-text"
          placeholder={'One per line, e.g.\nProducts & Services\nBusiness Model\nMarket Share (%)'} onText={setRowsText} />
        {numbered ? (
          <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-end gap-2">
            <div>
              <label className={LABEL} htmlFor="tbl-rowcount">Number of rows</label>
              <input id="tbl-rowcount" type="number" min={1} max={MAX_TABLE_ROWS} autoComplete="off" className={INPUT} disabled={disabled} value={value.rows.length} data-testid="row-count" onChange={(e) => setRowCount(Number(e.target.value))} />
            </div>
            <p className="text-[11px] text-gray-400">No row headers: the rows are just numbered 1, 2, 3…</p>
          </div>
        ) : <p className="mt-1 text-[11px] text-gray-400">{value.rows.length} row{value.rows.length === 1 ? '' : 's'}. Leave it empty and the rows are just numbered.</p>}
      </div>

      <div>
        <label className={LABEL} htmlFor="tbl-cols">Column headers — the first row</label>
        <HeadersText id="tbl-cols" headers={value.columns} rows={Math.min(8, Math.max(3, value.columns.length + 1))} disabled={disabled} testId="columns-text"
          placeholder={'One per line, e.g.\nYour solution/company\nCompetitor #1\nCompetitor #2'} onText={(t) => set({ columns: textToHeaders(t, value.columns, newTableColumnId, MAX_TABLE_COLUMNS) })} />
        <p className="mt-1 text-[11px] text-gray-400">{value.columns.length} column{value.columns.length === 1 ? '' : 's'} (at least one).</p>
      </div>

      <div>
        <label className={LABEL} htmlFor="tbl-kind">Type of the cells</label>
        <select id="tbl-kind" className={INPUT} disabled={disabled} value={value.cellKind} data-testid="cell-kind"
          onChange={(e) => set({ cellKind: e.target.value as TableCellKind, rowKinds: Object.fromEntries(Object.entries(value.rowKinds).filter(([, k]) => k !== e.target.value)) })}>
          {TABLE_CELL_KINDS.map((k) => <option key={k} value={k}>{TABLE_CELL_KIND_LABELS[k]}</option>)}
        </select>
        {value.rows.length > 0 && (
          <details className="mt-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5" data-testid="row-kinds">
            <summary className="cursor-pointer text-xs font-medium text-[#0E7490]">A different type for some rows{Object.keys(value.rowKinds).length > 0 ? ` (${Object.keys(value.rowKinds).length})` : ''}</summary>
            <ul className="mt-1.5 space-y-1.5">
              {value.rows.map((r, i) => (
                <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
                  <span className="text-xs text-gray-700 [overflow-wrap:anywhere]">{r.label || `Row ${i + 1}`}</span>
                  <select aria-label={`Type of ${r.label || `row ${i + 1}`}`} className={INPUT} disabled={disabled} value={value.rowKinds[r.id] ?? ''} onChange={(e) => setRowKind(r.id, e.target.value)}>
                    <option value="">Same as the table</option>
                    {TABLE_CELL_KINDS.filter((k) => k !== value.cellKind).map((k) => <option key={k} value={k}>{TABLE_CELL_KIND_LABELS[k]}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="space-y-2.5">
        <span className={LABEL}>What the applicant can add</span>
        <AddRuleEditor title="Applicants can add columns" noun="columns" value={value.addColumns} own={value.columns.length} ceiling={MAX_TABLE_COLUMNS} disabled={disabled} onChange={(r) => set({ addColumns: r })} />
        <AddRuleEditor title="Applicants can add rows" noun="rows" value={value.addRows} own={value.rows.length} ceiling={MAX_TABLE_ROWS} disabled={disabled} onChange={(r) => set({ addRows: r })} />
        <p className="text-[11px] text-gray-400">An applicant can rename and remove only what they added — never your own headers.</p>
      </div>

      <div role="radiogroup" aria-label="What is required" data-testid="table-required">
        <span className={LABEL}>What is required</span>
        {([['none', 'No cell in particular'], ['all', 'Every cell of your columns'], ['first_column', 'Only the first column (e.g. the applicant’s own company)']] as [TableRequired, string][]).map(([k, text]) => (
          <label key={k} className="mt-1 flex items-start gap-2 text-sm"><input type="radio" name="tbl-required" className="mt-1" checked={value.required === k} disabled={disabled} onChange={() => set({ required: k })} data-testid={`required-${k}`} /> <span className="min-w-0">{text}</span></label>
        ))}
        <p className="mt-1 text-[11px] text-gray-400">The columns the applicant adds are never required. With “Required” ticked above and no cell in particular, one cell must be filled.</p>
      </div>

      <div data-testid="table-preview">
        <span className={LABEL}>Preview</span>
        <div className="mt-1 rounded-lg border border-dashed border-gray-300 p-2.5">
          <TablePreview field={previewField} value={sample} currency="EUR" onChange={setSample} />
        </div>
        <p className="mt-1 text-[11px] text-gray-400">As an applicant sees it on a computer, reduced to fit this panel; switch to Phone to see the cards, or open the full preview. It is the same preview as in Review &amp; publish. Nothing is saved.</p>
      </div>
    </div>
  );
}
