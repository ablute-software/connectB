'use client';
// Full feature matrix — rows are the union of every plan's bullets (in
// first-appearance order across the given plans, so cheaper-tier features
// lead), columns are plans, cells are ✓/— or (Prompt 158 §5) a per-plan
// number. Entirely derived from PlanCardData.bullets — no separate feature
// list to keep in sync.
import type { PlanCardData } from './types';

// Prompt 123 §B.1 — a bullet's identity for row-matching purposes is its
// HEAD line only (text before the first '\n'). Nested-list bullets (e.g.
// "Investor Pipeline\n· 5 investors…") carry different numbers per tier, so
// matching on the full string would split one feature into a separate row
// per tier — this keeps it one row, ticked wherever any tier has a bullet
// starting with that head, and drops the sub-bullet detail (too dense for a
// matrix cell; the full breakdown is on the card itself).
function head(b: string): string {
  return b.split('\n')[0];
}

// Prompt 158 §5 — the same "one feature, per-plan number" problem the \n
// nested bullets above already solve, but for a SINGLE-line bullet with the
// number embedded in the sentence instead (e.g. "90 AI-personalized
// outreach drafts…" vs "210 AI-personalized outreach drafts…") — these had
// no shared `\n` prefix, so head() returned the whole string and split one
// feature into a separate row per plan. Detects a leading number, and keys
// the row on the REST of the sentence (parenthetical stripped, so "1 User
// (Owner)" still matches "2 users"/"5 users" — the parenthetical detail
// stays on the card itself, same "drop the detail, keep the row" precedent
// as the \n case above) rather than the head's full text.
function parseNumericHead(h: string): { key: string; label: string; value: string } | null {
  const m = h.match(/^([\d,]+)\s+(.*)$/);
  if (!m) return null;
  const restNoParen = m[2].trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
  const label = restNoParen.charAt(0).toUpperCase() + restNoParen.slice(1);
  return { key: restNoParen.toLowerCase().replace(/s$/, ''), label, value: m[1] };
}

interface Row { key: string; label: string; numeric: boolean }

export function ComparisonTable({ plans }: { plans: PlanCardData[] }) {
  const rows: Row[] = [];
  const rowByKey = new Map<string, Row>();
  for (const p of plans) {
    for (const b of p.bullets) {
      const h = head(b);
      const numeric = parseNumericHead(h);
      const key = numeric ? numeric.key : h;
      let row = rowByKey.get(key);
      if (!row) {
        row = { key, label: numeric ? numeric.label : h, numeric: !!numeric };
        rowByKey.set(key, row);
        rows.push(row);
      } else if (numeric) {
        // Later (higher) tiers set the row's displayed label — e.g. idea's
        // "1 User (Owner)" merges into this row first, but "users" (garage/
        // motherfunding's plural, no parenthetical) reads better as the
        // generic column header than the free tier's own phrasing.
        row.label = numeric.label;
      }
    }
  }

  // For a numeric row, the cell is that plan's own bullet's leading number
  // (or — if this plan has no bullet at all for this feature); for a plain
  // row, the existing ✓/— behavior is unchanged.
  function cellFor(p: PlanCardData, row: Row): string | null {
    const match = p.bullets.map((b) => head(b)).find((h) => {
      const numeric = parseNumericHead(h);
      return (numeric ? numeric.key : h) === row.key;
    });
    if (match == null) return null;
    if (!row.numeric) return '✓';
    return parseNumericHead(match)?.value ?? '✓';
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-100">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Feature</th>
            {plans.map((p) => (
              <th key={p.id} className="px-4 py-2.5 text-center text-xs font-semibold text-gray-700">{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.key} className={i % 2 === 1 ? 'bg-gray-50/50' : undefined}>
              <td className="px-4 py-2 text-xs text-gray-600">{row.label}</td>
              {plans.map((p) => {
                const cell = cellFor(p, row);
                return (
                  <td key={p.id} className="px-4 py-2 text-center">
                    {cell != null
                      ? <span className="text-[#0E7490]">{cell}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
