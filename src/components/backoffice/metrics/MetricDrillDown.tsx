'use client';
// Prompt 296 §2 — shared trend-chart + "Ver quem são" drill-down, opened by
// clicking any Stat (metrics/page.tsx) or MiniStat (GrowthRevenueTab.tsx).
// Hand-rolled SVG line chart, no charting dependency — same "plain divs/SVG,
// no library" approach already used by backoffice/costs/page.tsx's bar
// charts. Honest empty state: fewer than 2 points on the primary series
// means there is nothing to draw a trend from yet, and this says so instead
// of stretching one point into a flat line.
import { useEffect, useState } from 'react';
import { markViewerOrigin } from '@/components/DeveloperViewerFrame';

export interface DrillDownSeries {
  path: string;
  label: string;
  color: string;
  formatValue?: (v: number) => string;
}

interface HistoryPoint { computedAt: string; value: number }
interface HistorySeries { path: string; points: HistoryPoint[] }

interface EntityItem {
  orgId: string; name: string; createdAt: string;
  timeInSessionMinutes: number | null; sessionCount: number | null;
}

function defaultFormat(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function LineChart({ series, history }: { series: DrillDownSeries[]; history: HistorySeries[] }) {
  const W = 560, H = 180, PAD = 28;
  const byPath = new Map(history.map((h) => [h.path, h.points]));
  const allValues = history.flatMap((h) => h.points.map((p) => p.value));
  if (allValues.length === 0) return null;
  const maxV = Math.max(1, ...allValues);
  const minV = Math.min(0, ...allValues);
  const range = maxV - minV || 1;
  const maxLen = Math.max(1, ...history.map((h) => h.points.length));

  function xy(i: number, v: number, len: number) {
    const x = PAD + (len <= 1 ? 0 : (i / (len - 1)) * (W - 2 * PAD));
    const y = H - PAD - ((v - minV) / range) * (H - 2 * PAD);
    return [x, y] as const;
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#E5E7EB" strokeWidth={1} />
      {series.map((s) => {
        const points = byPath.get(s.path) ?? [];
        if (points.length === 0) return null;
        const path = points.map((p, i) => xy(i, p.value, points.length).join(',')).join(' L');
        return (
          <g key={s.path}>
            <polyline points={points.map((p, i) => xy(i, p.value, points.length).join(',')).join(' ')}
              fill="none" stroke={s.color} strokeWidth={2} />
            {points.map((p, i) => {
              const [x, y] = xy(i, p.value, points.length);
              return <circle key={i} cx={x} cy={y} r={3} fill={s.color} />;
            })}
          </g>
        );
      })}
      <text x={PAD} y={14} className="fill-gray-400" fontSize={10}>{maxV.toLocaleString('en-US', { maximumFractionDigits: 0 })}</text>
      <text x={PAD} y={H - PAD - 2} className="fill-gray-400" fontSize={10}>{minV.toLocaleString('en-US', { maximumFractionDigits: 0 })}</text>
    </svg>
  );
}

export function MetricDrillDown({
  title, series, entitiesMetric, period, onClose,
}: {
  title: string;
  series: DrillDownSeries[];
  entitiesMetric?: string;
  period?: string;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<HistorySeries[] | null>(null);
  const [err, setErr] = useState('');
  const [showEntities, setShowEntities] = useState(false);
  const [entities, setEntities] = useState<EntityItem[] | null>(null);
  const [enteringOrgId, setEnteringOrgId] = useState<string | null>(null);

  // Same "real, audited, read-only" Developer Viewer entry point Startups'
  // own table uses (src/app/backoffice/startups/page.tsx) — the actual
  // dossier link for a founder's workspace, not a plain <a href>.
  async function openViewer(orgId: string) {
    setEnteringOrgId(orgId);
    try {
      const res = await fetch('/api/backoffice/viewer/enter', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId }),
      });
      const body = await res.json();
      if (!body.ok) { alert(`Could not open viewer: ${body.error}`); return; }
      markViewerOrigin();
      window.location.href = '/';
    } finally { setEnteringOrgId(null); }
  }

  useEffect(() => {
    const paths = series.map((s) => s.path).join(',');
    fetch(`/api/backoffice/metrics/history?metrics=${encodeURIComponent(paths)}`).then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'Failed to load history.'); return; }
      setHistory(body.series);
    }).catch(() => setErr('Failed to load history.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadEntities() {
    if (entities || !entitiesMetric) return;
    const params = new URLSearchParams({ metric: entitiesMetric });
    if (period) params.set('period', period);
    fetch(`/api/backoffice/metrics/overview/entities?${params}`).then((r) => r.json()).then((body) => {
      if (body.ok) setEntities(body.items);
    }).catch(() => {});
  }

  const maxPoints = Math.max(0, ...(history ?? []).map((h) => h.points.length));
  const latestByPath = new Map((history ?? []).map((h) => [h.path, h.points[h.points.length - 1]?.value]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
        </div>

        <div className="mb-3 flex flex-wrap gap-3">
          {series.map((s) => {
            const v = latestByPath.get(s.path);
            return (
              <div key={s.path} className="flex items-center gap-1.5 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="text-gray-500">{s.label}:</span>
                <span className="font-bold text-gray-900">{v != null ? (s.formatValue ?? defaultFormat)(v) : '—'}</span>
              </div>
            );
          })}
        </div>

        {err && <p className="text-sm text-[#B00000]">{err}</p>}
        {!err && history && maxPoints < 2 && (
          <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500">
            Not enough history yet — snapshots accumulate once a day (plus any manual refresh). Check back in a few days to see a trend.
          </p>
        )}
        {!err && history && maxPoints >= 2 && <LineChart series={series} history={history} />}
        {!err && !history && <p className="text-sm text-gray-400">Loading…</p>}

        {entitiesMetric && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <button onClick={() => { setShowEntities(!showEntities); loadEntities(); }} className="text-xs font-medium text-[#0E7490] hover:underline">
              {showEntities ? '▾ Hide who they are' : '▸ Ver quem são'}
            </button>
            {showEntities && (
              <ul className="mt-2 space-y-1.5">
                {entities === null && <p className="text-xs text-gray-400">Loading…</p>}
                {entities?.length === 0 && <p className="text-xs text-gray-400">No orgs in this set right now.</p>}
                {entities?.map((e) => (
                  <li key={e.orgId} className="flex items-center justify-between rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs">
                    <span className="font-medium text-gray-800">{e.name}</span>
                    <span className="flex items-center gap-2 text-gray-400">
                      {e.timeInSessionMinutes != null ? `${e.timeInSessionMinutes}min active (${e.sessionCount} sessions)` : 'no usage data yet'}
                      <button onClick={() => openViewer(e.orgId)} disabled={enteringOrgId === e.orgId}
                        className="font-medium text-[#0E7490] hover:underline disabled:opacity-40">
                        {enteringOrgId === e.orgId ? 'Opening…' : 'Open dossier →'}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
