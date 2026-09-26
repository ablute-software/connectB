// Prompt 737 §9.A (dossier rico) — formats a catalog_evidence role_history
// period (period_from/period_from_precision/period_to/period_to_precision/
// period_is_current) into the text the founder reads. Never invents a day
// or month the source didn't actually have: a `year` precision shows only
// the year, `month` shows month+year, `exact_day` shows the full date —
// per the importer's own rule (plano_definitivo... D.3), the stored date
// is always day/month 01 as a sortable placeholder, never the true day.
export type DatePrecision = 'exact_day' | 'month' | 'year' | 'approximate' | null | undefined;

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatOneEnd(date: string | null | undefined, precision: DatePrecision): string | null {
  if (!date) return null;
  const [yearStr, monthStr] = date.split('-');
  const year = yearStr;
  if (precision === 'year') return year;
  if (precision === 'month') {
    const monthIdx = Number(monthStr) - 1;
    return `${MONTH_NAMES[monthIdx] ?? monthStr} ${year}`;
  }
  if (precision === 'exact_day') return date;
  // 'approximate' or unrecognised precision paired with a real date: show
  // the year with an explicit qualifier rather than a bare, falsely-precise
  // number.
  return `c. ${year}`;
}

export interface PeriodInput {
  periodFrom?: string | null;
  periodFromPrecision?: DatePrecision;
  periodTo?: string | null;
  periodToPrecision?: DatePrecision;
  periodIsCurrent?: boolean | null;
}

// Returns null when there is nothing to show at all (both ends absent and
// not marked current) — the caller renders no period text in that case,
// never a placeholder like "unknown–unknown".
export function formatPeriod(p: PeriodInput): string | null {
  const from = formatOneEnd(p.periodFrom, p.periodFromPrecision);
  const to = p.periodIsCurrent ? 'present' : formatOneEnd(p.periodTo, p.periodToPrecision);

  if (!from && !to) return null;
  if (from && !to) return p.periodIsCurrent ? `${from} – present` : from;
  if (!from && to) return to;
  return `${from} – ${to}`;
}
