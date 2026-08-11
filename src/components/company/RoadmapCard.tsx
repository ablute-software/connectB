'use client';
// Prompt 167 — Company tab roadmap: a horizontal timeline of hand-written
// milestones (never AI-generated — see the prompt's own "Não incluído
// aqui"). RoadmapTimeline is the shared, purely presentational piece:
// founder-editable here (RoadmapCard, mounted above IdentityCard in
// CompanyPanel.tsx) and reused read-only on the investor-facing dossier
// (portal/startup/[orgId]/page.tsx, Prompt 167 §C) — same component, just
// `editable={false}` and no callbacks, so the redesign/behavior of one
// never has to be kept in sync with a second copy of the other.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import type { RoadmapMilestone, RoadmapPeriodKind } from '@/lib/types';
import { periodHasPassed, periodLabel, sortRoadmapPeriods, type RoadmapPeriod } from '@/lib/roadmap';

const QUARTERS = [1, 2, 3, 4] as const;

function FoundedNode({ foundedYear }: { foundedYear: number | null }) {
  return (
    <div className="flex w-40 shrink-0 flex-col items-center">
      <div className="flex h-28 items-end pb-2">
        {foundedYear == null ? (
          <div className="w-36 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-2.5 text-center text-[11px] text-amber-800">
            Set your founding year in <a href="#settings-identity" className="font-semibold underline">Identity</a> to start your roadmap.
          </div>
        ) : (
          <div className="w-32 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Founded</div>
            <div className="text-lg font-bold text-amber-900">{foundedYear}</div>
          </div>
        )}
      </div>
      <div className="flex w-full items-center">
        <div className="h-0.5 flex-1" />
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm ${foundedYear == null ? 'border-dashed border-amber-300 bg-white text-amber-300' : 'border-amber-500 bg-amber-400 text-white'}`}>
          🚩
        </div>
        <div className="h-0.5 flex-1 bg-cyan-200" />
      </div>
      <div className="mt-1 h-28 text-xs font-medium text-amber-700">{foundedYear ?? '—'}</div>
    </div>
  );
}

function MilestoneNode<T extends RoadmapPeriod & { items: string[] }>({
  m, index, editable, onEdit, onRemove, now,
}: {
  m: T; index: number; editable: boolean; onEdit?: (m: T) => void; onRemove?: (m: T) => void; now: Date;
}) {
  const label = periodLabel(m.period_kind, m.period_year, m.period_quarter);
  const past = periodHasPassed(m, now);
  const top = index % 2 === 0;
  const card = (
    <div className="w-48 rounded-xl border border-gray-200 bg-white p-3 text-xs shadow-sm">
      <div className="flex items-center justify-between gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${past ? 'bg-cyan-50 text-[#0E7490]' : 'border border-gray-200 text-gray-500'}`}>
          {label}
        </span>
        {editable && (
          <div className="flex shrink-0 gap-1.5 text-[11px] text-gray-400">
            <button onClick={() => onEdit?.(m)} className="hover:text-gray-700">Edit</button>
            <button onClick={() => onRemove?.(m)} className="hover:text-[#B00000]">Remove</button>
          </div>
        )}
      </div>
      {m.items.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {m.items.map((it, i) => (
            <li key={i} className="flex items-start gap-1.5 text-gray-700">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-gray-400" aria-hidden="true" />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-gray-400">No milestones listed.</p>
      )}
    </div>
  );

  return (
    <div className="flex w-52 shrink-0 flex-col items-center">
      <div className="flex h-28 items-end pb-2">{top && card}</div>
      <div className="flex w-full items-center">
        <div className={`h-0.5 flex-1 ${past ? 'bg-[#0E7490]' : 'bg-cyan-200'}`} />
        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] text-white ${past ? 'border-[#0E7490] bg-[#0E7490]' : 'border-cyan-300 bg-white'}`}>
          {past && '✓'}
        </div>
        <div className={`h-0.5 flex-1 ${past ? 'bg-[#0E7490]' : 'bg-cyan-200'}`} />
      </div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
      <div className="flex h-28 items-start pt-2">{!top && card}</div>
    </div>
  );
}

export function RoadmapTimeline<T extends RoadmapPeriod & { items: string[] }>({
  foundedYear, milestones, editable, onAddClick, onEditClick, onRemoveClick, now = new Date(),
}: {
  foundedYear: number | null;
  milestones: T[];
  editable: boolean;
  onAddClick?: () => void;
  onEditClick?: (m: T) => void;
  onRemoveClick?: (m: T) => void;
  now?: Date;
}) {
  const sorted = sortRoadmapPeriods(milestones);
  return (
    <div className="flex items-stretch overflow-x-auto pb-1">
      <FoundedNode foundedYear={foundedYear} />
      {sorted.map((m, i) => (
        <MilestoneNode key={`${m.period_kind}:${m.period_year}:${m.period_quarter ?? ''}`}
          m={m} index={i + 1} editable={editable} onEdit={onEditClick} onRemove={onRemoveClick} now={now} />
      ))}
      {editable && (
        <div className="flex w-28 shrink-0 flex-col items-center justify-center">
          <button onClick={onAddClick}
            className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-dashed border-cyan-300 text-xl font-bold text-[#0E7490] hover:bg-cyan-50">
            +
          </button>
          <span className="mt-1 text-xs font-medium text-[#0E7490]">Add milestone</span>
        </div>
      )}
    </div>
  );
}

interface MilestoneDraft { period_kind: RoadmapPeriodKind; period_year: string; period_quarter: string; itemsText: string }
const BLANK_DRAFT: MilestoneDraft = { period_kind: 'quarter', period_year: '', period_quarter: '1', itemsText: '' };

function draftFromMilestone(m: RoadmapMilestone): MilestoneDraft {
  return {
    period_kind: m.period_kind, period_year: String(m.period_year),
    period_quarter: String(m.period_quarter ?? 1), itemsText: m.items.join('\n'),
  };
}

function MilestoneForm({ draft, setDraft, onSave, onCancel, saving, err }: {
  draft: MilestoneDraft; setDraft: (d: MilestoneDraft) => void;
  onSave: () => void; onCancel: () => void; saving: boolean; err: string;
}) {
  const yearNum = Number(draft.period_year);
  const yearValid = draft.period_year.trim() !== '' && Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-cyan-100 bg-cyan-50/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={draft.period_kind} onChange={(e) => setDraft({ ...draft, period_kind: e.target.value as RoadmapPeriodKind })}
          className="rounded border border-gray-300 px-2 py-1 text-sm">
          <option value="quarter">Quarter</option>
          <option value="year">Year</option>
        </select>
        <input type="number" value={draft.period_year} onChange={(e) => setDraft({ ...draft, period_year: e.target.value })}
          placeholder="Year (e.g. 2026)" className="w-32 rounded border border-gray-300 px-2 py-1 text-sm" />
        {draft.period_kind === 'quarter' && (
          <select value={draft.period_quarter} onChange={(e) => setDraft({ ...draft, period_quarter: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1 text-sm">
            {QUARTERS.map((q) => <option key={q} value={q}>Q{q}</option>)}
          </select>
        )}
      </div>
      <textarea value={draft.itemsText} onChange={(e) => setDraft({ ...draft, itemsText: e.target.value })} rows={3}
        placeholder={'One milestone per line, e.g.\nScale to 50 customers\nOpen UK market'}
        className="w-full rounded border border-gray-300 p-2 text-sm" />
      {!yearValid && draft.period_year.trim() !== '' && <p className="text-xs text-[#B00000]">Year must be between 2000 and 2100.</p>}
      {err && <p className="text-xs text-[#B00000]">{err}</p>}
      <div className="flex gap-2">
        <button disabled={!yearValid || saving} onClick={onSave}
          className="rounded bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="rounded border border-gray-300 px-3 py-1.5 text-xs">Cancel</button>
      </div>
    </div>
  );
}

export function RoadmapCard({ canEdit, available }: { canEdit: boolean; available: boolean }) {
  const { db, updateOrg, addRoadmapMilestone, updateRoadmapMilestone, removeRoadmapMilestone } = useStore();

  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<MilestoneDraft>(BLANK_DRAFT);
  const [addErr, setAddErr] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MilestoneDraft>(BLANK_DRAFT);
  const [editErr, setEditErr] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  if (!available) return null;

  function itemsFromText(text: string): string[] {
    return text.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async function submitAdd() {
    const items = itemsFromText(addDraft.itemsText);
    setAddSaving(true); setAddErr('');
    try {
      const { error } = await addRoadmapMilestone({
        period_kind: addDraft.period_kind, period_year: Number(addDraft.period_year),
        period_quarter: addDraft.period_kind === 'quarter' ? Number(addDraft.period_quarter) : undefined,
        items,
      });
      if (error) { setAddErr(error); return; }
      setAdding(false); setAddDraft(BLANK_DRAFT);
    } finally { setAddSaving(false); }
  }

  function startEdit(m: RoadmapMilestone) {
    setEditDraft(draftFromMilestone(m));
    setEditErr('');
    setEditingId(m.id);
  }
  async function submitEdit() {
    if (!editingId) return;
    const items = itemsFromText(editDraft.itemsText);
    setEditSaving(true); setEditErr('');
    try {
      const { error } = await updateRoadmapMilestone(editingId, {
        period_kind: editDraft.period_kind, period_year: Number(editDraft.period_year),
        period_quarter: editDraft.period_kind === 'quarter' ? Number(editDraft.period_quarter) : undefined,
        items,
      });
      if (error) { setEditErr(error); return; }
      setEditingId(null);
    } finally { setEditSaving(false); }
  }

  return (
    <Card title="Roadmap">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-400">Key milestones and goals for the journey ahead.</p>
        {canEdit && (
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={db.org.roadmap_visible_to_investors ?? true}
              onChange={(e) => updateOrg({ roadmap_visible_to_investors: e.target.checked })} />
            Let investors you&apos;re in contact with see this roadmap
          </label>
        )}
      </div>

      <RoadmapTimeline
        foundedYear={db.org.founded_year ?? null}
        milestones={db.roadmapMilestones}
        editable={canEdit}
        onAddClick={() => { setAdding(true); setEditingId(null); }}
        onEditClick={startEdit}
        onRemoveClick={(m) => { if (window.confirm('Remove this milestone?')) removeRoadmapMilestone(m.id); }}
      />

      {adding && (
        <MilestoneForm draft={addDraft} setDraft={setAddDraft} onSave={submitAdd}
          onCancel={() => { setAdding(false); setAddDraft(BLANK_DRAFT); setAddErr(''); }}
          saving={addSaving} err={addErr} />
      )}
      {editingId && (
        <MilestoneForm draft={editDraft} setDraft={setEditDraft} onSave={submitEdit}
          onCancel={() => { setEditingId(null); setEditErr(''); }}
          saving={editSaving} err={editErr} />
      )}
    </Card>
  );
}
