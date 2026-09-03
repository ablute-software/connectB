'use client';
// Prompt 359 Block A — the Roadmap tab shell: seeds default lanes on first
// real use, wraps RoadmapCanvas with the founder's own CRUD, and keeps the
// visibility toggle + category manager that used to live inside RoadmapCard
// (moved here now that Roadmap is a top-level tab, not a card inside
// Company — see settings/page.tsx).
//
// Prompt 385 — the premium visual pass: glass cards, "Prism on White"
// tokens, Geist (scoped to this tab only — src/lib/fonts.ts), and the new
// layout the mockup specifies — canvas on top, then Categories (1 col)
// beside the event detail panel (3 col), then Suggested events full width.
// Selection is lifted here (selectedId) rather than owned inside
// RoadmapCanvas, so the detail panel can live in this component's own DOM
// tree, beside Categories, below the canvas — outside RoadmapCanvas's own
// subtree, per the mockup's layout. `selectedEvent` is looked up from
// db.roadmapEvents BY ID on every render rather than kept as a captured
// object — the exact fix for the stale-reference bug Prompt 368's own
// comment (now removed from RoadmapCanvas.tsx) documented: after a delete,
// the id simply stops resolving and the panel falls back to its own empty
// state, with nothing to remember to clear.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { authEnabled } from '@/lib/supabase';
import { useConfirm } from '@/lib/confirm';
import { TermHint } from '@/components/ui';
import { roadmapFont } from '@/lib/fonts';
import { RoadmapCanvas } from './RoadmapCanvas';
import { RoadmapEventDetailPanel } from './RoadmapEventDetailPanel';
import { CategoryManager } from './RoadmapCard';
import { SuggestedEventsPanel } from './SuggestedEventsPanel';
import { GLASS_CARD, GLASS_PILL } from './roadmap-visual';
import { derivedFoundedEvent } from '@/lib/roadmap-derived';
import type { RoadmapEventStatus } from '@/lib/types';

// Prompt 359 §A.3 — the default lanes an investor actually reads a company
// by, seeded once per org the first time this tab is opened with none yet
// (never overwriting a founder's own custom categories — only fires when
// the list is empty). Regulatory & IP is its own lane, not folded into
// "Technology" — for a regulated vertical (the ablute_ case: CE/MDR) this
// is a first-class investor concern, not an afterthought.
const DEFAULT_LANES: { label: string; color: 'blue' | 'green' | 'amber' | 'purple' | 'teal'; shape: 'rounded' }[] = [
  { label: 'Technology & Product', color: 'blue', shape: 'rounded' },
  { label: 'Market & Commercial', color: 'green', shape: 'rounded' },
  { label: 'Funding', color: 'amber', shape: 'rounded' },
  { label: 'Team & Company', color: 'purple', shape: 'rounded' },
  { label: 'Regulatory & IP', color: 'teal', shape: 'rounded' },
];

// Same literal store-demo.tsx's own STORAGE_KEY uses. Duplicated rather than
// imported from that module on purpose — importing it here introduced a
// module-graph cycle (RoadmapPanel -> store-demo -> ... -> back to a
// component tree that reaches RoadmapPanel) that left `authEnabled` (from
// '@/lib/supabase', a completely unrelated module) transiently unresolved
// at runtime, a real, reproduced ReferenceError, not a lint nit. If this
// key ever changes, store-demo.tsx's own constant is still the source of
// truth — update both together.
const DEMO_STORAGE_KEY = 'ablute-crm-demo-v3';

export function RoadmapPanel({ canEdit }: { canEdit: boolean }) {
  const { db, loading, updateOrg, seedRoadmapCategories, addRoadmapEvent, updateRoadmapEvent, removeRoadmapEvent } = useStore();
  const confirm = useConfirm();
  // Prompt 359 §A.3 — seeding the defaults races the demo store's OWN
  // localStorage hydration: DemoStoreProvider starts `db` at the bare seed
  // (roadmapCategories: []) and only replaces it with what's actually saved
  // inside its own effect — an ordinary render-driven check here can fire
  // before that swap lands, seed 5 categories against the stale empty
  // state, and do it again on the next reload before ITS OWN prior batch
  // has been read back. Confirmed live: reproduced with plain state AND
  // with a setTimeout(0) deferral (still raced) — the only check that
  // actually reflects "what demo mode has persisted so far" at the instant
  // this effect runs is localStorage itself, read directly, once, here.
  // This bypasses the store abstraction on purpose, narrowly, only for this
  // one-time bootstrap decision, and only in demo mode; every other roadmap
  // action in this file still goes through the store exactly as normal.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!canEdit || seededRef.current || authEnabled) return;
    let alreadyHasCategories = db.roadmapCategories.length > 0;
    try {
      const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) as { roadmapCategories?: unknown[] } : null;
      if (saved?.roadmapCategories && saved.roadmapCategories.length > 0) alreadyHasCategories = true;
    } catch { /* fall through to the in-memory check above */ }
    if (alreadyHasCategories) return;
    seededRef.current = true;
    void seedRoadmapCategories(DEFAULT_LANES);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, db.roadmapCategories.length]);

  // Prompt 540 RC1 — real Supabase mode, and the two changes here are the fix.
  //
  // 1. `!loading`. The old comment claimed "the initial fetch already
  //    resolves before this component ever renders with data". It does not:
  //    store-supabase.tsx sets orgIdRef BEFORE awaiting loadAll, and
  //    settings/page.tsx mounts this panel with no loading gate, so opening
  //    /settings?tab=roadmap directly ran this effect against EMPTY_DB while
  //    the load was still in flight. finishInitialLoad then overwrote
  //    whatever it had committed, and a later mount — with a fresh
  //    seededRef — could seed all over again. No duplicates reached
  //    production, but the window is real and this closes it.
  // 2. ONE call instead of a five-iteration loop. Each iteration was a
  //    separate insert against the same captured snapshot; four of the five
  //    commits were thrown away. See roadmap-seed.ts.
  useEffect(() => {
    if (!canEdit || !authEnabled || loading || seededRef.current || db.roadmapCategories.length > 0) return;
    seededRef.current = true;
    void seedRoadmapCategories(DEFAULT_LANES);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, loading, db.roadmapCategories.length]);

  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Prompt 540 RC2 — the founding marker is DERIVED from db.org.founded_year
  // on every render, not read from a row. Reactive by construction: change
  // the year in About and this memo recomputes, so the mark moves with no
  // save, no refetch and no refresh. Because nothing is written, navigating
  // away and back cannot produce a second one — which is precisely how the
  // old AI-suggestion path ended up with two.
  const derivedFounded = useMemo(
    () => derivedFoundedEvent(db.org, db.roadmapEvents, db.roadmapCategories),
    [db.org, db.roadmapEvents, db.roadmapCategories],
  );
  const canvasEvents = useMemo(
    () => (derivedFounded ? [...db.roadmapEvents, derivedFounded] : db.roadmapEvents),
    [db.roadmapEvents, derivedFounded],
  );

  const selectedEvent = selectedId ? db.roadmapEvents.find((e) => e.id === selectedId) ?? null : null;
  // A derived mark is selectable — it just resolves to its own read-only
  // panel rather than a row-backed one.
  const selectedDerived = derivedFounded && selectedId === derivedFounded.id ? derivedFounded : null;
  // Prompt 387 §D.3 — "Add as event" on a question card sets this; the
  // canvas opens its own create popover pre-filled the moment it sees it,
  // then reports back so it's cleared and never re-opens on its own.
  const [prefillTitle, setPrefillTitle] = useState<string | null>(null);

  // Prompt 387 §B.3 — this slot used to be sticky (never cleared) and, on
  // an action that DID surface an error, showed the raw store message
  // verbatim — Nuno's own screenshot had a bare "TypeError: Failed to
  // fetch" sitting here. Every action now clears it on its own success and
  // prefixes a failure with which action failed, never the raw exception.
  async function handleCreate(input: { title: string; date: string; end_date?: string | null; status: RoadmapEventStatus; category_id: string | null; document_id?: string | null; date_precision?: 'exact' | 'approx' | 'quarter' }) {
    const { error: err } = await addRoadmapEvent({ ...input, date_precision: input.date_precision ?? 'exact' });
    setError(err ? `Couldn't add the event: ${err}` : '');
  }
  async function handleUpdate(id: string, patch: Parameters<typeof updateRoadmapEvent>[1]) {
    const { error: err } = await updateRoadmapEvent(id, patch);
    setError(err ? `Couldn't save the event: ${err}` : '');
  }
  async function handleRemove(id: string) {
    if (!(await confirm({ message: 'Remove this event?', destructive: true }))) return;
    removeRoadmapEvent(id);
    setError('');
  }

  // Prompt 540 RC2 — a roadmap whose only mark is the derived founding one
  // still needs the detail panel, or clicking that mark would do nothing.
  const hasEvents = canvasEvents.length > 0;

  return (
    <div className={`${roadmapFont.className} max-w-6xl space-y-6`}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-semibold tracking-[-0.02em] text-[#131b2e]">
            Roadmap <TermHint text="Your company's history and plan, drawn on a timeline." />
          </h1>
          <p className="mt-0.5 text-sm text-[#434656]">Strategic trajectory and key milestones.</p>
        </div>
        {canEdit && (
          <label id="roadmap-visibility-toggle" className={`flex scroll-mt-16 cursor-pointer items-center gap-3 px-5 py-2.5 text-xs font-medium text-[#434656] ${GLASS_PILL}`}>
            <span className="relative inline-flex">
              <input type="checkbox" checked={db.org.roadmap_visible_to_investors ?? true}
                onChange={(e) => updateOrg({ roadmap_visible_to_investors: e.target.checked })} className="peer sr-only" />
              <span className="h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-[#0041c8]" />
              <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
            </span>
            <span className="inline-flex items-center gap-1">
              Share Roadmap with Investors
              <TermHint text="Visible to any investor at level 1+ (they've expressed interest or you've granted access) once this is on." />
            </span>
          </label>
        )}
      </header>

      {error && <p className="text-xs text-[#ba1a1a]">{error}</p>}

      {/* Prompt 540 RC1 §3 — the canvas waits for the store, instead of
          rendering an empty timeline over data that is still arriving. The
          old behaviour drew "no categories yet" for the duration of the
          initial load, which is what made the founder reach for a refresh
          in the first place. Same glass card, no timers, no reload. */}
      {loading ? (
        <div className={`${GLASS_CARD} min-h-[160px] animate-pulse p-5`} aria-busy="true" aria-label="Loading your roadmap">
          <div className="mb-4 h-3 w-72 rounded bg-black/5" />
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-3 w-36 rounded bg-black/5" />
                <div className="h-6 flex-1 rounded-lg bg-black/[0.04]" />
              </div>
            ))}
          </div>
        </div>
      ) : (
      <div className={`${GLASS_CARD} min-h-[160px] p-5`}>
        <p className="mb-3 text-xs text-[#434656]/70">
          Click anywhere on a lane to add an event; drag to create a period; click a bar to see its details.
        </p>
        <RoadmapCanvas
          events={canvasEvents}
          categories={db.roadmapCategories}
          foundedYear={db.org.founded_year ?? null}
          editable={canEdit}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          selectedId={selectedId}
          onSelect={setSelectedId}
          prefillTitle={prefillTitle}
          onPrefillConsumed={() => setPrefillTitle(null)}
        />
      </div>
      )}

      {hasEvents && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <CategoryManager />
          </div>
          <div className="lg:col-span-3">
            {/* Prompt 540 RC2 §3 — a derived mark gets its own read-only
                panel: there is no row to edit, delete or recategorise, and
                offering those controls would produce writes against an id
                that does not exist. It says where the date actually comes
                from and links to the field that owns it. */}
            {selectedDerived ? (
              <div className={`${GLASS_CARD} min-h-[140px] p-6`}>
                <p className="text-lg font-semibold text-[#131b2e]">{selectedDerived.title}</p>
                <p className="mt-1 text-sm text-[#434656]">{selectedDerived.date.slice(0, 4)}</p>
                <p className="mt-3 text-xs text-[#434656]/80">
                  From your company profile — edit <span className="font-medium">Year founded</span> in About.
                </p>
                <a href="/settings?tab=about#identity.founded_year"
                  className="mt-3 inline-block text-xs font-medium text-[#0041c8] hover:underline">
                  Open About →
                </a>
              </div>
            ) : (
              <RoadmapEventDetailPanel
                event={selectedEvent}
                categories={db.roadmapCategories}
                editable={canEdit}
                documents={db.documents.map((d) => ({ id: d.id, name: d.name }))}
                onUpdate={handleUpdate}
                onRemove={handleRemove}
              />
            )}
          </div>
        </div>
      )}
      {!hasEvents && canEdit && <CategoryManager />}

      {canEdit && <SuggestedEventsPanel onAdd={handleCreate} onAddAsEvent={setPrefillTitle} />}
    </div>
  );
}
