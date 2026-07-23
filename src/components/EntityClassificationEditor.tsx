'use client';
// Batch 3 E1 — per-field inline editing of an investor's classification with
// a STANDARDIZED taxonomy (shared vocabulary across all investors) plus an
// "outro…" free-text escape. Sectors and geographies are multi-value; stage
// is a min–max range. Writes go through the generic updateEntity patch.
import { useState } from 'react';
import type { Entity, Stage } from '@/lib/types';
import { GEOGRAPHIES, SECTORS, STAGE_OPTIONS } from '@/lib/taxonomy';

function MultiEdit({ values, options, onChange }: { values: string[]; options: string[]; onChange: (v: string[]) => void }) {
  const [custom, setCustom] = useState('');
  const available = options.filter((o) => !values.includes(o));
  function add(v: string) { const t = v.trim(); if (t && !values.includes(t)) onChange([...values, t]); }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] text-cyan-800">
            {v}
            <button onClick={() => onChange(values.filter((x) => x !== v))} className="text-cyan-500 hover:text-cyan-800">×</button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-gray-400">none</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <select value="" onChange={(e) => { if (e.target.value) add(e.target.value); }}
          className="rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="">+ add…</option>
          {available.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input value={custom} onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { add(custom); setCustom(''); } }}
          placeholder="outro… (Enter)" className="w-28 rounded border border-gray-300 px-2 py-1 text-xs" />
      </div>
    </div>
  );
}

export function EntityClassificationEditor({ entity, onUpdate }: { entity: Entity; onUpdate: (patch: Partial<Entity>) => void }) {
  const [editing, setEditing] = useState<'sectors' | 'geos' | 'stage' | null>(null);
  const [sectors, setSectors] = useState<string[]>([]);
  const [geos, setGeos] = useState<string[]>([]);
  const [stageMin, setStageMin] = useState<Stage | ''>('');
  const [stageMax, setStageMax] = useState<Stage | ''>('');

  function startSectors() { setSectors(entity.sectors); setEditing('sectors'); }
  function startGeos() { setGeos(entity.invests_in_geographies); setEditing('geos'); }
  function startStage() { setStageMin(entity.stage_min ?? ''); setStageMax(entity.stage_max ?? ''); setEditing('stage'); }

  const pencil = (onClick: () => void) => (
    <button onClick={onClick} title="Edit" className="ml-1 text-[11px] text-gray-300 hover:text-cyan-700">✎</button>
  );

  return (
    <>
      <div>
        Geos: {editing === 'geos' ? (
          <span className="ml-1 inline-block align-top">
            <MultiEdit values={geos} options={GEOGRAPHIES} onChange={setGeos} />
            <div className="mt-1 flex gap-2">
              <button onClick={() => { onUpdate({ invests_in_geographies: geos }); setEditing(null); }} className="rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-medium text-white">Save</button>
              <button onClick={() => setEditing(null)} className="text-[11px] text-gray-500">Cancel</button>
            </div>
          </span>
        ) : <>{entity.invests_in_geographies.join(', ') || '—'}{pencil(startGeos)}</>}
      </div>
      <div>
        Sectors: {editing === 'sectors' ? (
          <span className="ml-1 inline-block align-top">
            <MultiEdit values={sectors} options={SECTORS} onChange={setSectors} />
            <div className="mt-1 flex gap-2">
              <button onClick={() => { onUpdate({ sectors }); setEditing(null); }} className="rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-medium text-white">Save</button>
              <button onClick={() => setEditing(null)} className="text-[11px] text-gray-500">Cancel</button>
            </div>
          </span>
        ) : <>{entity.sectors.join(', ') || '—'}{pencil(startSectors)}</>}
      </div>
      <div>
        Stage: {editing === 'stage' ? (
          <span className="ml-1 inline-flex items-center gap-1">
            <select value={stageMin} onChange={(e) => setStageMin(e.target.value as Stage | '')} className="rounded border border-gray-300 px-1 py-0.5 text-xs">
              <option value="">—</option>{STAGE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <span>–</span>
            <select value={stageMax} onChange={(e) => setStageMax(e.target.value as Stage | '')} className="rounded border border-gray-300 px-1 py-0.5 text-xs">
              <option value="">—</option>{STAGE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button onClick={() => { onUpdate({ stage_min: stageMin || undefined, stage_max: stageMax || undefined }); setEditing(null); }} className="rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-medium text-white">Save</button>
            <button onClick={() => setEditing(null)} className="text-[11px] text-gray-500">Cancel</button>
          </span>
        ) : <>{entity.stage_min?.replace('_', ' ') ?? '—'} – {entity.stage_max?.replace('_', ' ') ?? '—'}{pencil(startStage)}</>}
      </div>
    </>
  );
}
