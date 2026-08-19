'use client';
// Pipeline (home) — dense sortable/filterable entity table
import { useEffect, useMemo, useState } from 'react';
import { calcCompanyCompleteness } from '@/lib/companyCompleteness';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { authEnabled, browserClient } from '@/lib/supabase';
import { FitTag, StatusPill, Tooltip, WaveTag, fmtEur, statusLabel } from '@/components/ui';
import { LoadingState } from '@/components/workspace-shell/LoadingState';
import { MatchDealVisibilityBanner } from '@/components/dashboard/MatchDealVisibilityBanner';
import { RelationshipCompactLine } from '@/components/RelationshipSummaryCard';
import { ReawakeningQueue } from '@/components/ReawakeningQueue';
import { AddInvestorModal } from '@/components/AddInvestorModal';
import { isPersonCandidate, isUnverifiedStub } from '@/lib/relationship';
import { CoachMark } from '@/components/onboarding/CoachMark';
import { PageTour } from '@/components/onboarding/PageTour';
import { useOnboarding } from '@/lib/onboarding/OnboardingProvider';
import { useTrackPageView } from '@/lib/use-track-page-view';
import { nextMonthlyDeliveryDate } from '@/lib/catalog-monthly-delivery';
import type { Db, Entity, TaskItem } from '@/lib/types';

const fitOrder = { high: 0, medium_high: 1, medium: 2, low: 3 };
const SORT_STORAGE_KEY = 'ablute-pipeline-sort-v1';

// Prompt 188 §1 — measured in the actual render (demo data, DevTools),
// not guessed: thead is 32.5px, a single-line row (no relationship line,
// no reopen-trigger note, no wrapped next-action text) is 57px. Rows with
// that extra content wrap taller — table cells wrap instead of truncating
// by design (see the SORT_COLUMNS comment above) — so a wave with a lot of
// annotated rows will show a little under 15 before the scrollbar kicks
// in; there's no fixed-height table design that avoids that trade-off
// without truncating content the app deliberately never truncates.
const PIPELINE_LIST_MAX_HEIGHT_PX = 888; // 32.5 (thead) + 15 * 57 (row), rounded up

// Column widths sum to 100% — table-fixed (below) then holds the table to
// the container's width at every "wave" filter setting instead of growing
// with content and forcing horizontal scroll. Cell text wraps instead of
// truncating (see the td classes below) so nothing gets cut off silently.
const SORT_COLUMNS = [
  { key: 'name', label: 'Entity', width: '22%' }, { key: 'type', label: 'Type', width: '8%' },
  { key: 'hq', label: 'HQ', width: '10%' }, { key: 'check', label: 'Check', width: '10%' },
  { key: 'sectors', label: 'Sectors', width: '14%' }, { key: 'fit', label: 'Fit', width: '7%' },
  { key: 'wave', label: 'Wave', width: '6%' }, { key: 'status', label: 'Status', width: '10%' },
  { key: 'next_action', label: 'Next action', width: '13%' },
] as const;
type SortKey = typeof SORT_COLUMNS[number]['key'];
const SORT_KEYS = SORT_COLUMNS.map((c) => c.key) as SortKey[];

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

// "Last update" tag for the top-of-page summary cards. Built entirely from
// real fields (interaction channel/direction/classification, open task
// deadlines) — no mockup was available to match exactly (asked for a
// resend), so this is a best-effort reading of the same underlying data
// rather than a pixel-match; the shape (name + one short status tag) is
// what was specified even without the image.
function lastUpdateTag(db: Db, e: Entity): string | null {
  const task = nextAction(db, e);
  if (task?.due_at) {
    const daysOut = (new Date(task.due_at).getTime() - Date.now()) / 86_400_000;
    if (daysOut < 0) return 'Follow-up overdue';
    if (daysOut <= 3) return `Follow-up due · ${task.due_at.slice(5, 10)}`;
  }
  const interactions = db.interactions.filter((i) => i.entity_id === e.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const latest = interactions[0];
  if (!latest) return null;
  if (latest.classification === 'meeting_request' || latest.channel === 'meeting') return 'Meeting requested';
  if (latest.classification === 'interested') return 'Warm — interested';
  if (latest.direction === 'in') return 'Replied';
  const isFirstOutbound = latest.direction === 'out' && interactions.length === 1;
  if (isFirstOutbound) return 'Intro sent';
  if (latest.direction === 'out') return 'Follow-up sent';
  return null;
}

// Wave/Status/Sectors are all multi-select and combinable (AND across the
// three, OR within each one's selected values) — <details>/<summary> gives a
// keyboard-accessible dropdown with no extra open/close state, matching the
// <details> pattern already used elsewhere in the app (e.g. PacksPanel).
function MultiSelectFilter({ label, options, selected, onChange }: {
  label: string; options: { value: string; label: string }[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }
  return (
    <details className="relative">
      <summary className="cursor-pointer select-none list-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700 marker:content-none">
        {label}{selected.length > 0 && <span className="ml-1 text-[#0E7490]">({selected.length})</span>}
      </summary>
      <div className="absolute z-10 mt-1 max-h-64 w-52 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
        {options.length === 0 && <p className="px-1.5 py-1 text-xs text-gray-400">No options.</p>}
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-gray-50">
            <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
        {selected.length > 0 && (
          <button onClick={() => onChange([])} className="mt-1 w-full rounded px-1.5 py-1 text-left text-xs text-gray-400 hover:underline">Clear</button>
        )}
      </div>
    </details>
  );
}

// P104 #6 — the copy always described two paths (catalog assignment or
// manual import), but nothing ever called unlockPack() from any UI —
// confirmed by exhaustive grep, 0 rows in pack_unlocks for any real org.
// Self-service, confirmed with Nuno: once profile completeness crosses this
// threshold, a button appears and the founder triggers unlockPack()
// themselves — unlockPack() itself is untouched, already correct.
const SELF_SERVICE_COMPLETENESS_THRESHOLD = 70;
// Matched by name, not id — packs have no stable machine key (no `kind`
// column like folders do); acceptable here since this only ever unlocks a
// curated catalog pack, not a security-relevant lookup like Prompt 103's
// Data Room folder fix. Fails safe (button just doesn't render) if renamed.
const STARTER_PACK_NAME = 'Starter Europe';

// pipeline.empty (onboarding_sherlockdeal_v2.md §3, §1.1) — deliberately
// NOT part of the onboarding engine: no persistence, no dismiss button,
// no `seen` key. It's computed live from db.entities every render and
// disappears the instant it stops being true. `screen` replaces the whole
// page when there are zero entities at all; `banner` sits above the table
// when entities exist but none are wave-classified yet — same copy, same
// key, different container per the implementation note in §3.
function EmptyCompanyBlock({ variant }: { variant: 'screen' | 'banner' }) {
  const { db, unlockPack } = useStore();
  const [unlocking, setUnlocking] = useState(false);
  const [result, setResult] = useState<'added' | 'none' | null>(null);
  // Prompt 156 — the match runs off the profile data as it stands the
  // instant unlockPack() fires, and (per the plan's monthly cadence) can't
  // be re-run on demand afterward — so this button used to go straight
  // from "eligible" to "unlocked" with nothing in between confirming the
  // founder actually meant to lock that data in now. `confirming` is a
  // pure UI gate in front of the same unlockPack() call below — no new
  // state, no new endpoint, matches this prompt's own "UI only" scope.
  const [confirming, setConfirming] = useState(false);

  const { pct } = calcCompanyCompleteness(db.org, db.companyPeople);
  const starterPack = db.packs.find((p) => p.name === STARTER_PACK_NAME);
  const eligible = pct >= SELF_SERVICE_COMPLETENESS_THRESHOLD && !!starterPack;

  async function unlock() {
    if (!starterPack) return;
    setUnlocking(true);
    const added = await unlockPack(starterPack.id);
    setUnlocking(false);
    setConfirming(false);
    setResult(added > 0 ? 'added' : 'none');
  }

  return (
    <div className={variant === 'screen' ? 'flex min-h-[50vh] items-center justify-center' : 'rounded-2xl border border-gray-100 bg-white p-6 shadow-sm'}>
      <div className="mx-auto max-w-[420px] text-center">
        <div className="mx-auto mb-5 flex h-[80px] w-[80px] items-center justify-center rounded-full bg-gray-50 text-3xl">🔍</div>
        {confirming ? (
          <>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">Congratulations — we have enough to show you your best-matched investors</h2>
            <p className="mb-5 text-sm text-gray-500">
              Confirm your company profile is accurate before you unlock — the match uses this data as it stands right now.
              If something&apos;s wrong, fix it first: you won&apos;t get a fresh match until your plan&apos;s monthly renewal.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button disabled={unlocking} onClick={unlock}
                className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-50">
                {unlocking ? 'Unlocking…' : 'Confirm and unlock my pipeline'}
              </button>
              <button disabled={unlocking} onClick={() => setConfirming(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Let me check my profile first
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">No investors in the pipeline yet</h2>
            <p className="mb-5 text-sm text-gray-500">
              {eligible
                ? 'Your profile is complete enough to unlock your first batch of catalog investors, or you can import your own contacts.'
                : `As soon as your profile is at least ${SELF_SERVICE_COMPLETENESS_THRESHOLD}% complete you can unlock investors from the catalog yourself, or you can import your own contacts now.`}
            </p>
            {result === 'added' && <p className="mb-3 text-sm font-medium text-emerald-700">Done — check the table below.</p>}
            {result === 'none' && <p className="mb-3 text-sm text-gray-500">No new investors left in this pack for your account.</p>}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {eligible && (
                <button onClick={() => setConfirming(true)}
                  className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-50">
                  Unlock my pipeline
                </button>
              )}
              <Link href="/settings" className="inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {eligible ? 'Import contacts instead' : 'Complete your profile'}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Prompt 123 §B.3 acceptance — a visible number that moves as the founder
// completes their profile / uploads documents / logs milestones, not just
// static card copy. `null` (still loading, or the route failed) renders
// nothing rather than a misleading "0".
function PipelineUnlockBadge({ unlock }: { unlock: { visible: number; gateComplete: boolean; eligiblePoolSize: number } | null }) {
  if (!unlock) return null;
  if (!unlock.gateComplete) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Pipeline locked — complete your company profile (website, sector, stage, country, round target, current phase, founding year, revenue, and a primary contact) to start unlocking investors.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[#0E7490]/20 bg-[#E8F4F8] px-3 py-2 text-xs text-[#0E7490]">
      <span className="font-semibold">{unlock.visible}</span> of {unlock.eligiblePoolSize} eligible investors unlocked in your pipeline.
    </div>
  );
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
  }
}

export default function PipelinePage() {
  useTrackPageView('/pipeline');
  const { db, loading, markEntityVerified } = useStore();
  const [q, setQ] = useState('');
  const [wave, setWave] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [country, setCountry] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('wave');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [addInvestorOpen, setAddInvestorOpen] = useState(false);
  // Prompt 107 B.5 — which delivered entities are currently a suspended
  // investor. Derived at read time, never a mass write to `entities` (see
  // /api/pipeline/suspended-investors's own header for why).
  const [suspendedEntityIds, setSuspendedEntityIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!authEnabled) return;
    fetch('/api/pipeline/suspended-investors', { cache: 'no-store' }).then((r) => r.json())
      .then((b) => { if (b.ok) setSuspendedEntityIds(new Set(b.suspendedEntityIds)); }).catch(() => {});
  }, []);
  // How many catalog-sourced investors are blocked by the plan's accumulated
  // quota — a COUNT only, via the catalog_blocked_count() RPC (migration
  // 0042). Blocked rows themselves never reach this client at all: the
  // entities RLS SELECT policy already excludes them from every
  // `sb.from('entities')` read (including the one useStore's initial load
  // does), so there is nothing to filter here — this is purely "how many
  // more are there" for the frosted-glass message below.
  const [blockedCount, setBlockedCount] = useState(0);
  // Prompt 123 Block B.2 — the pipeline-unlock engine's live number (base
  // by plan + profile/upload/milestone bonuses + monthly growth). Re-checked
  // whenever entities change so it visibly moves right after a founder
  // completes their profile or uploads a deck, per the block's own
  // acceptance criterion.
  const [unlock, setUnlock] = useState<{ visible: number; gateComplete: boolean; eligiblePoolSize: number; catalogQuotaTarget: number } | null>(null);
  useEffect(() => {
    if (!authEnabled) return;
    fetch('/api/pipeline-unlock', { cache: 'no-store' }).then((r) => r.json())
      .then((b) => { if (b.ok) setUnlock({ visible: b.visible, gateComplete: b.gateComplete, eligiblePoolSize: b.eligiblePoolSize, catalogQuotaTarget: b.catalogQuotaTarget ?? 0 }); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.entities.length]);
  const { setCondition } = useOnboarding();

  // waves coach mark (§3): fires the first time the pipeline shows
  // investors already classified by wave.
  useEffect(() => {
    setCondition('waves', db.entities.some((e) => e.wave != null));
  }, [db.entities, setCondition]);

  useEffect(() => {
    if (!authEnabled || !db.org.id) return;
    browserClient().rpc('catalog_blocked_count', { check_org: db.org.id })
      .then(({ data, error }) => setBlockedCount(!error && typeof data === 'number' ? data : 0));
    // Re-checked whenever the entity count changes (unlock, manual add,
    // import) — an upgrade/repriorization/new catalog delivery should make
    // the frosted-glass count shrink without needing a page reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.org.id, db.entities.length]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? 'null');
      // The removed 'ready' key may still be sitting in an old visitor's
      // localStorage — ignore it and fall back to the default rather than
      // sorting by a column that no longer exists.
      if (saved?.key && (SORT_KEYS as string[]).includes(saved.key)) {
        setSortKey(saved.key); setSortDir(saved.dir === 'desc' ? 'desc' : 'asc');
      }
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
    if (wave.length) list = list.filter((e) => wave.includes(String(e.wave)));
    if (status.length) list = list.filter((e) => status.includes(e.status));
    if (sectors.length) list = list.filter((e) => e.sectors.some((s) => sectors.includes(s)));
    if (country) list = list.filter((e) => e.hq_country === country);
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => cmp(sortValue(db, sortKey, a), sortValue(db, sortKey, b)) * dir
      || (a.wave ?? 9) - (b.wave ?? 9) || (fitOrder[a.fit_score ?? 'low'] - fitOrder[b.fit_score ?? 'low']));
    return list;
  }, [db, q, wave, status, sectors, country, sortKey, sortDir]);

  const countries = Array.from(new Set(db.entities.map((e) => e.hq_country).filter(Boolean))) as string[];
  const sectorOptions = Array.from(new Set(db.entities.flatMap((e) => e.sectors))).sort();
  const personCandidates = db.entities.filter((e) => isPersonCandidate(db, e));
  const noEntities = db.entities.length === 0;
  const noneClassified = !noEntities && db.entities.every((e) => e.wave == null);

  // Top-of-page summary — counts + up to 6 most-recently-updated relationships.
  // "In talks" is in_conversation's display label here specifically (matches
  // the landing page's own wording for this summary); the raw status value
  // and its label everywhere else in the app (StatusPill etc.) are untouched.
  const contactedCount = db.entities.filter((e) => e.status === 'contacted').length;
  const inTalksCount = db.entities.filter((e) => e.status === 'in_conversation').length;
  const diligenceCount = db.entities.filter((e) => e.status === 'diligence').length;
  const updateCards = db.entities
    .map((e) => ({ entity: e, tag: lastUpdateTag(db, e), latest: db.interactions.filter((i) => i.entity_id === e.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0] }))
    .filter((r) => r.tag)
    .sort((a, b) => (b.latest?.occurred_at ?? '').localeCompare(a.latest?.occurred_at ?? ''))
    .slice(0, 6);

  // Prompt 126 F — the real bug this fixes: db.entities starts empty until
  // the store's initial load resolves, and `noEntities` couldn't tell that
  // apart from a genuinely empty org — a ~100-entity org briefly rendered
  // "No investors in the pipeline yet" on every real-mode page load. Checked
  // BEFORE noEntities, never instead of it: an org that's actually empty
  // once loading finishes still gets the real empty state below.
  if (loading) {
    return <LoadingState label="Loading your pipeline…" />;
  }

  if (noEntities) {
    return (
      <div className="space-y-4">
        <MatchDealVisibilityBanner />
        <PipelineUnlockBadge unlock={unlock} />
        <EmptyCompanyBlock variant="screen" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* P131-A — the banner already existed (Dashboard only, addenda to
          Prompt 120); the founder-facing gap was that Pipeline — the page
          this whole "why can't investors see us" mystery is actually about —
          never had it. Same component, same /api/company/visibility source,
          no new logic. */}
      <MatchDealVisibilityBanner />
      <PageTour pageKey="guide_pipeline" />
      <PipelineUnlockBadge unlock={unlock} />
      {noneClassified && <EmptyCompanyBlock variant="banner" />}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Contacted</span>
            <span className="text-lg font-bold text-gray-800">{contactedCount}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">In talks</span>
            <span className="text-lg font-bold text-[#0E7490]">{inTalksCount}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Diligence</span>
            <span className="text-lg font-bold text-amber-600">{diligenceCount}</span>
          </div>
        </div>
        {updateCards.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
            {updateCards.map(({ entity, tag }) => (
              <Link key={entity.id} href={`/entities/${entity.id}`}
                className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 transition hover:border-[#0E7490] hover:bg-[#E8F4F8]">
                <div className="truncate text-sm font-medium text-gray-800">{entity.name}</div>
                <div className="mt-0.5 truncate text-xs text-gray-500">{tag}</div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <ReawakeningQueue />
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
        <MultiSelectFilter label="Wave" selected={wave} onChange={setWave}
          options={[1, 2, 3].map((w) => ({ value: String(w), label: `Wave ${w}` }))} />
        <div data-tour-id="pipeline-filters">
          <MultiSelectFilter label="Status" selected={status} onChange={setStatus}
            options={['not_contacted', 'contacted', 'in_conversation', 'diligence', 'passed', 'invested', 'dormant']
              .map((s) => ({ value: s, label: statusLabel[s as keyof typeof statusLabel] }))} />
        </div>
        <MultiSelectFilter label="Sectors" selected={sectors} onChange={setSectors}
          options={sectorOptions.map((s) => ({ value: s, label: s }))} />
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">All countries</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {(q || wave.length > 0 || status.length > 0 || sectors.length > 0 || country) && (
          <button onClick={() => { setQ(''); setWave([]); setStatus([]); setSectors([]); setCountry(''); }} className="text-sm text-gray-500 hover:underline">Clear</button>
        )}
        <span className="ml-auto text-xs text-gray-400">{rows.length} entities</span>
        <button data-tour-id="pipeline-import" onClick={() => setAddInvestorOpen(true)} className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm text-[#0E7490] hover:bg-[#E8F4F8]">+ Add investor</button>
      </div>

      {/* Prompt 188 §1 — own vertical scroll capped at ~15 rows so the
          list doesn't grow the whole page; max-height (not a hard height)
          so a short pipeline still shrinks to fit instead of leaving dead
          white space below it — "altura fixa" read literally would do
          that for every org with fewer than 15 unlocked investors, which
          is most of them today, so this reads the requirement as "cap at
          15, don't force it" rather than the literal words. */}
      {/* Prompt 192 — corrects 188 §2: the blocked-panel used to live
          inside THIS scroll container, after </table>, so it only became
          visible once the user scrolled the 15-row list all the way down.
          Split back into two sibling divs (blockedCount > 0 below) — this
          one keeps its own scroll and, when a panel follows, only rounds
          its TOP corners and drops its bottom border so the two read as
          one continuous shape with no seam. */}
      <div data-tour-id="pipeline-list"
        className={`overflow-x-auto overflow-y-auto border border-gray-100 bg-white shadow-sm ${blockedCount > 0 ? 'rounded-t-2xl border-b-0' : 'rounded-2xl'}`}
        style={{ maxHeight: PIPELINE_LIST_MAX_HEIGHT_PX }}>
        {/* table-fixed + explicit column widths (colgroup) so the table
            holds to the container's width at every wave filter setting
            instead of growing with content and forcing horizontal scroll;
            cells wrap (see td classes) rather than truncate. */}
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {SORT_COLUMNS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              {SORT_COLUMNS.map((c) => {
                const headerButton = (
                  <Tooltip text={`Sort by ${c.label.toLowerCase()}.`} side="bottom">
                    <button onClick={() => toggleSort(c.key)}
                      className={`flex items-center gap-1 font-medium uppercase tracking-wide hover:text-gray-700 ${sortKey === c.key ? 'text-[#0E7490]' : ''}`}>
                      {c.label} {sortKey === c.key && <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  </Tooltip>
                );
                return (
                  <th key={c.key} className="px-3 py-2">
                    {c.key === 'wave' ? <CoachMark itemKey="waves">{headerButton}</CoachMark> : headerButton}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const task = nextAction(db, e);
              const overdue = task?.due_at && new Date(task.due_at) < new Date();
              const hf = e.hard_filter_status === 'open';
              const suspended = suspendedEntityIds.has(e.id);
              return (
                <tr key={e.id}
                  className={`border-b border-gray-100 align-top hover:bg-[#E8F4F8]/60 ${e.status === 'dormant' || suspended ? 'opacity-50' : ''} ${hf ? 'border-l-2 border-l-[#B00000]' : ''}`}>
                  <td className="break-words px-3 py-2 font-medium">
                    <Link href={`/entities/${e.id}`} className="text-gray-900 hover:text-[#0E7490]">
                      {e.name} {hf && <span title={e.hard_filter} className="text-[#B00000]">⚑</span>}
                    </Link>
                    {suspended && (
                      <span className="ml-1.5 inline-block rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600" title="This investor has suspended their own visibility — not accepting contact right now. Existing access is unaffected.">
                        Suspended
                      </span>
                    )}
                    {/* Prompt 73 — a mutual MatchDeal match is a materially
                        different, hotter provenance than a manual add or a
                        catalog unlock (both sides already showed direct
                        interest) — worth surfacing at a glance, not buried
                        one click away on the entity page. */}
                    {e.source === 'match_deal' && (
                      <span className="ml-1.5 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700" title="This entity came from a mutual MatchDeal match.">
                        🤝 MatchDeal
                      </span>
                    )}
                    {/* §1c(ii) prompt 42 — a stub with no proof of its own
                        existence reads as an incomplete real profile
                        (blank fields with dashes) unless flagged explicitly. */}
                    {isUnverifiedStub(e) && (
                      <span className="ml-1.5 inline-block rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title="No independent proof this entity exists yet — website, domain, phone, address, or a source specific to it.">
                        not yet verified
                      </span>
                    )}
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
                  <td className="break-words px-3 py-2 text-gray-500">{e.type.replace('_', ' ')}</td>
                  <td className="break-words px-3 py-2 text-gray-500">{e.hq_city ? `${e.hq_city}, ` : ''}{e.hq_country}</td>
                  <td className="break-words px-3 py-2 text-gray-500">{fmtEur(e.check_min_eur)}–{fmtEur(e.check_max_eur)}</td>
                  <td className="px-3 py-2">
                    {e.sectors.slice(0, 2).map((s) => (
                      <span key={s} className="mb-1 mr-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{s}</span>
                    ))}
                    {e.sectors.length > 2 && <span className="text-[11px] text-gray-400">+{e.sectors.length - 2}</span>}
                  </td>
                  <td className="px-3 py-2"><FitTag fit={e.fit_score} /></td>
                  <td className="px-3 py-2"><WaveTag wave={e.wave} /></td>
                  <td className="px-3 py-2"><StatusPill status={e.status} /></td>
                  <td className="break-words px-3 py-2">
                    {task ? (
                      <span className="text-xs">
                        <span className="text-gray-700">{task.title}</span>
                        {task.due_at && <span className={overdue ? 'ml-1 font-semibold text-[#B00000]' : 'ml-1 text-gray-400'}>
                          · {task.due_at.slice(5, 10)}
                        </span>}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Blocked-by-plan panel — Prompt 192 (corrects 188 §2, which put
          this inside the scroll container above, so it only appeared after
          scrolling to the end of the list). Now a sibling div, flush
          against the table container (no margin-top, no border-t, only
          bottom corners rounded) so it reads as one continuous block that's
          ALWAYS visible below the 15 rows regardless of the table's own
          scroll position.

          Real frosted glass, per 192 §2: LockedWave's pattern
          (investor-workspace/PipelinePanel.tsx) copied over — aria-hidden
          skeleton rows sitting behind an absolute inset-0 bg-white/55
          backdrop-blur-sm overlay, instead of just a translucent box with
          text (which produced no actual blur before, since there was
          nothing behind it to blur). The skeleton rows are pure shape —
          bars imitating this table's own columns — never real data: the
          blocked entities themselves are never fetched (still just
          blockedCount, the catalog_blocked_count RPC), so there's nothing
          real to draw and nothing real to hide.

          Prompt 179 §C, updated by 180 and 188 — two distinct messages.
          Whether an upgrade CTA makes sense depends on whether this org's
          accumulated catalog_quota has already reached the target the
          pipeline-unlock formula currently computes for it (unlock.
          catalogQuotaTarget — same base+bonuses formula as the badge
          above, uncapped; CATALOG_QUOTA/plans.ts, the old fixed 3/15/40
          constant this used to compare against, is retired — see
          plans.ts's own header): below it, catalog_quota just hasn't
          caught up to its own live target yet (the next poll of
          /api/pipeline-unlock raises it) — no reason to push an upgrade.
          At or above it (atTarget), §188 §3 replaces the old exact-count
          "N blocked" copy with a vaguer one and gates the upgrade CTA on
          db.org.plan — NOT on getInvestorPlan/INVESTOR_PLANS/
          legendary_sleuth as the prompt's text names them: that function
          doesn't exist anywhere in this codebase (confirmed by grep), and
          INVESTOR_PLANS/pro_scout/ace_spotter/legendary_sleuth is the
          unrelated taxonomy for what INVESTORS themselves buy (Pro
          Scout/Ace Spotter/The Legendary Sleuth SaaS seats — see
          plans.ts's own INVESTOR_PLANS block). This page is the
          FOUNDER's pipeline, gated by the founder's own org.plan
          (idea/garage/motherfunding — PLAN_TIERS, same tier the
          pipeline-unlock formula above already keys off), so
          'motherfunding' is this page's actual max tier. Flagging this
          as a deviation from the prompt's literal wording rather than
          inventing a new lookup or importing an unrelated one. */}
      {blockedCount > 0 && (() => {
        const target = unlock?.catalogQuotaTarget ?? 0;
        const atTarget = (db.org.catalog_quota ?? 0) >= target;
        const onMaxPlan = db.org.plan === 'motherfunding';
        return (
          <div className="relative overflow-hidden rounded-b-2xl border border-t-0 border-gray-100 bg-white shadow-sm">
            <div aria-hidden className="divide-y divide-gray-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-3 py-3">
                  <div className="h-3 w-[22%] rounded bg-gray-100" />
                  <div className="h-3 w-[8%] rounded bg-gray-100" />
                  <div className="h-3 w-[10%] rounded bg-gray-100" />
                  <div className="h-3 w-[10%] rounded bg-gray-100" />
                  <div className="h-3 w-[14%] rounded bg-gray-100" />
                  <div className="h-3 w-[7%] rounded bg-gray-100" />
                  <div className="h-3 w-[6%] rounded bg-gray-100" />
                  <div className="h-3 w-[10%] rounded bg-gray-100" />
                </div>
              ))}
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white/55 px-6 text-center backdrop-blur-sm">
              <div className="text-2xl">🔒</div>
              {atTarget ? (
                <>
                  <p className="mt-1 text-sm font-medium text-gray-700">Thousands of investors are waiting in the catalog.</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Your next monthly batch unlocks automatically{onMaxPlan ? '.' : ' — or upgrade your plan to unlock more now.'}
                  </p>
                  {!onMaxPlan && (
                    <Link href="/plans" className="mt-3 inline-block rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b]">
                      View plans
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm font-medium text-gray-700">New matching investors are delivered automatically.</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Next batch arrives {nextMonthlyDeliveryDate(new Date().toISOString()).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.
                  </p>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {addInvestorOpen && <AddInvestorModal onClose={() => setAddInvestorOpen(false)} />}

      {/* TEMP — git→deploy pipeline test marker, remove after confirmed in production */}
      <div style={{ position: 'fixed', bottom: 16, right: 16, width: 24, height: 24, borderRadius: '9999px', background: 'red', zIndex: 9999 }} />
    </div>
  );
}
