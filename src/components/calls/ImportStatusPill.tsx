'use client';
// Prompt 909 (Adenda 2b) — "Proposal ready to review" / "Reading the documents…" next to the Import button of a call, so the person who left the
// screen finds the way back to their proposal exactly where they started it.
import { IMPORT_STATUS_LABEL, type ImportStatus } from '@/lib/calls/ai-import/screen-state';

export function ImportStatusPill({ status, onClick }: { status: ImportStatus; onClick?: () => void }) {
  if (!status) return null;
  const tone = status === 'ready' ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200' : 'bg-amber-100 text-amber-900';
  const cls = `rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`;
  return onClick
    ? <button type="button" onClick={onClick} className={cls} data-testid="import-status" data-status={status}>{IMPORT_STATUS_LABEL[status]}</button>
    : <span className={cls} role="status" data-testid="import-status" data-status={status}>{IMPORT_STATUS_LABEL[status]}</span>;
}
