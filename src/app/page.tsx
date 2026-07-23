'use client';
// Pipeline (home) — dense sortable/filterable entity table
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { FitTag, StatusPill, Tooltip, WaveTag, fmtEur } from '@/components/ui';
import { RelationshipCompactLine } from '@/components/RelationshipSummaryCard';
import { preflight, preflightSummary } from '@/lib/rules';
import { isPersonCandidate } from '@/lib/relationship';
import type { Db, Entity, TaskItem } from '@/lib/types';

const fitOrder = { high: 0, medium_high: 1, medium: 2, low: 3 };
const SORT_STORAGE_KEY = 'ablute-pipeline-sort-v1';

const SORT_COLUMNS = [
  { key: 'name', label: 'Entity' }, { key: 'type', label: 'Type' }, { key: 'hq', label: 'HQ' },
  { key: 'check', label: 'Check' }, { key: 'sectors', label: 'Sectors' }, { key: 'fit', label: 'Fit' },
  { key: 'wave', label: 'Wave' }, { key: 'status', label: 'Status' }, { key: 'next_action', label: 'Next action' },
  { key: 'ready', label: 'Ready', title: 'Rank-1 pre-flight' },
] as const;
type SortKey = typeof SORT_COLUMNS[number]['key'];

// Generic nulls-last comparator so every column sorts sensibly without a
// bespoke comparator per key — string/number/boolean all handled the same
// way, missing values always sink to the bottom regardless of direction.
function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? -1 : 1;
  return 0;
}

function nextAction(db: Db, e: Entity): TaskItem | undefined {
  return db.tasks.filter((t) => t.entity_id === e.id && !t.done)
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))[0];
}

function readiness(db: Db, e: Entity): boolean | null {
  if (['in_conversation', 'diligence', 'invested', 'dormant', 'passed'].includes(e.status)) return null;
  const rank1 = db.people.filter((p) => p.entity_id === e.id).sort((a, b) => a.seniority_rank - b.seniority_rank)[0];
  if (!rank1) return null;
  return preflightSummary(preflight(db, rank1, null)).green;
}

function sortValue(db: Db, key: SortKey, e: Entity): unknown {
  switch (key) {
    case 'name': return e.name;
    case 'type': return e.type;
    case 'hq': return `${e.hq_country ?? ''} ${e.hq_city ?? ''}`.trim() || null;
    case 'check': return e.check_min_eur ?? null;
    case 'sectors': return e.sectors.join(', ') || null;
    case 'fit': return e.fit_score ? fitOrder[e.fit_score] : null;
    case 'wave': return e.wave ?? null;
    case 'status': return e.status;
    case 'next_action': return nextAction(db, e)?.due_at ?? null;
    case 'ready': return readiness(db, e);
  }
}

export default function PipelinePage() {
  const { db, convertEntityToPerson, markEntityVerified } = useStore();
  const [q, setQ] = useState('');
  const [wave, setWave] = useState('');
  const [status, setStatus] = useState('');
  const [country, setCountry] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('wave');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? 'null');
      if (saved?.key) { setSortKey(saved.key); setSortDir(saved.dir === 'desc' ? 'desc' : 'asc'); }
    } catch { /* ignore malformed storage */ }
  }, []);
  useEffect(() => {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ key: sortKey, dir: sortDir }));
  }, [sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const rows = useMemo(() => {
    let list = [...db.entities];
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q.toLowerCase())
      || e.sectors.some((s) => s.toLowerCase().includes(q.toLowerCase())));
    if (wave) list = list.filter((e) => String(e.wave) === wave);
    if (status) list = list.filter((e) => e.status === status);
    if (country) list = list.filter((e) => e.hq_country === country);
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => cmp(sortValue(db, sortKey, a), sortValue(db, sortKey, b)) * dir
      || (a.wave ?? 9) - (b.wave ?? 9) || (fitOrder[a.fit_score ?? 'low'] - fitOrder[b.fit_score ?? 'low']));
    return list;
  }, [db, q, wave, status, country, sortKey, sortDir]);

  const countries = Array.from(new Set(db.entities.map((e) => e.hq_country).filter(Boolean))) as string[];
  const personCandidates = db.entities.filter((e) => isPersonCandidate(db, e));

  return (
    <div className="space-y-4">
      {personCandidates.length > 0 && (
        <div className="rounded-2xl border-l-4 border-purple-400 bg-purple-50 p-4">
          <div className="text-sm font-semibold text-purple-900">
            Needs verification — looks like a person, not a fund ({personCandidates.length})
          </div>
          <ul className="mt-2 space-y-2 text-sm">
            {personCandidates.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
                <Link href={`/entities/${e.id}`} className="font-medium text-gray-900 hover:text-[#0E7490]">{e.name}</Link>
                <span className="text-xs text-gray-400">{e.type.replace('_', ' ')} · no website · no email domain · no contacts on file</span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => convertEntityToPerson(e.id)}
                    className="rounded bg-purple-700 px-2 py-1 text-xs font-medium text-white hover:bg-purple-800">Convert to person (angel)</button>
                  <button onClick={() => markEntityVerified(e.id)}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50">Not a person</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

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
              {SORT_COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2" title={'title' in c ? c.title : undefined}>
                  <Tooltip text={`Sort by ${c.label.toLowerCase()}.`} side="bottom">
                    <button onClick={() => toggleSort(c.key)}
                      className={`flex items-center gap-1 font-medium uppercase tracking-wide hover:text-gray-700 ${sortKey === c.key ? 'text-[#0E7490]' : ''}`}>
                      {c.label} {sortKey === c.key && <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  </Tooltip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const ready = readiness(db, e);
              const task = nextAction(db, e);
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
                    {/* E2 — a previously-passed/dormant investor that carries a
                        reopen trigger has resurfaced via the reopen doctrine;
                        say WHY it's back so the row isn't just a greyed name. */}
                    {e.reopen_trigger && (e.status === 'dormant' || e.status === 'passed') && (
                      <div className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-700">
                        <span title="Reopen doctrine — why this is back in play">↻</span>
                        <span className="line-clamp-2">{e.reopen_trigger}</span>
                      </div>
                    )}
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
