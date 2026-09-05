'use client';
// Prompt 572 §A — the "queue opens with a list + decision panel" pattern,
// built once so 573/574 (and whatever comes after) reuse it instead of each
// hand-rolling their own split. Left is QueueTable, unchanged — it already
// owns paging/sort/filters/bulk-selection in the URL (Prompt 570 §C). This
// file only adds the RIGHT side: a single selected row's decision panel,
// coordinated by row clicks (QueueTable's own onRowClick/activeId, added
// alongside this file) rather than QueueTable's unrelated bulk-selection
// checkboxes or inline renderExpanded (a queue picks ONE of panel or
// inline-expand, not both — AddedByStartupsTab's old renderExpanded is
// gone now that it has a panel).
//
// Responsive per §A.5: >=1280px the panel sits beside the list; below that
// it becomes a bottom sheet over the list (same "escape hatch" shape as
// every portal-rendered overlay in this codebase — see AccountActionPanel
// for the identical backdrop-click-to-close pattern, done inline here
// rather than via createPortal since this panel is never full-viewport on
// the >=1280 layout it spends most of its life in).
import { useState, type ReactNode } from 'react';
import { QueueTable, type QueueTableProps } from './QueueTable';

export function ReviewQueueLayout<T>({
  selectedId, onSelect, renderPanel, panelTitle, emptyPanelMessage = 'Select a row to review it.',
  ...queueTableProps
}: QueueTableProps<T> & {
  /** Id of the row currently open in the panel, or null if none. Lives in
   * the caller (not the URL): switching rows should not itself change page/
   * sort/filters, and a queue with no rows selected should not clutter the
   * URL with an empty `?open=` either. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  renderPanel: (row: T) => ReactNode;
  /** Shown in the panel's own header, next to the close button. */
  panelTitle?: (row: T) => ReactNode;
  emptyPanelMessage?: string;
}) {
  const { rows, getRowId } = queueTableProps;
  const selectedRow = selectedId ? rows.find((r) => getRowId(r) === selectedId) ?? null : null;

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1">
        <QueueTable<T> {...queueTableProps}
          onRowClick={(row) => onSelect(getRowId(row))}
          activeId={selectedId} />
      </div>

      {selectedId && (
        // Below xl: a bottom sheet over the list. The backdrop is `fixed`
        // and this whole block is NOT portaled — CLAUDE.md's portal rule is
        // about an ancestor with backdrop-blur/filter/etc. silently
        // becoming the containing block for a `fixed` descendant; nothing
        // between this component and the page root sets any of those, and
        // this file IS one of the two known instances (BackofficeShell's
        // own header) — checked directly, neither backoffice/layout.tsx
        // nor BackofficeShell apply blur/filter/transform to their content
        // area. At >=xl the fixed backdrop is hidden and the panel lays out
        // in normal flow instead (xl:static etc. below).
        <div className="fixed inset-0 z-40 xl:static xl:z-auto xl:w-[420px] xl:shrink-0">
          <div className="absolute inset-0 bg-black/30 xl:hidden" onClick={() => onSelect(null)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white shadow-2xl xl:sticky xl:top-4 xl:inset-auto xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:rounded-2xl xl:shadow-[0_4px_20px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div className="min-w-0 text-sm font-semibold text-gray-900">
                {selectedRow && panelTitle ? panelTitle(selectedRow) : 'Review'}
              </div>
              <button onClick={() => onSelect(null)} aria-label="Close" className="shrink-0 text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-4">
              {selectedRow ? renderPanel(selectedRow) : <p className="text-sm text-gray-400">{emptyPanelMessage}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Prompt 572 §A.2 — the four P4 questions ("o quê · quem/de onde · prova ·
// e depois") as one small layout primitive, so every panel states them in
// the same shape instead of four different ad hoc <dl>s. Any of the four
// can be omitted (not every queue has all four facts, e.g. GDPR's "prova"
// is the email-domain match, New investors' might be a duplicate check).
export function ReviewFacts({ what, whoFrom, proof, thenWhat }: {
  what?: ReactNode; whoFrom?: ReactNode; proof?: ReactNode; thenWhat?: ReactNode;
}) {
  const rows: [string, ReactNode][] = [
    ['What', what], ['Who / from where', whoFrom], ['Proof', proof], ['Then what', thenWhat],
  ].filter(([, v]) => v != null) as [string, ReactNode][];
  if (rows.length === 0) return null;
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
          <dd className="mt-0.5 text-gray-700">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Prompt 572 §A.2 — the footer actions every panel needs: an affirmative
// action (Approve/Link/Verify — never requires a reason), a same-shape
// negative one (Reject — always requires a reason, "razão obrigatória" per
// the prompt's own repeated instruction), and an optional neutral one
// (Dismiss — also reason-required, "Decisões já tomadas": razão obrigatória
// em tudo o que é destrutivo, and dismissing a real decision counts).
// Deliberately NOT the same component as AccountActionPanel: that one is a
// portal-rendered side-sheet hardwired to POST /api/backoffice/moderation/
// {suspend,delete} (checked directly — its `action` type and its fetch URL
// are both hardcoded to that one endpoint). Generalizing it to every
// caller's own endpoint is exactly the shape this component provides
// instead, reusing AccountActionPanel's own "type a reason, confirm is
// disabled until non-empty" rule rather than its wiring.
export function ReviewActionFooter({
  onApprove, approveLabel = 'Approve', approveDisabled, onReject, rejectLabel = 'Reject', onDismiss, dismissLabel = 'Dismiss',
  busy,
}: {
  onApprove?: () => void | Promise<void>; approveLabel?: string; approveDisabled?: boolean;
  onReject?: (reason: string) => void | Promise<void>; rejectLabel?: string;
  onDismiss?: (reason: string) => void | Promise<void>; dismissLabel?: string;
  busy?: boolean;
}) {
  const [mode, setMode] = useState<'reject' | 'dismiss' | null>(null);
  const [reason, setReason] = useState('');

  if (mode) {
    const label = mode === 'reject' ? rejectLabel : dismissLabel;
    const run = mode === 'reject' ? onReject : onDismiss;
    return (
      <div className="space-y-1.5">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus
          placeholder={`Reason for ${label.toLowerCase()} (required)`}
          className="w-full rounded-lg border border-gray-300 p-2 text-xs" />
        <div className="flex gap-1.5">
          <button disabled={busy || reason.trim().length === 0} onClick={() => { void run?.(reason.trim()); setMode(null); setReason(''); }}
            className="rounded-lg bg-[#B00000] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
            {busy ? 'Working…' : `Confirm ${label.toLowerCase()}`}
          </button>
          <button disabled={busy} onClick={() => { setMode(null); setReason(''); }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {onApprove && (
        <button disabled={busy || approveDisabled} onClick={() => void onApprove()}
          className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? 'Working…' : approveLabel}
        </button>
      )}
      {onDismiss && (
        <button disabled={busy} onClick={() => setMode('dismiss')}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 disabled:opacity-40">
          {dismissLabel}
        </button>
      )}
      {onReject && (
        <button disabled={busy} onClick={() => setMode('reject')}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-[#B00000] disabled:opacity-40">
          {rejectLabel}
        </button>
      )}
    </div>
  );
}
