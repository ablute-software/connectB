'use client';
// Prompt 517 Part 2 — the Roadmap's cold-start checklist.
//
// Deliberately NOT the same thing as SuggestedEventsPanel, which sits right
// below it: that one reads the founder's documents and asks an AI what it
// found, so it has nothing to say until documents exist. This one is a fixed,
// deterministic list — it works on day one, with no documents, no AI call and
// no network round-trip, and it asks the founder the only question that
// reliably unblocks an empty timeline: "which of these has already happened?"
//
// The list is the growth-signal hierarchy (src/lib/growth-signal-tiers.ts),
// the same 15 levels the composer ranks facts against. One list, two uses:
// what the founder records here is exactly the material a draft wants to lead
// with later.
//
// Sherlock golden rule: this must reduce weight, not add it. So — nothing is
// required, every item is one line, checking one opens two small fields and
// not a modal, and "Skip for now" is always there.
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { shuffledTiersForOrg, type GrowthSignalTier } from '@/lib/growth-signal-tiers';
import { GLASS_CARD, LABEL_CAPS } from './roadmap-visual';
import type { RoadmapEventStatus } from '@/lib/types';

const FIELD = 'rounded-lg border border-[#c3c5d9] bg-white/70 px-2 py-1 text-sm';

export function RoadmapStarterChecklist({ onCreate, onSkip }: {
  onCreate: (input: {
    title: string; date: string; description?: string | null; status: RoadmapEventStatus;
    category_id: string | null; date_precision?: 'exact' | 'approx' | 'quarter';
  }) => Promise<{ error?: string } | void>;
  onSkip: () => void;
}) {
  const { db, updateOrg } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [detail, setDetail] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Which items already produced an event in this session. Purely visual —
  // the source of truth is db.roadmapEvents; this only stops a row the
  // founder just filled in from looking untouched.
  const [doneIds, setDoneIds] = useState<string[]>([]);

  const [yearDraft, setYearDraft] = useState('');
  const [yearSaved, setYearSaved] = useState(false);
  const needsFoundedYear = db.org.founded_year == null && !yearSaved;

  // Stable per org — see shuffledTiersForOrg's own note on why this must not
  // be a fresh Math.random() shuffle. useMemo keyed on the org id so it also
  // survives every re-render this component does while the founder types.
  const tiers = useMemo(() => shuffledTiersForOrg(db.org.id ?? 'org'), [db.org.id]);

  function categoryIdForTier(tier: GrowthSignalTier): string {
    return db.roadmapCategories.find((c) => c.label === tier.defaultLane)?.id ?? '';
  }

  function toggle(tier: GrowthSignalTier) {
    setError('');
    if (openId === tier.id) { setOpenId(null); return; }
    setOpenId(tier.id);
    setDate('');
    setDetail('');
    setCategoryId(categoryIdForTier(tier));
  }

  async function save(tier: GrowthSignalTier) {
    if (!date || !detail.trim()) return;
    setBusy(true);
    const res = await onCreate({
      title: tier.label,
      description: detail.trim(),
      date,
      status: 'done',
      date_precision: 'exact',
      category_id: categoryId || null,
    });
    setBusy(false);
    if (res && 'error' in res && res.error) { setError(res.error); return; }
    setDoneIds((prev) => [...prev, tier.id]);
    setOpenId(null);
    setDate('');
    setDetail('');
  }

  function saveYear() {
    const n = Number(yearDraft);
    // A four-digit sanity range only — IdentityCard is where the field is
    // properly edited; this is a shortcut, not a second editor.
    if (!Number.isInteger(n) || n < 1800 || n > 2200) { setError('Enter a four-digit year.'); return; }
    setError('');
    updateOrg({ founded_year: n });
    setYearSaved(true);
  }

  return (
    <div className={`${GLASS_CARD} p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold text-[#131b2e]">Want help getting started?</h2>
          <p className="mt-1 max-w-2xl text-sm text-[#434656]">
            Your timeline is empty, so here is the short version: tick anything below that has already happened,
            add the date and a line about it, and it becomes a milestone. Nothing here is required — one or two
            is already a roadmap.
          </p>
        </div>
        <button onClick={onSkip} className="rounded-lg border border-[#c3c5d9] px-3 py-1.5 text-xs text-[#434656] hover:bg-white/60">
          Skip for now
        </button>
      </div>

      {needsFoundedYear && (
        <div className="mt-5 rounded-[16px] border border-white/60 bg-white/50 p-4">
          <p className={`${LABEL_CAPS} text-[#434656]`}>First, when did the company start?</p>
          <p className="mt-1 text-xs text-[#434656]/80">This sets where your timeline begins.</p>
          <div className="mt-2 flex items-center gap-2">
            <input type="number" inputMode="numeric" value={yearDraft} onChange={(e) => setYearDraft(e.target.value)}
              placeholder="2023" className={`${FIELD} w-28`} aria-label="Year founded" />
            <button onClick={saveYear} disabled={!yearDraft.trim()}
              className="rounded-lg bg-[#0041c8] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              Save
            </button>
          </div>
        </div>
      )}

      <ul className="mt-5 space-y-1">
        {tiers.map((tier) => {
          const open = openId === tier.id;
          const done = doneIds.includes(tier.id);
          return (
            <li key={tier.id} className="rounded-[12px] px-1 py-0.5">
              <label className="flex cursor-pointer items-start gap-2.5 py-1.5 text-sm text-[#131b2e]">
                <input type="checkbox" checked={open || done} onChange={() => toggle(tier)} disabled={done}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#0041c8]" />
                <span className={done ? 'text-[#006c46]' : undefined}>
                  {tier.label}
                  {done && <span className="ml-2 text-xs">· added</span>}
                </span>
              </label>

              {open && (
                // Inline, not a second modal — the founder is already in a
                // "just tell me what happened" flow; a dialog on top of it is
                // exactly the weight this card exists to remove.
                <div className="ml-7 mb-2 grid gap-2 rounded-[16px] border border-white/60 bg-white/50 p-3 sm:grid-cols-[auto,1fr,auto]">
                  <label className="flex items-center gap-1.5 text-xs text-[#434656]">
                    When
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-[#434656]">
                    <span className="sr-only">Detail</span>
                    <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="What happened, in one line"
                      className={`${FIELD} w-full`} />
                  </label>
                  <div className="flex items-center gap-2">
                    {/* Suggested category, never imposed silently — the
                        founder may well read their own milestone differently
                        than a generic list does. */}
                    <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={FIELD} aria-label="Category">
                      <option value="">No category</option>
                      {db.roadmapCategories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                    <button onClick={() => void save(tier)} disabled={!date || !detail.trim() || busy}
                      className="rounded-lg bg-[#0041c8] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                      {busy ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-3 text-xs text-[#ba1a1a]">{error}</p>}
    </div>
  );
}
