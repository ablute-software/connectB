'use client';
// Prompt 534 Phase 1 — the runway chart.
//
// Recharts, per Prompt 435's standing decision that it is this project's
// charting library (see CapTableChart.tsx) — no hand-rolled SVG.
//
// The four reference markers are the reason this chart exists rather than a
// table: runway end, break-even and the tranches are things a founder can
// usually recite, but "start raising by month N" is the one almost nobody
// plots, and it is the only marker here that changes behaviour this week.
import {
  Area, ComposedChart, Line, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { RunwayMarkers, RunwayPoint, RunwayTranche } from '@/lib/round-blueprint';

const CASH = '#0E7490';
const BURN = '#B00000';
const REVENUE = '#059669';

// Formatting lives here, never in round-blueprint.ts — that module stays pure
// and Intl-free so its output is identical on every machine (the locale bug in
// market-facts-view is exactly what that discipline prevents).
function eur(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `€${Math.round(n / 1_000)}K`;
  return `€${Math.round(n)}`;
}

export function RunwayChart({ points, markers, tranches, onPickMonth }: {
  points: RunwayPoint[];
  markers: RunwayMarkers;
  tranches: RunwayTranche[];
  /** Clicking a point opens the panel's edit popover for that month. */
  onPickMonth?: (month: number) => void;
}) {
  const data = points.map((p) => ({
    month: p.month,
    cash: Math.round(p.cashEnd),
    burn: Math.round(p.burn),
    revenue: Math.round(p.revenue),
  }));

  return (
    // ResponsiveContainer needs a parent with a real height or Recharts warns
    // and draws nothing — same wrapper CapTableChart uses.
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}
          onClick={(e) => {
            const month = (e as { activeLabel?: number | string } | null)?.activeLabel;
            if (onPickMonth && month != null) onPickMonth(Number(month));
          }}>
          <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false}
            label={{ value: 'month', position: 'insideBottomRight', offset: -4, fontSize: 10 }} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} width={54} tickFormatter={eur} />
          <Tooltip
            formatter={(value, name) => [eur(Number(value ?? 0)), String(name ?? '')]}
            labelFormatter={(m) => `Month ${m}`}
            contentStyle={{ fontSize: 12, borderRadius: 8 }} />

          {/* Zero line first, so the cash area reads against it. */}
          <ReferenceLine y={0} stroke="#9CA3AF" strokeWidth={1} />

          <Area type="monotone" dataKey="cash" name="Cash" stroke={CASH} fill={CASH} fillOpacity={0.12} strokeWidth={2} />
          <Line type="monotone" dataKey="burn" name="Burn" stroke={BURN} dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="revenue" name="Revenue" stroke={REVENUE} dot={false} strokeWidth={1.5} />

          {markers.startRaisingMonth != null && (
            <ReferenceLine x={markers.startRaisingMonth} stroke="#D97706" strokeDasharray="4 3"
              label={{ value: 'Start raising', position: 'top', fontSize: 10, fill: '#D97706' }} />
          )}
          {markers.runwayEndMonth != null && (
            <ReferenceLine x={markers.runwayEndMonth} stroke={BURN} strokeDasharray="4 3"
              label={{ value: 'Runway ends', position: 'top', fontSize: 10, fill: BURN }} />
          )}
          {markers.breakEvenMonth != null && (
            <ReferenceLine x={markers.breakEvenMonth} stroke={REVENUE} strokeDasharray="4 3"
              label={{ value: 'Break-even', position: 'top', fontSize: 10, fill: REVENUE }} />
          )}

          {tranches.map((t, i) => {
            const at = data.find((d) => d.month === Math.max(0, t.month));
            return at ? <ReferenceDot key={`${t.month}-${i}`} x={at.month} y={at.cash} r={5}
              fill={CASH} stroke="#fff" strokeWidth={2} /> : null;
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
