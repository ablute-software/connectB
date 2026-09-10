'use client';
// Prompt 644 §2.4 — the catalogue over time, under the "Catalog stats" cards.
//
// The cards are the last point of these curves: both read
// catalog_metrics_compute(), the one definition of every metric, through
// /api/backoffice/investors (today) and /api/backoffice/catalog-metrics
// (the daily table + today). Nothing here defines a metric; the labels and
// the definition text in the tooltip come from catalog_metrics_definitions()
// in the database.
//
// What the chart is honest about: a series that cannot be reconstructed
// before its first snapshot (e-mail, LinkedIn, hooks, countries) is NULL
// for those days and the line simply starts where the data starts — the
// tooltip says "no data before <date>" rather than drawing a zero. The
// window (15 days · 1 month · 3 · 6) sets the scale; the trace starts where
// the data does.
//
// Costs are an optional overlay (Nuno's "acréscimo de info"): a second axis
// in € with the daily entity + person cost stacked as bars, an accumulated
// line for the window, and "€ per hook written" — the KPI of 638. Off by
// default: the catalogue's shape is the subject, the money is the note.
//
// recharts, because the app already carries it (CapTableChart); no new
// dependency.
import { useEffect, useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type Row = { day: string; metric: string; value: number | null };
type Definition = { metric: string; label: string; definition: string; reconstructible_from: string | null };

const WINDOWS: { key: string; label: string; days: number }[] = [
  { key: '15d', label: '15 days', days: 15 },
  { key: '1m', label: '1 month', days: 30 },
  { key: '3m', label: '3 months', days: 91 },
  { key: '6m', label: '6 months', days: 182 },
];

// The count series a chip can switch on. Four on by default — not nineteen.
const COUNT_SERIES: { key: string; color: string }[] = [
  { key: 'entities_total', color: '#0E7490' },
  { key: 'entities_verified', color: '#0284c7' },
  { key: 'entities_confirmed_contact', color: '#16a34a' },
  { key: 'entities_with_person', color: '#65a30d' },
  { key: 'entities_enriched', color: '#475569' },
  { key: 'people_total', color: '#7c3aed' },
  { key: 'people_with_hook', color: '#db2777' },
  { key: 'people_hook_human', color: '#be123c' },
  { key: 'contributions_submitted', color: '#d97706' },
];
const DEFAULT_ON = ['entities_total', 'entities_verified', 'entities_confirmed_contact', 'people_total'];
const COST_ENTITY = 'enrichment_cost_entity_eur';
const COST_PERSON = 'enrichment_cost_person_eur';
const COST_PER_HOOK = 'enrichment_cost_per_hook_eur';
const COST_CUM = 'cost_cumulative_eur';

type Point = Record<string, number | string | null>;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function eur(v: number): string {
  return `€${v.toFixed(v < 10 ? 3 : 2)}`;
}

export function CatalogMetricsChart() {
  const [windowKey, setWindowKey] = useState('1m');
  const [on, setOn] = useState<Set<string>>(() => new Set(DEFAULT_ON));
  const [costs, setCosts] = useState(false);
  const [perHook, setPerHook] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [definitions, setDefinitions] = useState<Record<string, Definition>>({});
  const [error, setError] = useState<string | null>(null);

  const days = WINDOWS.find((w) => w.key === windowKey)?.days ?? 30;
  const to = isoDay(new Date());
  const from = isoDay(new Date(Date.now() - (days - 1) * 86400000));

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    fetch(`/api/backoffice/catalog-metrics?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (!body.ok) { setError(body.error ?? 'failed'); return; }
        setRows(body.rows as Row[]);
        const defs: Record<string, Definition> = {};
        for (const d of body.definitions as Definition[]) defs[d.metric] = d;
        setDefinitions(defs);
      })
      .catch(() => { if (!cancelled) setError('failed to load'); });
    return () => { cancelled = true; };
  }, [from, to]);

  // One point per day of the window; a metric with no row for that day is
  // null (a gap in the line), never zero. Cumulative cost restarts at the
  // window's first day — it is "spent in this window", and says so.
  const { data, firstDay } = useMemo(() => {
    const byDay = new Map<string, Point>();
    for (let i = 0; i < days; i++) {
      const d = isoDay(new Date(new Date(from).getTime() + i * 86400000));
      byDay.set(d, { day: d });
    }
    const first: Record<string, string> = {};
    for (const r of rows ?? []) {
      const p = byDay.get(r.day);
      if (!p) continue;
      p[r.metric] = r.value;
      if (r.value !== null && (!first[r.metric] || r.day < first[r.metric])) first[r.metric] = r.day;
    }
    let cum = 0;
    for (const d of [...byDay.keys()].sort()) {
      const p = byDay.get(d)!;
      cum += (Number(p[COST_ENTITY]) || 0) + (Number(p[COST_PERSON]) || 0);
      p[COST_CUM] = Math.round(cum * 1000) / 1000;
    }
    return { data: [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day))), firstDay: first };
  }, [rows, from, days]);

  const toggle = (key: string) => setOn((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const label = (key: string) => definitions[key]?.label ?? key;
  const rightAxis = costs || perHook;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800">Catalog over time</h3>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button key={w.key} type="button" onClick={() => setWindowKey(w.key)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${windowKey === w.key ? 'bg-[#0E7490] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {COUNT_SERIES.map((s) => (
          <button key={s.key} type="button" onClick={() => toggle(s.key)} title={definitions[s.key]?.definition}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${on.has(s.key) ? 'border-transparent text-white' : 'border-gray-200 bg-white text-gray-500'}`}
            style={on.has(s.key) ? { backgroundColor: s.color } : undefined}>
            {label(s.key)}
          </button>
        ))}
        <span className="mx-1 self-center text-gray-300">|</span>
        <button type="button" onClick={() => setCosts((v) => !v)} title="Daily enrichment cost (entities + people, stacked) and the amount accumulated in this window, in €, on a second axis"
          className={`rounded-full border px-2 py-0.5 text-[11px] ${costs ? 'border-transparent bg-amber-500 text-white' : 'border-gray-200 bg-white text-gray-500'}`}>
          Enrichment costs (€)
        </button>
        <button type="button" onClick={() => setPerHook((v) => !v)} title={definitions[COST_PER_HOOK]?.definition}
          className={`rounded-full border px-2 py-0.5 text-[11px] ${perHook ? 'border-transparent bg-rose-500 text-white' : 'border-gray-200 bg-white text-gray-500'}`}>
          € per hook written
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-[#B00000]">{error}</p>}
      {!error && !rows && <p className="mt-3 text-sm text-gray-400">Loading…</p>}

      {/* ResponsiveContainer needs a parent with a defined height — same note as CapTableChart. */}
      {rows && (
        <div className="mt-3 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: rightAxis ? 8 : 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} width={44} allowDecimals={false} />
              {rightAxis && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} width={48} tickFormatter={(v: number) => `€${v}`} />}
              <Tooltip content={<MetricsTooltip definitions={definitions} firstDay={firstDay} windowStart={from} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => label(String(v))} />
              {costs && <Bar yAxisId="right" dataKey={COST_ENTITY} name={COST_ENTITY} stackId="cost" fill="#fbbf24" isAnimationActive={false} />}
              {costs && <Bar yAxisId="right" dataKey={COST_PERSON} name={COST_PERSON} stackId="cost" fill="#f59e0b" isAnimationActive={false} />}
              {costs && <Line yAxisId="right" type="monotone" dataKey={COST_CUM} name={COST_CUM} stroke="#b45309" strokeDasharray="4 2" dot={false} isAnimationActive={false} />}
              {perHook && <Line yAxisId="right" type="monotone" dataKey={COST_PER_HOOK} name={COST_PER_HOOK} stroke="#e11d48" dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />}
              {COUNT_SERIES.filter((s) => on.has(s.key)).map((s) => (
                <Line key={s.key} yAxisId="left" type="monotone" dataKey={s.key} name={s.key} stroke={s.color} strokeWidth={1.75} dot={false} connectNulls={false} isAnimationActive={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="mt-2 text-[11px] text-gray-400">
        A line starts where its data starts: series without a date of their own (e-mail, LinkedIn, hooks, countries) exist only from the first daily snapshot. Costs count every job that finished that day, whatever its outcome.
      </p>
    </section>
  );
}

// The tooltip carries the definition — the text from catalog_metrics_definitions(),
// not a copy — and says when a series has no data before the window's start.
function MetricsTooltip({ active, payload, label, definitions, firstDay, windowStart }: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number | string | null; color?: string; name?: string | number }[];
  label?: string | number;
  definitions: Record<string, Definition>;
  firstDay: Record<string, string>;
  windowStart: string;
}) {
  if (!active || !payload?.length) return null;
  const day = String(label ?? '');
  return (
    <div className="max-w-xs rounded-lg border border-gray-200 bg-white p-2 text-[11px] shadow-md">
      <div className="mb-1 font-semibold text-gray-700">{day}</div>
      {payload.map((p) => {
        const key = String(p.dataKey ?? p.name ?? '');
        const def = definitions[key];
        const name = key === COST_CUM ? 'Cost accumulated in this window' : def?.label ?? key;
        const isEuro = key.startsWith('enrichment_cost') || key === COST_CUM;
        const raw = p.value;
        const value = raw === null || raw === undefined || raw === '' ? null : Number(raw);
        const first = firstDay[key];
        const noDataYet = value === null && first && day < first;
        return (
          <div key={key} className="mb-1">
            <div className="flex items-baseline justify-between gap-3">
              <span style={{ color: p.color }} className="font-medium">{name}</span>
              <span className="tabular-nums text-gray-800">{value === null ? '—' : isEuro ? eur(value) : value.toLocaleString('en-GB')}</span>
            </div>
            {def && <div className="text-gray-400">{def.definition}</div>}
            {noDataYet && <div className="text-amber-600">no data before {first}</div>}
            {value === null && !noDataYet && def && !def.reconstructible_from && day < windowStart && <div className="text-amber-600">not reconstructible before the first snapshot</div>}
          </div>
        );
      })}
    </div>
  );
}
