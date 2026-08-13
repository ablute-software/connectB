'use client';
// Prompt 167 — Company tab roadmap: a horizontal timeline of hand-written
// milestones (never AI-generated — see the prompt's own "Não incluído
// aqui"). RoadmapTimeline is the shared, purely presentational piece:
// founder-editable here (RoadmapCard, mounted above IdentityCard in
// CompanyPanel.tsx) and reused read-only on the investor-facing dossier
// (portal/startup/[orgId]/page.tsx, Prompt 167 §C) — same component, just
// `editable={false}` and no callbacks, so the redesign/behavior of one
// never has to be kept in sync with a second copy of the other.
//
// Prompt 175 — two fixes on top of the Prompt 167 build:
// §A: the founding node's axis circle was h-8 w-8 while every milestone
// node's was h-6 w-6 — same centering logic, different circle heights, so
// the horizontal line sat at a different pixel height on the first segment
// than every other one ("desalinhado"). Both are NODE_SIZE now, no
// exceptions.
// §B: a from-scratch visual match against the reference image (not a loose
// restyle) — pastel theme rotating per card (not tied to past/future, per
// spec), an in-card status badge echoing the axis signal, themed item
// dots, a fuller Founded card, and always-visible click-to-scroll arrows
// alongside the native horizontal scroll.
//
// Prompt 177 — pixel-match pass against a literal reference image (not a
// text description) in the three zones that still diverged:
// 1) axis line: the code drew every segment as a SOLID colored bar (just a
//    lighter color for the future half) — the reference draws the past
//    half solid and the future half genuinely DASHED (a border style, not
//    a filled bar). Also a real bug found while comparing: FoundedNode's
//    own "after" segment was hardcoded to the future color (bg-cyan-200) —
//    founding has already happened by definition, that segment must always
//    render as "past", never as "future".
// 2) card/Founded sizing: FoundedNode's card+container (w-36/w-40) were
//    narrower than every MilestoneNode's (w-48/w-52) — the reference shows
//    Founded at the SAME width as the milestone cards, if anything the
//    widest one measured. Unified onto one shared, slightly larger size
//    (pill/year/item text sized up to match).
// 3) nav: the always-visible round ‹/› buttons flanking the whole timeline
//    don't exist in the reference at all — what's there instead is a slim
//    scrollbar-style bar BELOW the row of cards (thin track, a thumb
//    reflecting actual scroll position, small chevrons at each end, no big
//    buttons). Replaced accordingly; the native browser scrollbar is
//    hidden so only this one bar shows.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, TermHint, Toggle } from '@/components/ui';
import type { RoadmapMilestone, RoadmapPeriodKind } from '@/lib/types';
import { periodHasPassed, periodLabel, sortRoadmapPeriods, type RoadmapPeriod } from '@/lib/roadmap';

const QUARTERS = [1, 2, 3, 4] as const;
// Prompt 175 §A — the one size every axis circle (founding node included)
// now shares, so the connecting line never has to change height.
const NODE_SIZE = 'h-8 w-8';
// Prompt 177 §2 — the one size every card+container (founding node
// included) now shares — see the header note above.
const CARD_WIDTH = 'w-56';
const CONTAINER_WIDTH = 'w-60';

// Prompt 175 §B.1 — "rodar por uma pequena paleta... não necessariamente
// ligado ao passado/futuro" (Nuno's own words): a milestone's card color
// is purely its position in the rotation, never its past/future status —
// that signal lives in the status badge (§B.2) and the axis node instead.
const CARD_THEMES = [
  { bg: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', statusOn: 'border-emerald-500 bg-emerald-500', statusOff: 'border-emerald-300 bg-white text-emerald-300' },
  { bg: 'bg-blue-50', badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500', statusOn: 'border-blue-500 bg-blue-500', statusOff: 'border-blue-300 bg-white text-blue-300' },
  { bg: 'bg-purple-50', badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500', statusOn: 'border-purple-500 bg-purple-500', statusOff: 'border-purple-300 bg-white text-purple-300' },
];

// Prompt 177 §1 — one shared line-segment renderer: `solid` true draws the
// "already happened" half (a filled 2px bar, the app's own teal), false
// draws the "still ahead" half (a 2px DASHED border — genuinely dashed,
// not a lighter fill, matching the reference literally).
function AxisLine({ solid }: { solid: boolean }) {
  return solid
    ? <div className="h-0.5 flex-1 bg-[#0E7490]" />
    : <div className="h-0 flex-1 border-t-2 border-dashed border-gray-300" />;
}

function FoundedNode({ foundedYear }: { foundedYear: number | null }) {
  return (
    <div className={`flex ${CONTAINER_WIDTH} shrink-0 flex-col items-center`}>
      <div className="flex h-28 items-end pb-2">
        {foundedYear == null ? (
          <div className={`${CARD_WIDTH} rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-3 text-center text-xs text-amber-800`}>
            Set your founding year in <a href="#settings-identity" className="font-semibold underline">Identity</a> to start your roadmap.
          </div>
        ) : (
          <div className={`${CARD_WIDTH} rounded-xl bg-amber-50 p-3.5 shadow-sm`}>
            <div className="flex items-center justify-between gap-1.5">
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">Founded</span>
              <span aria-hidden="true" className="text-base">🚩</span>
            </div>
            <div className="mt-1.5 text-2xl font-bold text-amber-900">{foundedYear}</div>
            <div className="text-xs text-amber-700/80">Company founded</div>
          </div>
        )}
      </div>
      <div className="flex w-full items-center">
        {/* Nothing precedes the very first node — no line drawn (not even
            invisible-width flex-1, which would push the dot off-center). */}
        <div className={`flex ${NODE_SIZE} shrink-0 items-center justify-center rounded-full border-2 text-sm ${foundedYear == null ? 'border-dashed border-amber-300 bg-white text-amber-300' : 'border-amber-500 bg-amber-400 text-white'}`}>
          🚩
        </div>
        {/* Founding has already happened, by definition — this segment is
            always "past", never the future/dashed style. */}
        <AxisLine solid />
      </div>
      <div className="mt-1 h-28 text-xs font-medium text-amber-700">{foundedYear ?? '—'}</div>
    </div>
  );
}

function MilestoneNode<T extends RoadmapPeriod & { items: string[] }>({
  m, index, theme, editable, onEdit, onRemove, now, prevPast,
}: {
  m: T; index: number; theme: typeof CARD_THEMES[number]; editable: boolean; onEdit?: (m: T) => void; onRemove?: (m: T) => void; now: Date;
  // Prompt 177 §1 — whether the PREVIOUS node on the axis was already past,
  // so this node's own "before" segment agrees with that neighbor's
  // "after" segment (both sides of one physical line draw the same style —
  // see the header note's algebra) instead of each node guessing from its
  // own status alone, which would split every transition segment in two.
  prevPast: boolean;
}) {
  const label = periodLabel(m.period_kind, m.period_year, m.period_quarter);
  const past = periodHasPassed(m, now);
  const top = index % 2 === 0;
  const card = (
    <div className={`${CARD_WIDTH} rounded-xl p-3.5 text-sm shadow-sm ${theme.bg}`}>
      <div className="flex items-center justify-between gap-1.5">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${theme.badge}`}>{label}</span>
        {/* Prompt 175 §B.2 — the axis's own past/future signal, repeated
            inside the card so the state reads without following the line
            down to the node. */}
        <span aria-hidden="true"
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold text-white ${past ? theme.statusOn : theme.statusOff}`}>
          {past ? '✓' : ''}
        </span>
      </div>
      {m.items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {m.items.map((it, i) => (
            <li key={i} className="flex items-start gap-1.5 text-gray-700">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${theme.dot}`} aria-hidden="true" />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-gray-400">No milestones listed.</p>
      )}
      {editable && (
        <div className="mt-2.5 flex justify-end gap-2 border-t border-black/5 pt-1.5 text-xs text-gray-500">
          <button onClick={() => onEdit?.(m)} className="hover:text-gray-800">Edit</button>
          <button onClick={() => onRemove?.(m)} className="hover:text-[#B00000]">Remove</button>
        </div>
      )}
    </div>
  );

  return (
    <div className={`flex ${CONTAINER_WIDTH} shrink-0 flex-col items-center`}>
      <div className="flex h-28 items-end pb-2">{top && card}</div>
      <div className="flex w-full items-center">
        <AxisLine solid={prevPast} />
        <div className={`flex ${NODE_SIZE} shrink-0 items-center justify-center rounded-full border-2 text-sm text-white ${past ? 'border-[#0E7490] bg-[#0E7490]' : 'border-cyan-300 bg-white'}`}>
          {past && '✓'}
        </div>
        <AxisLine solid={past} />
      </div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
      <div className="flex h-28 items-start pt-2">{!top && card}</div>
    </div>
  );
}

// Prompt 177 §3 — replaces the always-visible round ‹/› buttons that used
// to flank the whole timeline: the reference has no such buttons, only a
// slim scrollbar-style bar BELOW the row of cards — a thin track, a thumb
// sized/positioned from the real scrollLeft/scrollWidth/clientWidth (not
// decorative), and small chevrons at each end. Polls on the container's
// own `scroll` event plus a `resize` listener (the row's total width can
// change if a milestone is added/removed while mounted).
function ScrollBar({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement> }) {
  const [thumb, setThumb] = useState({ left: 0, width: 100 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function update() {
      const { scrollLeft, scrollWidth, clientWidth } = el!;
      if (scrollWidth <= 0) return;
      setThumb({
        left: (scrollLeft / scrollWidth) * 100,
        width: Math.max(8, (clientWidth / scrollWidth) * 100),
      });
    }
    update();
    el.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [scrollRef]);

  function scrollBy(dir: -1 | 1) {
    scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  }

  return (
    <div className="mt-2 flex items-center gap-2 px-1">
      <button type="button" onClick={() => scrollBy(-1)} aria-label="Scroll timeline left"
        className="shrink-0 text-sm text-gray-400 hover:text-[#0E7490]">
        ‹
      </button>
      <div className="relative h-1.5 flex-1 rounded-full bg-gray-100">
        <div className="absolute top-0 h-1.5 rounded-full bg-gray-300" style={{ left: `${thumb.left}%`, width: `${thumb.width}%` }} />
      </div>
      <button type="button" onClick={() => scrollBy(1)} aria-label="Scroll timeline right"
        className="shrink-0 text-sm text-gray-400 hover:text-[#0E7490]">
        ›
      </button>
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
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      {/* Native scrollbar hidden — ScrollBar below is the only scroll
          indicator, matching the reference having exactly one. */}
      <div ref={scrollRef} className="flex items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <FoundedNode foundedYear={foundedYear} />
        {sorted.map((m, i) => (
          <MilestoneNode key={`${m.period_kind}:${m.period_year}:${m.period_quarter ?? ''}`}
            m={m} index={i + 1} theme={CARD_THEMES[i % CARD_THEMES.length]}
            editable={editable} onEdit={onEditClick} onRemove={onRemoveClick} now={now}
            prevPast={i === 0 ? true : periodHasPassed(sorted[i - 1], now)} />
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
      <ScrollBar scrollRef={scrollRef} />
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
    <Card title={<span className="inline-flex items-center gap-1">Roadmap <TermHint text="Key milestones and goals for the journey ahead." /></span>}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-400">Key milestones and goals for the journey ahead.</p>
        {canEdit && (
          <Toggle checked={db.org.roadmap_visible_to_investors ?? true}
            onChange={(v) => updateOrg({ roadmap_visible_to_investors: v })}
            label={
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                Let investors you&apos;re in contact with see this roadmap
                <TermHint text="Visible to any investor at level 1+ (they've expressed interest or you've granted access) once this is on." />
              </span>
            } />
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
