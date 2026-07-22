'use client';
// Pipeline (home) — dense sortable/filterable entity table
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { FitTag, StatusPill, WaveTag, fmtEur } from '@/components/ui';
import { RelationshipCompactLine } from '@/components/RelationshipSummaryCard';
import { preflight, preflightSummary } from '@/lib/rules';
import type { Entity } from '@/lib/types';

type SortKey = 'name' | 'fit' | 'wave' | 'status';
const fitOrder = { high: 0, medium_high: 1, medium: 2, low: 3 };

export default function PipelinePage() {
  const { db } = useStore();
  const [q, setQ] = useState('');
  const [wave, setWave] = useState('');
  const [status, setStatus] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState<SortKey>('wave');

  const rows = useMemo(() => {
    let list = [...db.entities];
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q.toLowerCase())
      || e.sectors.some((s) => s.toLowerCase().includes(q.toLowerCase())));
    if (wave) list = list.filter((e) => String(e.wave) === wave);
    if (status) list = list.filter((e) => e.status === status);
    if (country) list = list.filter((e) => e.hq_country === country);
    list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'fit') return (fitOrder[a.fit_score ?? 'low'] - fitOrder[b.fit_score ?? 'low']);
      if (sort === 'status') return a.status.localeCompare(b.status);
      return (a.wave ?? 9) - (b.wave ?? 9) || (fitOrder[a.fit_score ?? 'low'] - fitOrder[b.fit_score ?? 'low']);
    });
    return list;
  }, [db.entities, q, wave, status, country, sort]);

  const countries = Array.from(new Set(db.entities.map((e) => e.hq_country).filter(Boolean))) as string[];

  function readiness(e: Entity) {
    if (['in_conversation', 'diligence', 'invested', 'dormant', 'passed'].includes(e.status)) return null;
    const rank1 = db.people.filter((p) => p.entity_id === e.id).sort((a, b) => a.seniority_rank - b.seniority_rank)[0];
    if (!rank1) return null;
    const s = preflightSummary(preflight(db, rank1, null));
    return s.green;
  }

  function nextAction(e: Entity) {
    return db.tasks.filter((t) => t.entity_id === e.id && !t.done)
      .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))[0];
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or sector…"
          className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <select value={wave} onChange={(e) => setWave(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">All waves</option><option value="1">Wave 1</option><option value="2">Wave 2</option><option value="3">Wave 3</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">All statuses</option>
          {['not_contacted','contacted','in_conversation','diligence','passed','invested','dormant'].map((s) =>
            <option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select>
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">All countries</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          <option value="wave">Sort: wave</option><option value="fit">Sort: fit</option>
          <option value="name">Sort: name</option><option value="status">Sort: status</option>
        </select>
        {(q || wave || status || country) && (
          <button onClick={() => { setQ(''); setWave(''); setStatus(''); setCountry(''); }} className="text-sm text-gray-500 hover:underline">Clear</button>
        )}
        <span className="ml-auto text-xs text-gray-400">{rows.length} entities</span>
        <Link href="/packs" className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm text-[#0E7490] hover:bg-[#E8F4F8]">+ Add investor</Link>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">HQ</th>
              <th className="px-3 py-2">Check</th>
              <th className="px-3 py-2">Sectors</th>
              <th className="px-3 py-2">Fit</th>
              <th className="px-3 py-2">Wave</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Next action</th>
              <th className="px-3 py-2" title="Rank-1 pre-flight">Ready</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const ready = readiness(e);
              const task = nextAction(e);
              const overdue = task?.due_at && new Date(task.due_at) < new Date();
              const hf = e.hard_filter_status === 'open';
              return (
                <tr key={e.id}
                  className={`border-b border-gray-100 hover:bg-[#E8F4F8]/60 ${e.status === 'dormant' ? 'opacity-50' : ''} ${hf ? 'border-l-2 border-l-[#B00000]' : ''}`}>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/entities/${e.id}`} className="text-gray-900 hover:text-[#0E7490]">
                      {e.name} {hf && <span title={e.hard_filter} className="text-[#B00000]">⚑</span>}
                    </Link>
                    <RelationshipCompactLine entityId={e.id} />
                  </td>
                  <td className="px-3 py-2 text-gray-500">{e.type.replace('_', ' ')}</td>
                  <td className="px-3 py-2 text-gray-500">{e.hq_city ? `${e.hq_city}, ` : ''}{e.hq_country}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{fmtEur(e.check_min_eur)}–{fmtEur(e.check_max_eur)}</td>
                  <td className="px-3 py-2">
                    {e.sectors.slice(0, 2).map((s) => (
                      <span key={s} className="mr-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{s}</span>
                    ))}
                    {e.sectors.length > 2 && <span className="text-[11px] text-gray-400">+{e.sectors.length - 2}</span>}
                  </td>
                  <td className="px-3 py-2"><FitTag fit={e.fit_score} /></td>
                  <td className="px-3 py-2"><WaveTag wave={e.wave} /></td>
                  <td className="px-3 py-2"><StatusPill status={e.status} /></td>
                  <td className="px-3 py-2 max-w-[220px]">
                    {task ? (
                      <span className="text-xs">
                        <span className="text-gray-700">{task.title}</span>
                        {task.due_at && <span className={overdue ? 'ml-1 font-semibold text-[#B00000]' : 'ml-1 text-gray-400'}>
                          · {task.due_at.slice(5, 10)}
                        </span>}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {ready === null ? <span className="text-gray-300">·</span>
                      : ready ? <span title="Pre-flight green" className="text-green-600">●</span>
                      : <span title="Pre-flight failing — open the entity for details" className="text-[#B00000]">●</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
