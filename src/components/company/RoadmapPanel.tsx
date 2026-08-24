'use client';
// Prompt 359 Block A — the Roadmap tab shell: seeds default lanes on first
// real use, wraps RoadmapCanvas with the founder's own CRUD, and keeps the
// visibility toggle + category manager that used to live inside RoadmapCard
// (moved here now that Roadmap is a top-level tab, not a card inside
// Company — see settings/page.tsx).
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { authEnabled } from '@/lib/supabase';
import { Card, TermHint, Toggle } from '@/components/ui';
import { RoadmapCanvas } from './RoadmapCanvas';
import { CategoryManager } from './RoadmapCard';
import { SuggestedEventsPanel } from './SuggestedEventsPanel';
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
  const { db, updateOrg, addRoadmapCategory, addRoadmapEvent, updateRoadmapEvent, removeRoadmapEvent } = useStore();
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
    for (const lane of DEFAULT_LANES) void addRoadmapCategory(lane);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, db.roadmapCategories.length]);

  // Prompt 359 §A.3 — real Supabase mode: store-supabase.tsx's own initial
  // fetch already resolves before this component ever renders with data
  // (no localStorage hydration race to guard against), so the plain
  // in-memory check is enough there.
  useEffect(() => {
    if (!canEdit || !authEnabled || seededRef.current || db.roadmapCategories.length > 0) return;
    seededRef.current = true;
    for (const lane of DEFAULT_LANES) void addRoadmapCategory(lane);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, db.roadmapCategories.length]);

  const [error, setError] = useState('');

  async function handleCreate(input: { title: string; date: string; end_date?: string | null; status: RoadmapEventStatus; category_id: string | null; document_id?: string | null; date_precision?: 'exact' | 'approx' | 'quarter' }) {
    const { error: err } = await addRoadmapEvent({ ...input, date_precision: input.date_precision ?? 'exact' });
    if (err) setError(err);
  }
  async function handleUpdate(id: string, patch: Parameters<typeof updateRoadmapEvent>[1]) {
    const { error: err } = await updateRoadmapEvent(id, patch);
    if (err) setError(err);
  }
  function handleRemove(id: string) {
    if (window.confirm('Remove this event?')) removeRoadmapEvent(id);
  }

  return (
    <div className="max-w-4xl space-y-4">
      <Card title={<span className="inline-flex items-center gap-1">Roadmap <TermHint text="Your company's history and plan, drawn on a timeline." /></span>}>
        <div id="roadmap-visibility-toggle" className="mb-3 flex scroll-mt-16 flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-400">Click anywhere on a lane to add an event; drag to create a period; drag an event to move it.</p>
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

        {error && <p className="mb-2 text-xs text-[#B00000]">{error}</p>}

        <RoadmapCanvas
          events={db.roadmapEvents}
          categories={db.roadmapCategories}
          foundedYear={db.org.founded_year ?? null}
          editable={canEdit}
          documents={db.documents.map((d) => ({ id: d.id, name: d.name }))}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
        />

        {canEdit && <CategoryManager />}
      </Card>

      {canEdit && <SuggestedEventsPanel onAdd={handleCreate} />}
    </div>
  );
}
