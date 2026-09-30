'use client';
// Full feature matrix — rows are the union of every plan's section titles (in
// first-appearance order across the given plans, so cheaper-tier features
// lead), columns are plans, cells are ✓/—. Entirely derived from
// PlanCardData.sections — no separate feature list to keep in sync.
//
// Prompt 749 — this used to merge a numeric row (e.g. "Up to 10/25/50 new
// curated investors per month") into ONE row with a per-plan number cell, by
// regex-extracting a leading number off the old `\n`+`·` bullet strings
// (head()/parseNumericHead() below, now removed). The new section/item text
// is prose ("Up to 25 new curated investors / month") with no shared prefix
// to key a merge on across tiers, and each tier's line differs by more than
// the number (idea's "5 investors available once your core profile is
// complete" moved into the curated-pipeline note entirely) — building a
// robust prose-number extractor was judged out of scope (ComparisonTable
// isn't part of this prompt's own spec/test list). DELIBERATE, FLAGGED
// REGRESSION: those rows now show as separate rows per tier (✓ only on the
// tier whose section/item text matches exactly) instead of one merged row
// with three numbers — the full breakdown is still on the card itself
// (PlanCards.tsx), which is the primary surface.
import type { PlanCardData } from './types';

interface Row { key: string; label: string }

export function ComparisonTable({ plans }: { plans: PlanCardData[] }) {
  const rows: Row[] = [];
  const rowKeys = new Set<string>();
  for (const p of plans) {
    for (const s of p.sections) {
      if (!rowKeys.has(s.title)) {
        rowKeys.add(s.title);
        rows.push({ key: s.title, label: s.title });
      }
      for (const item of s.items) {
        if (!rowKeys.has(item.text)) {
          rowKeys.add(item.text);
          rows.push({ key: item.text, label: item.text });
        }
      }
    }
  }

  function hasRow(p: PlanCardData, key: string): boolean {
    return p.sections.some((s) => s.title === key || s.items.some((item) => item.text === key));
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
              {plans.map((p) => (
                <td key={p.id} className="px-4 py-2 text-center">
                  {hasRow(p, row.key)
                    ? <span className="text-[#0E7490]">✓</span>
                    : <span className="text-gray-300">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
