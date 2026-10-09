'use client';
// Prompt 905 — a call's state as a badge. The colour always comes WITH its written label (spec §2.4: never a
// colour alone).
import { CALL_STATUS_LABELS, type CallStatus } from '@/lib/calls/types';

const TONE: Record<CallStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  validated: 'bg-sky-100 text-sky-800',
  scheduled: 'bg-amber-100 text-amber-800',
  open: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-slate-200 text-slate-700',
  evaluating: 'bg-violet-100 text-violet-800',
  results_published: 'bg-indigo-100 text-indigo-800',
  archived: 'bg-gray-100 text-gray-500',
};

export function StatusBadge({ status }: { status: CallStatus }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[status]}`} data-testid="status-badge" data-status={status}>{CALL_STATUS_LABELS[status]}</span>;
}
