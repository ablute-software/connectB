'use client';
// Prompt 435 — Recharts is now this project's STANDARD charting library.
// This hand-rolled-SVG-in-2-different-ways history (Prompt 422's stacked
// bar, Prompt 433's stroke-dasharray donut) is done: any future chart
// (pie/donut, bars, lines — Scenarios & returns, metrics, whatever comes
// next) uses Recharts too, never a new hand-rolled SVG "because it's just
// one small chart" and never a second, competing charting library without
// a real reason to switch away from this one.
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { CapTableSlice } from '@/lib/cap-table';

export const CAP_TABLE_COLORS = ['#0E7490', '#7C3AED', '#DB2777', '#D97706', '#059669', '#4B5563'];
export const CAP_TABLE_ESTIMATE_COLOR = '#0E7490';

function fmtPct(n: number) {
  return `${n < 1 ? n.toFixed(2) : n.toFixed(1)}%`;
}

export function CapTableChart({ slices }: { slices: CapTableSlice[] }) {
  const nonZero = slices.filter((s) => s.pct > 0);
  const total = nonZero.reduce((s, x) => s + x.pct, 0);
  const data = nonZero.map((s, i) => ({
    ...s,
    color: s.category === 'investor_estimate' ? CAP_TABLE_ESTIMATE_COLOR : CAP_TABLE_COLORS[i % CAP_TABLE_COLORS.length],
  }));

  return (
    <div className="flex items-center gap-4">
      {/* ResponsiveContainer needs a parent with a defined height — without
          this wrapper Recharts warns in the console and draws nothing. */}
      <div className="h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* isAnimationActive={false} — confirmed empirically (Prompt
                435): Recharts' default entrance animation ('auto', meant to
                resolve immediately under SSR/prefers-reduced-motion) can get
                stuck mid-animation and never paint a single sector — a real
                risk for a background/inactive tab throttling
                requestAnimationFrame in any real browser, not just this
                session's own verification tooling where it was first
                caught. Static rendering is also a strict improvement here:
                no distracting motion on every mount for a data-display
                widget like this one. */}
            <Pie data={data} dataKey="pct" nameKey="label" innerRadius={44} outerRadius={72} paddingAngle={1} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={`${d.label}-${i}`} fill={d.color} />)}
            </Pie>
            {/* Recharts v3's Formatter type widens value to ValueType|undefined
                (vs. a plain number in older versions/examples) — guarded here
                rather than assuming a number always arrives. */}
            <Tooltip formatter={(value, name) => [fmtPct(typeof value === 'number' ? value : 0), String(name)]}
              contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1">
        <div className="text-xs text-gray-400">Total {fmtPct(total)}</div>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
          {data.map((d, i) => (
            <li key={`${d.label}-legend-${i}`} className="flex items-center gap-1">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
              {d.label} <span className="font-medium text-gray-800">{fmtPct(d.pct)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
