'use client';
// Prompt 894 §B — "Deal timeline": ours (ask) vs theirs (offer/commitment),
// over time, points annotated with formality. No access to the `dataviz`
// skill in this environment (not available as a tool here) — followed
// CapTableChart.tsx's own conventions instead (the closest existing chart
// in this codebase): Recharts is this project's standard charting library
// (see that file's header comment), isAnimationActive={false} for static,
// non-flaky rendering, and the same #0E7490 primary accent. "No terms
// recorded yet" empty state per the spec, before any chart mounts at all.
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, Cell } from 'recharts';
import type { DealTerm } from '@/lib/types';
import { fmtEur } from '@/components/ui';

const OURS_COLOR = '#0E7490';
const THEIRS_COLOR = '#7C3AED';
// Mentioned is the lightest (least certain), Agreed is fully solid — the
// same "more certain = more saturated" logic CapTableChart's own palette
// choice implies, applied to opacity instead of a whole new hue per state
// so ours/theirs stays the one color-coded dimension.
const FORMALITY_OPACITY: Record<DealTerm['formality'], number> = {
  mentioned: 0.35, negotiating: 0.65, agreed: 1,
};

interface Point { x: number; y: number; term: DealTerm }

export function DealTimelineChart({ terms }: { terms: DealTerm[] }) {
  // Only terms with a numeric amount plot on this chart — a text-only term
  // (e.g. a free-text instrument note) has nowhere on a €-axis to go and is
  // still visible in the table above this chart, just not plotted here.
  const points: Point[] = terms
    .filter((t) => t.amount_eur != null)
    .map((t) => ({ x: new Date(t.effective_at ?? t.recorded_at).getTime(), y: t.amount_eur as number, term: t }));

  if (points.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-400">No terms recorded yet.</p>;
  }

  const ours = points.filter((p) => p.term.side === 'ours');
  const theirs = points.filter((p) => p.term.side === 'theirs');

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis type="number" dataKey="x" domain={['dataMin', 'dataMax']} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            tick={{ fontSize: 11, fill: '#6B7280' }} />
          <YAxis type="number" dataKey="y" tickFormatter={(v) => fmtEur(v)} tick={{ fontSize: 11, fill: '#6B7280' }} width={64} />
          <ZAxis range={[80, 80]} />
          <Tooltip
            formatter={(_value, _name, item) => {
              const t = (item?.payload as Point)?.term;
              if (!t) return ['', ''];
              return [
                `${t.kind.replace('_', ' ')} · ${t.formality} · ${t.amount_eur != null ? fmtEur(t.amount_eur) : t.text ?? ''}`,
                t.side === 'ours' ? 'We' : 'Them',
              ];
            }}
            labelFormatter={(v) => new Date(v as number).toLocaleDateString()}
            contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Scatter name="We asked" data={ours} fill={OURS_COLOR} isAnimationActive={false}>
            {ours.map((p, i) => <Cell key={`ours-${i}`} fillOpacity={FORMALITY_OPACITY[p.term.formality]} />)}
          </Scatter>
          <Scatter name="They offered / committed" data={theirs} fill={THEIRS_COLOR} isAnimationActive={false}>
            {theirs.map((p, i) => <Cell key={`theirs-${i}`} fillOpacity={FORMALITY_OPACITY[p.term.formality]} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
