'use client';
// Prompt 378 §E.1 — "rings as rings". Three concentric circles (beachhead
// innermost, category outermost), value + year rendered inside each when a
// SOURCED figure exists, clicking one focuses its edit card. Pure inline
// SVG with the app's existing tokens — no new dependency — held to the
// visual bar VaultStrengthBarometer (374 §G) set with its half-moon gauge.
//
// An unsourced ring is drawn as a DASHED outline with no number: the
// diagram carries the same honesty rule as the data (never show a figure
// that has no source), and the dashes are what make "not filled in yet"
// legible at a glance instead of looking like a zero.
import { RING_LABEL, type RingKey } from '@/lib/market-rings';

export interface RingDatum {
  ring: RingKey;
  sizeValueEur: number | null;
  sizeYear: number | null;
  accepted: boolean;
}

// Outermost first so the inner circles paint on top of the outer ones.
const GEOMETRY: { ring: RingKey; r: number; labelY: number }[] = [
  { ring: 'category', r: 86, labelY: 22 },
  { ring: 'serviceable', r: 58, labelY: 76 },
  { ring: 'beachhead', r: 32, labelY: 126 },
];

const RING_COLOR: Record<RingKey, string> = {
  category: '#CBD5E1', serviceable: '#67B7CC', beachhead: '#0E7490',
};

function compactEur(value: number): string {
  if (value >= 1_000_000_000) return `€${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `€${Math.round(value / 1_000)}k`;
  return `€${value}`;
}

export function MarketRingsDiagram({ rings, onFocus }: { rings: RingDatum[]; onFocus: (ring: RingKey) => void }) {
  const byRing = new Map(rings.map((r) => [r.ring, r]));

  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-[260px]" role="img" aria-label="Your market in three layers">
      {GEOMETRY.map(({ ring, r }) => {
        const d = byRing.get(ring);
        const sourced = d?.sizeValueEur != null;
        return (
          <circle key={ring} cx={100} cy={100} r={r}
            fill={ring === 'beachhead' ? '#E8F4F8' : 'white'} fillOpacity={ring === 'beachhead' ? 1 : 0.65}
            stroke={RING_COLOR[ring]} strokeWidth={sourced ? 2.5 : 1.5}
            strokeDasharray={sourced ? undefined : '4 4'}
            className="cursor-pointer transition-[stroke-width] hover:[stroke-width:3.5]"
            onClick={() => onFocus(ring)}>
            <title>{`${RING_LABEL[ring]} — click to edit`}</title>
          </circle>
        );
      })}

      {GEOMETRY.map(({ ring, labelY }) => {
        const d = byRing.get(ring);
        return (
          <g key={`${ring}-label`} className="pointer-events-none">
            <text x={100} y={labelY} textAnchor="middle" fontSize={8} fontWeight={600} fill={RING_COLOR[ring]}
              style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {RING_LABEL[ring]}
            </text>
            <text x={100} y={labelY + 11} textAnchor="middle" fontSize={d?.sizeValueEur != null ? 11 : 8}
              fontWeight={d?.sizeValueEur != null ? 700 : 400} fill={d?.sizeValueEur != null ? '#111827' : '#9CA3AF'}>
              {d?.sizeValueEur != null
                ? `${compactEur(d.sizeValueEur)}${d.sizeYear ? ` · ${d.sizeYear}` : ''}`
                : 'no sourced figure'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
