// Prompt 574 §A.1 — GDPR is the one queue with a real legal deadline: 30
// days from the request, computed (gdpr_requests has no due_at column —
// confirmed by reading its schema), never stored. Before this file, three
// separate copies of "30 days from created_at" existed (queue-summary.ts,
// the Attention rollup, and the Queue page's own GdprTab) — a shared
// function here so a future change to the deadline window, or to how
// "overdue" reads, only has one place to make it.
export const GDPR_DEADLINE_DAYS = 30;

export interface GdprDue {
  daysLeft: number;
  overdue: boolean;
  /** "6 days left of 30" / "OVERDUE by 3" — the exact copy §A.1 asks for. */
  label: string;
}

export function gdprDueAt(createdAt: string, now: number = Date.now()): GdprDue {
  const ageDays = Math.floor((now - new Date(createdAt).getTime()) / 86400000);
  const daysLeft = GDPR_DEADLINE_DAYS - ageDays;
  const overdue = daysLeft < 0;
  return {
    daysLeft, overdue,
    label: overdue ? `OVERDUE by ${-daysLeft}` : `${daysLeft} days left of ${GDPR_DEADLINE_DAYS}`,
  };
}
