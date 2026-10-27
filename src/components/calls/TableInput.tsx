'use client';
// Prompt 917 (Adenda 2, B2) — a Table question as the applicant answers it (and as the entity's preview, the test mode, the read-only copy and the Submissions tab show it).
//
//   The entity's headers are fixed and cannot be edited. If the entity allows it, "+ Add column" and "+ Add row" appear (up to its maximum, its own headers counted); what the APPLICANT added
//   has a header they can rename and a ✕ that removes it (asking first when something was written in it) — and nothing else has a ✕.
//   Compact in the form: the table scrolls sideways INSIDE its own box, never the page. "Expand table" opens it full screen, the first column and the header row staying in place while you scroll,
//   long cells growing with their text; "Done" goes back; the draft keeps saving exactly as before because the same onChange is used. On a phone (< 640 px) it is drawn as CARDS: one card per column
//   (e.g. "Competitor #1") with the criteria as its fields, the buttons to add and remove still there.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatNumberDisplay } from '@/lib/calls/form-logic';
import {
  cellKindOf, isTableAnswered, nextDefaultName, newTableExtraId, tableAnswerOf, tableColumns, tableIssues, tableOf, tableRows,
  type TableHeaderView,
} from '@/lib/calls/table';
import type { AnswerValue, FormField, TableAnswer, TableCellKind, TableConfig } from '@/lib/calls/types';
import { AutoTextarea } from './AutoTextarea';

const BTN = 'rounded-lg border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40';
const CELL = 'block w-full min-w-0 rounded-md border bg-white px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-700';
const HEAD = 'border-b border-r border-gray-200 bg-gray-50 px-2 py-1.5 text-left align-top text-xs font-semibold text-gray-700';
const SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 640px)');
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

const PERCENT_TYPED = /^\d{0,3}([.,]\d{0,2})?$/;

/** One cell, by the type of its row. A cell is labelled for screen readers by its row and its column (the header it sits under is not a <label>). */
function CellInput({ kind, value, label, error, disabled, currency, onChange, expanded }: {
  kind: TableCellKind; value: string; label: string; error?: string; disabled?: boolean; currency: string; onChange: (v: string) => void; expanded?: boolean;
}) {
  const border = error ? 'border-[#B00000]' : 'border-gray-300';
  if (kind === 'long_text') return <AutoTextarea multiline ariaLabel={label} minRows={expanded ? 3 : 2} className={`${CELL} ${border}`} value={value} disabled={disabled} maxLength={5000} onChange={onChange} />;
  if (kind === 'short_text') return <input aria-label={label} autoComplete="off" className={`${CELL} ${border}`} value={value} disabled={disabled} maxLength={500} onChange={(e) => onChange(e.target.value)} />;
  const suffix = kind === 'percent' ? '%' : kind === 'amount' ? SYMBOL[currency] ?? currency : '';
  return (
    <div className="flex items-center gap-1.5">
      <input aria-label={label} autoComplete="off" inputMode={kind === 'percent' ? 'decimal' : 'numeric'} className={`${CELL} ${border}`} value={value} disabled={disabled} placeholder={kind === 'percent' ? '0 – 100' : 'Digits only'}
        onChange={(e) => {
          const t = e.target.value;
          if (kind === 'percent') { if (PERCENT_TYPED.test(t)) onChange(t); }       // digits and one decimal separator; the final check wants 0 – 100
          else onChange(t.replace(/\D/g, '').slice(0, 15));
        }} />
      {suffix && <span className="shrink-0 text-xs text-gray-500" aria-hidden="true">{suffix}</span>}
    </div>
  );
}

export function TableInput({ field, value, currency, disabled, showAllErrors, variant = 'auto', markAdded, onChange }: {
  field: FormField; value: AnswerValue; currency: string; disabled?: boolean; showAllErrors?: boolean;
  /** `cards` forces the phone layout (the entity's editor shows its preview that way: it must fit its panel); `table` forces the grid. */
  variant?: 'auto' | 'cards' | 'table';
  /** Mark the applicant's own headers "added by applicant" — for a copy that cannot be changed (a submitted application, the Submissions tab). */
  markAdded?: boolean;
  onChange: (v: AnswerValue) => void;
}) {
  const cfg = tableOf(field);
  const narrow = useNarrow();
  const [expanded, setExpanded] = useState(false);
  // The header whose removal is waiting for a yes: asked IN the page, not with the browser's own dialog (one the browser was told to suppress answers "no" without a word).
  const [pending, setPending] = useState<string | null>(null);
  const answer = tableAnswerOf(value);
  const cols = useMemo(() => (cfg ? tableColumns(cfg, value) : []), [cfg, value]);
  const rows = useMemo(() => (cfg ? tableRows(cfg, value) : []), [cfg, value]);
  const issues = useMemo(() => tableIssues(field, value), [field, value]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);
  if (!cfg) return null;

  const asCards = variant === 'cards' || (variant === 'auto' && narrow);
  const mark = markAdded ?? !!disabled;
  const commit = (next: TableAnswer) => {
    const empty = next.columns.length === 0 && next.rows.length === 0 && !isTableAnswered(next);
    onChange(empty ? null : next);
  };
  const cell = (r: string, c: string): string => answer.cells[r]?.[c] ?? '';
  const setCell = (r: string, c: string, v: string) => {
    const row = { ...(answer.cells[r] ?? {}) };
    if (v === '') delete row[c]; else row[c] = v;
    const cells = { ...answer.cells, [r]: row };
    if (Object.keys(row).length === 0) delete cells[r];
    commit({ ...answer, cells });
  };
  /** The message under a cell: a wrong value always; a missing one only once every problem is to be shown. */
  const errorOf = (r: string, c: string): string | undefined => {
    const hit = issues.find((i) => i.key.endsWith(`#${r}/${c}`));
    if (!hit) return undefined;
    const msg = hit.message.slice(hit.message.indexOf(': ') + 2);
    return showAllErrors || cell(r, c).trim() !== '' ? msg : undefined;
  };

  const colRule = cfg.addColumns; const rowRule = cfg.addRows;
  const canAddCol = !disabled && colRule.allowed && cols.length < colRule.max;
  const canAddRow = !disabled && rowRule.allowed && rows.length < rowRule.max;
  const addColumn = () => commit({ ...answer, columns: [...answer.columns, { id: newTableExtraId(), name: nextDefaultName(colRule.defaultName, cols.map((c) => c.label)), addedBy: 'applicant' }] });
  const addRow = () => commit({ ...answer, rows: [...answer.rows, { id: newTableExtraId(), name: nextDefaultName(rowRule.defaultName, rows.map((r) => r.label)), addedBy: 'applicant' }] });
  const rename = (kind: 'columns' | 'rows', id: string, name: string) => commit({ ...answer, [kind]: answer[kind].map((x) => (x.id === id ? { ...x, name: name.slice(0, 200) } : x)) });
  const filled = (kind: 'columns' | 'rows', id: string): boolean => (kind === 'columns'
    ? Object.values(answer.cells).some((row) => (row[id] ?? '').trim() !== '')
    : Object.values(answer.cells[id] ?? {}).some((v) => v.trim() !== ''));
  const remove = (kind: 'columns' | 'rows', h: TableHeaderView, confirmed = false) => {
    if (filled(kind, h.id) && !confirmed) { setPending(`${kind}:${h.id}`); return; }
    setPending(null);
    const cells: Record<string, Record<string, string>> = {};
    for (const [r, row] of Object.entries(answer.cells)) {
      if (kind === 'rows' && r === h.id) continue;
      const next = kind === 'columns' ? Object.fromEntries(Object.entries(row).filter(([c]) => c !== h.id)) : row;
      if (Object.keys(next).length > 0) cells[r] = next;
    }
    commit({ ...answer, [kind]: answer[kind].filter((x) => x.id !== h.id), cells });
  };

  /** A header: the entity's is plain text; the applicant's own can be renamed and removed (and says it was added by them once the copy is read-only). */
  const header = (kind: 'columns' | 'rows', h: TableHeaderView) => (
    <span className="block min-w-0">
    <span className="flex min-w-0 items-start gap-1">
      {h.own && !disabled ? (
        <>
          <AutoTextarea ariaLabel={`Name of ${kind === 'columns' ? 'column' : 'row'} ${h.label}`} className="block w-full min-w-0 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs font-semibold" value={h.label} maxLength={200} onChange={(n) => rename(kind, h.id, n)} />
          <button type="button" className="shrink-0 rounded px-1.5 py-1 text-gray-400 hover:text-[#B00000]" aria-label={`Remove ${kind === 'columns' ? 'column' : 'row'} ${h.label}`} data-testid={`remove-${kind === 'columns' ? 'column' : 'row'}`} onClick={() => remove(kind, h)}>✕</button>
        </>
      ) : (
        <span className="min-w-0 [overflow-wrap:anywhere]">{h.label}{h.own && mark && <span className="ml-1.5 rounded bg-gray-100 px-1 py-0.5 text-[10px] font-medium text-gray-500" data-testid="added-by-applicant">added by applicant</span>}</span>
      )}
    </span>
    {pending === `${kind}:${h.id}` && (
      <span className="mt-1 block rounded border border-[#0E7490] bg-white p-1.5 text-[11px] font-normal text-gray-800" role="group" aria-label="Confirm the removal" data-testid="remove-confirm">
        Remove “{h.label}” and what you wrote in it?
        <span className="mt-1 flex gap-2">
          <button type="button" className="rounded bg-[#0E7490] px-2 py-1 font-semibold text-white" data-testid="remove-confirm-yes" onClick={() => remove(kind, h, true)}>Remove</button>
          <button type="button" className="rounded border border-gray-300 px-2 py-1 text-gray-700" data-testid="remove-confirm-no" onClick={() => setPending(null)}>Keep</button>
        </span>
      </span>
    )}
    </span>
  );

  const rowLabel = (r: TableHeaderView) => r.label || '—';
  const grid = (big: boolean) => (
    <table className="min-w-full border-separate border-spacing-0 text-sm" data-testid={big ? 'table-grid-expanded' : 'table-grid'}>
      <thead>
        <tr>
          <th scope="col" className={`${HEAD} sticky left-0 top-0 z-30 w-44 min-w-[11rem]`}>{cfg.cornerTitle}</th>
          {cols.map((c) => <th key={c.id} scope="col" className={`${HEAD} sticky top-0 z-20 ${big ? 'min-w-[16rem]' : 'min-w-[11rem]'}`}>{header('columns', c)}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} data-testid="table-row">
            <th scope="row" className={`${HEAD} sticky left-0 z-10 w-44 min-w-[11rem] font-medium`}>{header('rows', r)}</th>
            {cols.map((c) => (
              <td key={c.id} className="border-b border-r border-gray-100 bg-white p-1.5 align-top">
                <CellInput kind={cellKindOf(cfg, r.id)} value={cell(r.id, c.id)} label={`${rowLabel(r)} — ${c.label}`} error={errorOf(r.id, c.id)} disabled={disabled} currency={currency} expanded={big} onChange={(v) => setCell(r.id, c.id, v)} />
                {errorOf(r.id, c.id) && <p role="alert" className="mt-0.5 text-[11px] text-[#B00000]" data-testid="cell-error">{errorOf(r.id, c.id)}</p>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const adders = !disabled && (colRule.allowed || rowRule.allowed) ? (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {colRule.allowed && <button type="button" className={BTN} disabled={!canAddCol} onClick={addColumn} data-testid="add-column">+ Add column</button>}
      {rowRule.allowed && <button type="button" className={BTN} disabled={!canAddRow} onClick={addRow} data-testid="add-row">+ Add row</button>}
      <span className="text-[11px] text-gray-400">
        {[colRule.allowed ? `${cols.length} of ${colRule.max} columns` : '', rowRule.allowed ? `${rows.length} of ${rowRule.max} rows` : ''].filter(Boolean).join(' · ')}
      </span>
    </div>
  ) : null;

  if (asCards) {
    const ownRows = rows.filter((r) => r.own);
    return (
      <div data-testid="table-input" data-display="cards" className="min-w-0">
        <div className="space-y-3">
          {cols.map((c) => (
            <fieldset key={c.id} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3" data-testid="table-card">
              <legend className="max-w-full px-1 text-xs font-semibold text-gray-700">{header('columns', c)}</legend>
              <div className="space-y-2.5">
                {rows.map((r) => (
                  <div key={r.id}>
                    <p className="mb-1 text-[11px] font-medium text-gray-500 [overflow-wrap:anywhere]">{rowLabel(r)}{r.own && mark && <span className="ml-1.5 rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-500">added by applicant</span>}</p>
                    <CellInput kind={cellKindOf(cfg, r.id)} value={cell(r.id, c.id)} label={`${rowLabel(r)} — ${c.label}`} error={errorOf(r.id, c.id)} disabled={disabled} currency={currency} onChange={(v) => setCell(r.id, c.id, v)} />
                    {errorOf(r.id, c.id) && <p role="alert" className="mt-0.5 text-[11px] text-[#B00000]" data-testid="cell-error">{errorOf(r.id, c.id)}</p>}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        {ownRows.length > 0 && !disabled && (
          <div className="mt-3 rounded-lg border border-dashed border-gray-300 p-2.5" data-testid="table-own-rows">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Rows you added</p>
            <ul className="space-y-1.5">{ownRows.map((r) => <li key={r.id}>{header('rows', r)}</li>)}</ul>
          </div>
        )}
        {adders}
      </div>
    );
  }

  return (
    <div data-testid="table-input" data-display="table" className="min-w-0">
      <div className="mb-1 flex justify-end print:hidden">
        <button type="button" className={BTN} onClick={() => setExpanded(true)} data-testid="expand-table">Expand table</button>
      </div>
      {/* The box scrolls sideways; the page never does. */}
      <div className="max-w-full overflow-x-auto rounded-lg border border-gray-200" data-testid="table-scroll">{grid(false)}</div>
      {adders}
      {expanded && typeof document !== 'undefined' && createPortal(
        <div role="dialog" aria-modal="true" aria-label={field.label} className="fixed inset-0 z-50 flex flex-col bg-white" data-testid="table-expanded" data-calls-touch>
          <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{field.label}</p>
            <button type="button" onClick={() => setExpanded(false)} data-testid="table-done" className="min-h-[44px] shrink-0 rounded-lg bg-[#0E7490] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0c637b]">Done</button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3" data-testid="table-expanded-scroll">{grid(true)}{adders}</div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** A one-line reading of the table's currency formatting of an amount, for places that show a value rather than an input (the Submissions tab). */
export const formatCell = (kind: TableCellKind, v: string, currency: string): string => (kind === 'amount' ? formatNumberDisplay(v, currency) : kind === 'percent' ? `${v} %` : v);
export type { TableConfig };
