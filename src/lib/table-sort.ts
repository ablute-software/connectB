// Prompt 569 §7 — one comparator and one toggle rule for the back-office
// tables that sort in the browser.
//
// Startups already sorted; Investors did not sort at all, seventeen columns of
// static headers. Rather than write a second implementation beside the first,
// the working one moved here and both pages use it — the same reason the
// catalog matcher was reused in 570 rather than rewritten: two definitions of
// "which of these two rows comes first" eventually disagree, and nobody
// notices until a list looks wrong in one place and right in the other.
//
// Deliberately NOT QueueTable. That component pages on the server, carries
// selection across pages and owns a "Hide internal" filter — none of which
// these two tables want, and adopting it would mean rewriting a 656-line page
// to gain a sort. Sharing the rule is the reuse that matters here; sharing the
// chrome would have been cargo.

export type SortDir = 'asc' | 'desc';

/**
 * Nulls last in BOTH directions, which is the point worth stating: a column
 * sorted descending should show the largest values first, not a wall of
 * blanks. "No data" is not a value at either end of a scale.
 */
export function compareCells(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return 0;
}

/** Clicking the sorted column flips it; clicking another switches to it, ascending. */
export function nextSort<K extends string>(
  current: { key: K; dir: SortDir }, clicked: K,
): { key: K; dir: SortDir } {
  if (current.key !== clicked) return { key: clicked, dir: 'asc' };
  return { key: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/**
 * Sorts a copy. `nulls last` survives the direction flip because the
 * comparator decides it, not the multiplier — reversing a comparator that put
 * nulls last would put them first.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[], key: K, dir: SortDir, get: (row: T, key: K) => unknown = (r, k) => (r as Record<string, unknown>)[k],
): T[] {
  return [...rows].sort((a, b) => {
    const av = get(a, key); const bv = get(b, key);
    if (av == null || bv == null) return compareCells(av, bv);
    return compareCells(av, bv) * (dir === 'asc' ? 1 : -1);
  });
}

/** The arrow a header shows: filled for the active column, nothing otherwise. */
export function sortIndicator(active: boolean, dir: SortDir): string {
  return active ? (dir === 'asc' ? '▲' : '▼') : '';
}
