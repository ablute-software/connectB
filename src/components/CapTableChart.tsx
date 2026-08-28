// Prompt 422 §C — a hand-rolled chart, not a new dependency: confirmed no
// charting library is used anywhere in this codebase (checked /metrics and
// package.json), reconfirmed via package.json again for Prompt 433.
//
// Prompt 433 §A — extracted from EvaluationToolsPanel.tsx into its own
// top-level components/ file (same spirit as Logo.tsx/VisibilityToggle.tsx
// — small and cross-cutting, not tied to one area): Prompt 434 needs the
// same chart in the investor-facing dossier's Team > Cap table section.
//
// §B — donut instead of the original stacked bar, via SVG stroke-dasharray
// on a <circle>: same props/colors/tooltip/legend pattern, only the visual
// shape changed.
import type { CapTableSlice } from '@/lib/cap-table';

export const CAP_TABLE_COLORS = ['#0E7490', '#7C3AED', '#DB2777', '#D97706', '#059669', '#4B5563'];
export const CAP_TABLE_ESTIMATE_COLOR = '#0E7490';

const SIZE = 160;
const STROKE_WIDTH = 28;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function fmtPct(n: number) {
  return `${n < 1 ? n.toFixed(2) : n.toFixed(1)}%`;
}

export function CapTableChart({ slices }: { slices: CapTableSlice[] }) {
  const nonZero = slices.filter((s) => s.pct > 0);
  const total = nonZero.reduce((s, x) => s + x.pct, 0);

  let cumulative = 0;
  const arcs = nonZero.map((s, i) => {
    const dash = (s.pct / 100) * CIRCUMFERENCE;
    const offset = -((cumulative / 100) * CIRCUMFERENCE);
    cumulative += s.pct;
    return {
      ...s,
      color: s.category === 'investor_estimate' ? CAP_TABLE_ESTIMATE_COLOR : CAP_TABLE_COLORS[i % CAP_TABLE_COLORS.length],
      dash, offset,
    };
  });

  return (
    <div className="flex items-center gap-4">
      {/* -rotate-90 makes the first slice start at 12 o'clock instead of 3
          o'clock (a <circle>'s stroke-dasharray/stroke-dashoffset starts
          drawing at 0°, which lands at the right without the rotation). A
          negative strokeDashoffset advances each slice past the one
          before it, clockwise — no per-slice rotation, just an
          accumulated offset. */}
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="shrink-0 -rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#F3F4F6" strokeWidth={STROKE_WIDTH} />
        {arcs.map((a, i) => (
          <circle key={`${a.label}-${i}`} cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none"
            stroke={a.color} strokeWidth={STROKE_WIDTH}
            strokeDasharray={`${a.dash} ${CIRCUMFERENCE - a.dash}`} strokeDashoffset={a.offset}>
            <title>{`${a.label} — ${fmtPct(a.pct)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex-1">
        <div className="text-xs text-gray-400">Total {fmtPct(total)}</div>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
          {arcs.map((a, i) => (
            <li key={`${a.label}-legend-${i}`} className="flex items-center gap-1">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: a.color }} />
              {a.label} <span className="font-medium text-gray-800">{fmtPct(a.pct)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
