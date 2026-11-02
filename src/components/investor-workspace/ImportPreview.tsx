'use client';
// Prompt AL759 §B — the import preview that does not make an investor read 50
// lines. Three blocks, in this order:
//   1. one SUMMARY line, always visible ("48 ready · 2 with warnings · 1
//      duplicate · 1 error") next to the Import button;
//   2. NEEDS YOUR ATTENTION — only rows with an error, a warning or a
//      duplicate, each with the card it always had (first 10, then "Show all
//      N"); with none, it just says "No problems found";
//   3. SAMPLE — the first 5 valid rows as they will be saved, in the same
//      table the destination tab uses; "Show all N rows" (closed by default)
//      expands the full list, with a checkbox per row to untick.
// Ready rows get no card of their own and arrive ticked.
//
// Presentational: PortfolioPanel's ImportFlow owns the plan and every
// callback below.
import { useState } from 'react';
import {
  ATTENTION_PREVIEW_LIMIT, attentionItems, classifyItem, needsReadAs, planSummaryText, rowToDisplayCompany,
  sampleItems, summarizePlan, formatDateDisplay, formatTicketDisplay, PORTFOLIO_IMPORT_FIELDS,
  type PortfolioImportField, type PortfolioImportPlanItem, type PortfolioCompanyRow,
} from '@/lib/portfolio-import';
import { EXIT_TYPE_LABELS, INSTRUMENT_LABELS, portfolioColumns, type PortfolioTab } from '@/lib/portfolio-table';
import { portfolioCell } from './PortfolioTable';

type Raw = Partial<Record<PortfolioImportField, string>>;

export function ImportPreview({
  items, destination, editingRow, busy, defaultShowAllAttention = false, defaultShowAllRows = false,
  onImport, onToggleInclude, onImportAnyway, onEditRow, onSaveRowEdit, onAcceptSuggestion, onBulk, onDownloadErrors,
}: {
  items: PortfolioImportPlanItem[];
  /** The tab the rows will land in — decides the sample table's columns. */
  destination: PortfolioTab;
  editingRow: number | null;
  busy: boolean;
  /** Initial state of the two expanders — only a test needs to start them open. */
  defaultShowAllAttention?: boolean;
  defaultShowAllRows?: boolean;
  onImport: () => void;
  onToggleInclude: (row: number) => void;
  onImportAnyway: (row: number) => void;
  onEditRow: (row: number | null) => void;
  onSaveRowEdit: (row: number, edited: Raw) => void;
  onAcceptSuggestion: (row: number, token: string, canonical: string) => void;
  onBulk: (cls: 'duplicate' | 'warning', include: boolean) => void;
  onDownloadErrors: () => void;
}) {
  const [showAllAttention, setShowAllAttention] = useState(defaultShowAllAttention);
  const [showAllRows, setShowAllRows] = useState(defaultShowAllRows);

  const summary = summarizePlan(items);
  const attention = attentionItems(items);
  const visibleAttention = showAllAttention ? attention : attention.slice(0, ATTENTION_PREVIEW_LIMIT);
  const sample = sampleItems(items);
  const rowsWithData = items.filter((it) => it.data !== null);
  // Whether the bulk buttons should offer to exclude or to include.
  const dupItems = items.filter((it) => classifyItem(it) === 'duplicate');
  const warnItems = items.filter((it) => classifyItem(it) === 'warning');
  const anyDupIncluded = dupItems.some((it) => it.include);
  const anyWarnIncluded = warnItems.some((it) => it.include);

  return (
    <div className="mt-3" data-testid="import-preview">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs font-semibold text-gray-700" data-testid="import-summary">{planSummaryText(summary)}</p>
        <button onClick={onImport} disabled={busy || summary.included === 0}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {busy ? 'Importing…' : `Import ${summary.included} ${summary.included === 1 ? 'company' : 'companies'}`}
        </button>
      </div>

      {(dupItems.length > 0 || warnItems.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
          {dupItems.length > 0 && (
            <button onClick={() => onBulk('duplicate', !anyDupIncluded)} className="text-[#0E7490] hover:underline">
              {anyDupIncluded ? 'Exclude all duplicates' : 'Include all duplicates'}
            </button>
          )}
          {warnItems.length > 0 && (
            <button onClick={() => onBulk('warning', !anyWarnIncluded)} className="text-[#0E7490] hover:underline">
              {anyWarnIncluded ? 'Exclude rows with warnings' : 'Include rows with warnings'}
            </button>
          )}
        </div>
      )}

      <div className="mt-3">
        {attention.length === 0 ? (
          <p className="text-[11px] text-gray-400" data-testid="no-problems">No problems found</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h4 className="text-xs font-semibold text-gray-700">Needs your attention ({attention.length})</h4>
              {summary.errors > 0 && (
                <button onClick={onDownloadErrors} className="text-[11px] text-[#0E7490] hover:underline">
                  Download rows with errors
                </button>
              )}
            </div>
            <ul className="mt-1 space-y-1 text-xs">
              {visibleAttention.map((it) => (
                <AttentionCard key={it.row} it={it} editing={editingRow === it.row}
                  onImportAnyway={onImportAnyway} onEditRow={onEditRow} onSaveRowEdit={onSaveRowEdit}
                  onAcceptSuggestion={onAcceptSuggestion} onToggleInclude={onToggleInclude} />
              ))}
            </ul>
            {attention.length > ATTENTION_PREVIEW_LIMIT && !showAllAttention && (
              <button onClick={() => setShowAllAttention(true)} className="mt-1 text-[11px] text-[#0E7490] hover:underline">
                Show all {attention.length}
              </button>
            )}
          </>
        )}
      </div>

      {sample.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold text-gray-700">
            {showAllRows
              ? `All ${rowsWithData.length} rows${items.length > rowsWithData.length ? ` (${items.length - rowsWithData.length} unreadable ${items.length - rowsWithData.length === 1 ? 'row is' : 'rows are'} listed above)` : ''}`
              : `Sample (first ${sample.length})`}
          </h4>
          <SampleTable
            items={showAllRows ? rowsWithData : sample} destination={destination} full={showAllRows}
            onToggleInclude={onToggleInclude}
          />
          <button onClick={() => setShowAllRows((v) => !v)} className="mt-1 text-[11px] text-[#0E7490] hover:underline">
            {showAllRows ? 'Show sample only' : `Show all ${items.length} rows`}
          </button>
        </div>
      )}
    </div>
  );
}

function AttentionCard({ it, editing, onImportAnyway, onEditRow, onSaveRowEdit, onAcceptSuggestion, onToggleInclude }: {
  it: PortfolioImportPlanItem; editing: boolean;
  onImportAnyway: (row: number) => void; onEditRow: (row: number | null) => void;
  onSaveRowEdit: (row: number, edited: Raw) => void; onAcceptSuggestion: (row: number, token: string, canonical: string) => void;
  onToggleInclude: (row: number) => void;
}) {
  return (
    <li data-testid="attention-card"
      className={`rounded-lg border px-2.5 py-1.5 ${it.errors.length ? 'border-red-100 bg-red-50/50' : 'border-amber-100 bg-amber-50/50'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={it.include} disabled={it.data === null || it.errors.length > 0}
          aria-label={`Include row ${it.row}`} onChange={() => onToggleInclude(it.row)} />
        <span className="font-medium">Row {it.row}</span>
        <span className="text-gray-600">{it.data?.companyName ?? '(no company name)'}</span>
        {it.duplicate && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
            duplicate ({it.duplicate.reason}, {it.duplicate.against === 'existing' ? 'already in your portfolio' : 'repeated in this file'})
          </span>
        )}
        {/* Warnings are included by default (Prompt AL757 §E), so the only row
            this can still change anything for is an un-opted duplicate. */}
        {it.duplicate && !it.include && it.errors.length === 0 && (
          <button onClick={() => onImportAnyway(it.row)} className="ml-auto rounded-full border border-amber-300 px-2 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-100">
            Import anyway
          </button>
        )}
        {(it.errors.length > 0 || it.warnings.length > 0) && (
          <button onClick={() => onEditRow(editing ? null : it.row)}
            className="rounded-full border border-gray-300 px-2 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-100">
            {editing ? 'Close' : 'Fix this row'}
          </button>
        )}
      </div>
      {it.errors.length > 0 && (
        <ul className="ml-6 mt-0.5 list-disc text-[11px] text-[#B00000]">
          {it.errors.map((e, i) => <li key={i}>{e.field ? `${e.field}: ` : ''}{e.message}</li>)}
        </ul>
      )}
      {it.warnings.length > 0 && (
        <ul className="ml-6 mt-0.5 list-disc text-[11px] text-amber-700">
          {it.warnings.map((w, i) => (
            <li key={i}>
              {w.field ? `${w.field}: ` : ''}{w.message}
              {w.suggestion && (
                <button onClick={() => onAcceptSuggestion(it.row, w.suggestion!.token, w.suggestion!.canonical)}
                  className="ml-1 font-semibold text-amber-900 hover:underline">
                  Use &ldquo;{w.suggestion.canonical}&rdquo;
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* "Lido como" only where it earns its place: a warning (this card) or a
          date a human could read month-first. Plain rows show it in the sample. */}
      {!editing && needsReadAs(it) && <ReadAsSummary raw={it.raw} data={it.data} />}
      {editing && <RowEditor fields={it.raw} onSave={(edited) => onSaveRowEdit(it.row, edited)} onCancel={() => onEditRow(null)} />}
    </li>
  );
}

function SampleTable({ items, destination, full, onToggleInclude }: {
  items: PortfolioImportPlanItem[]; destination: PortfolioTab; full: boolean; onToggleInclude: (row: number) => void;
}) {
  const columns = portfolioColumns(destination);
  return (
    <div className="mt-1 overflow-x-auto rounded-lg border border-gray-200 bg-white" data-testid={full ? 'import-full-table' : 'import-sample-table'}>
      <table className="w-full text-left text-[11px]">
        <thead className="border-b border-gray-100 text-gray-500">
          <tr>
            {full && <th className="w-6 px-2 py-1.5" />}
            <th className="px-2 py-1.5 font-medium">Row</th>
            {columns.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-1.5 font-medium">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const company = rowToDisplayCompany(it.data as PortfolioCompanyRow, `row-${it.row}`);
            // In the full list, a row a human could misread (ambiguous day) keeps its "read as" line.
            const readAs = full && needsReadAs(it);
            return (
              <tr key={it.row} data-testid="import-row" className="border-b border-gray-50 align-top last:border-0">
                {full && (
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={it.include} disabled={it.errors.length > 0}
                      aria-label={`Include row ${it.row}`} onChange={() => onToggleInclude(it.row)} />
                  </td>
                )}
                <td className="px-2 py-1.5 text-gray-400">{it.row}</td>
                {columns.map((c) => (
                  <td key={c.key} className="px-2 py-1.5 text-gray-600">
                    {portfolioCell(c.key, company)}
                    {readAs && c.key === 'company' && <ReadAsSummary raw={it.raw} data={it.data} compact />}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// "O original e o lido" — the original cell text next to what it was read as,
// for the fields the parser most often transforms in a way worth a second look.
export function ReadAsSummary({ raw, data, compact = false }: {
  raw: Raw; data: PortfolioCompanyRow | null; compact?: boolean;
}) {
  const lines: string[] = [];
  if (raw.ticket_eur && data?.ticketEur != null) lines.push(`ticket_eur: "${raw.ticket_eur}" → ${formatTicketDisplay(data.ticketEur)}`);
  if (raw.invested_at && data?.investedAt) lines.push(`invested_at: "${raw.invested_at}" → ${formatDateDisplay(data.investedAt)}`);
  if (raw.exit_at && data?.exitAt) lines.push(`exit_at: "${raw.exit_at}" → ${formatDateDisplay(data.exitAt)}`);
  if (raw.instrument && data?.instrument) lines.push(`instrument: "${raw.instrument}" → ${INSTRUMENT_LABELS[data.instrument] ?? data.instrument}`);
  if (raw.exit_type && data?.exitType) lines.push(`exit_type: "${raw.exit_type}" → ${EXIT_TYPE_LABELS[data.exitType] ?? data.exitType}`);
  if (lines.length === 0) return null;
  return (
    <ul className={`${compact ? 'mt-0.5' : 'ml-6 mt-0.5'} space-y-0.5 text-[11px] font-normal text-gray-500`} data-testid="read-as">
      {lines.map((l) => <li key={l}>{l}</li>)}
    </ul>
  );
}

// The per-row correction form — every mapped field, pre-filled with the
// ORIGINAL cell text (not the parsed value), so fixing a typo means editing
// exactly what the file said. Re-validates on Save through the same
// parsePortfolioFields the initial import used ("revalidam-se ao editar").
export function RowEditor({ fields, onSave, onCancel }: {
  fields: Raw; onSave: (edited: Raw) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Raw>(fields);
  const mappedFields = PORTFOLIO_IMPORT_FIELDS.filter((f) => fields[f] !== undefined);

  return (
    <div className="ml-6 mt-1.5 rounded-lg border border-gray-200 bg-white p-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {mappedFields.map((field) => (
          <label key={field} className="text-[11px] text-gray-500">
            {field}
            <input value={draft[field] ?? ''} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
              autoComplete="off" className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]" />
          </label>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={() => onSave(draft)} className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-[11px] font-medium text-white">Save row</button>
        <button onClick={onCancel} className="rounded-lg border border-gray-300 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
      </div>
    </div>
  );
}
