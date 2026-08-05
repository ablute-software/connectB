'use client';
// Investor Workspace Pipeline (prompt 58) — startups presented in waves by
// match score. Mirrors the founder-side pipeline's doseamento principle:
// only the current wave is actionable, the rest stay locked until it's
// fully treated (every card passed or expressed interest on).
import { Fragment, useEffect, useState } from 'react';
import { OwnershipCalculator } from './OwnershipCalculator';
import { ComparisonView } from './ComparisonView';

const MAX_COMPARE = 3;

interface Card {
  orgId: string; name: string; oneLiner: string | null; sectors: string[]; stage: string | null;
  hqCity: string | null; country: string | null; roundTargetEur: number | null; roundValuationEur: number | null;
  roundValuationBasis?: 'pre_money' | 'post_money' | null; roundInstruments: string[];
  matchScore: number; matchReasons: string[]; status: 'open' | 'passed' | 'interested'; passReason: string | null;
  trackingCount: number; hasDataRoomAccess: boolean;
}
interface Wave { index: number; items: Card[]; unlocked: boolean }
interface PipelineResponse { linked: boolean; waves?: Wave[]; usualCoInvestors?: string | null }

const REASON_MAX_LEN = 1000;
const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };
const STATUS_FILTERS: { value: 'all' | 'open' | 'interested' | 'passed'; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'open', label: 'No decision' }, { value: 'interested', label: 'Interested' }, { value: 'passed', label: 'Passed' },
];

function fmtEur(n: number | null) {
  return n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

export function PipelinePanel({ onOpenStartup }: { onOpenStartup: (orgId: string) => void }) {
  const [data, setData] = useState<PipelineResponse | null>(null);
  // AP-07/08 — confirming holds the card + action awaiting Cancel/Confirm;
  // reasonDraft is the free-text Pass reason (AP-08: required, not a fixed
  // category list). Cancel/close must change nothing — it only clears this
  // local state, no request is ever sent.
  const [confirming, setConfirming] = useState<{ orgId: string; action: 'pass' | 'interest' } | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);
  const [remindedOrgId, setRemindedOrgId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'interested' | 'passed'>('all');
  // Prompt 121 §2.3 — sector/geography/stage filters, composed with the
  // existing status filter and the wave doseamento: filtering only decides
  // which cards render WITHIN an already-unlocked (or already-locked) wave,
  // it never changes wave.unlocked itself — see passesFilter below, which
  // stays the single gate the wave.items.filter(...) call already used.
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  // Prompt 127 Bloco B — the overview strip's one stat that isn't in
  // /api/portal/pipeline's own response (Tracking/Interested/Data room all
  // are). Meetings live in the Agenda's merged timeline instead (see
  // /api/portal/agenda), so this is a second, once-on-mount fetch rather
  // than pipeline reload traffic.
  const [meetingsCount, setMeetingsCount] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/portal/agenda').then((r) => r.json())
      .then((d) => setMeetingsCount((d.items ?? []).filter((i: { kind: string }) => i.kind === 'meeting').length))
      .catch(() => setMeetingsCount(null));
  }, []);

  function toggleCompare(orgId: string) {
    setCompareIds((ids) => (ids.includes(orgId) ? ids.filter((id) => id !== orgId) : ids.length < MAX_COMPARE ? [...ids, orgId] : ids));
  }

  function load() {
    fetch('/api/portal/pipeline').then((r) => r.json()).then(setData);
  }
  useEffect(load, []);

  function startConfirm(orgId: string, action: 'pass' | 'interest') {
    setActionError(null);
    setReasonDraft('');
    setConfirming({ orgId, action });
  }
  function cancelConfirm() {
    // Deliberately a pure local reset — no fetch, nothing written.
    setConfirming(null);
    setReasonDraft('');
  }

  async function act(orgId: string, action: 'pass' | 'interest', reason?: string) {
    setBusyOrgId(orgId);
    setActionError(null);
    try {
      const res = await fetch('/api/portal/pipeline', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, action, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        // AP-14 — a teammate may have decided first; surface it plainly and
        // reload so this card reflects the actual (org-level) outcome.
        setActionError(body.error ?? 'Something went wrong — please try again.');
      } else {
        setConfirming(null);
        setReasonDraft('');
      }
      load();
    } finally { setBusyOrgId(null); }
  }

  // Agenda (prompt 59) — "remind me in 2 weeks" straight from a Pipeline
  // card. No custom date picker for v1: two weeks is the one duration the
  // prompt names explicitly, and it's the common "circle back later" gap.
  async function remindIn2Weeks(orgId: string) {
    const remindAt = new Date(Date.now() + 14 * 86400000).toISOString();
    await fetch('/api/portal/agenda', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId, remindAt }),
    });
    setRemindedOrgId(orgId);
  }

  // Archive (prompt 60) — manual archive, distinct from a pass: the
  // investor sets it aside without recording a "why not" swipe reason.
  async function archiveManually(orgId: string) {
    setBusyOrgId(orgId);
    try {
      await fetch('/api/portal/archive', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archiveOrgId: orgId }),
      });
      load();
    } finally { setBusyOrgId(null); }
  }

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const waves = data.waves ?? [];
  const firstUnlocked = waves.find((w) => w.unlocked);

  if (waves.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">More startups joining — you&apos;ll be notified when a new match arrives.</p>
      </div>
    );
  }

  const allCards = waves.flatMap((w) => w.items);
  const compareCards = compareIds.map((id) => allCards.find((c) => c.orgId === id)).filter((c): c is Card => !!c);
  // Prompt 121 §2.3 — option lists built from whatever's actually in the
  // Pipeline right now (not a fixed taxonomy import): org.sectors is free
  // text on the founder side (see investor-sector-taxonomy.ts's own
  // comment), so a filter sourced from a canonical list could easily show
  // options nothing ever matches. This way every option is guaranteed live.
  const sectorOptions = [...new Set(allCards.flatMap((c) => c.sectors))].sort((a, b) => a.localeCompare(b));
  const countryOptions = [...new Set(allCards.map((c) => c.country).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
  const stageOptions = [...new Set(allCards.map((c) => c.stage).filter((v): v is string => !!v))];
  // AP-13 — "All" keeps Prompt 60's existing behaviour (passed cards live
  // in Archive, not duplicated here); "Passed" is the one filter that
  // deliberately surfaces them back in this view anyway.
  function passesFilter(c: Card) {
    if (statusFilter === 'all' ? c.status === 'passed' : c.status !== statusFilter) return false;
    if (sectorFilter !== 'all' && !c.sectors.includes(sectorFilter)) return false;
    if (countryFilter !== 'all' && c.country !== countryFilter) return false;
    if (stageFilter !== 'all' && c.stage !== stageFilter) return false;
    return true;
  }

  // Prompt 127 Bloco B — the "home" the investor workspace was missing: an
  // at-a-glance overview strip above the wave list, same idea as the
  // founder Dashboard's own funnel (OverviewPanel.tsx) — not a new number to
  // invent, client-side aggregation over data already loaded for this page
  // (allCards) plus the one Agenda-sourced count (meetings). Not a strict
  // funnel (these four aren't subsets of each other the way contacted →
  // replied → … is), so no "% of previous" column — just the Prompt 126-A
  // fix itself (a shared CSS grid column template, not flexbox, so the bar
  // column is the same pixel width on every row regardless of what else
  // that row shows) carried over to keep the same visual language.
  const overviewStats = [
    { label: 'Tracking', n: allCards.filter((c) => c.status === 'open').length },
    { label: 'Interested', n: allCards.filter((c) => c.status === 'interested').length },
    { label: 'Data room open', n: allCards.filter((c) => c.hasDataRoomAccess).length },
    { label: 'Meetings', n: meetingsCount ?? 0 },
  ];
  const overviewMax = Math.max(1, ...overviewStats.map((s) => s.n));

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Pipeline</h1>
        <a href="/api/portal/export?type=pipeline" className="text-xs text-gray-400 hover:underline">Export CSV</a>
      </div>
      <div data-tour-id="investor-pipeline-overview" className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="grid items-center gap-x-2 gap-y-1.5 text-sm" style={{ gridTemplateColumns: '7rem 1fr 2.5rem' }}>
          {overviewStats.map((s) => (
            <Fragment key={s.label}>
              <span className="text-xs text-gray-500">{s.label}</span>
              <div className="h-4 rounded bg-[#0E7490]/80" style={{ width: `${Math.max(4, s.n / overviewMax * 100)}%` }} />
              <span className="text-right text-xs font-medium">{s.n}</span>
            </Fragment>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button key={f.value} onClick={() => setStatusFilter(f.value)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusFilter === f.value ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {f.label}
          </button>
        ))}
      </div>
      {/* Prompt 121 §2.3 — sector/geography/stage filters. Composed with the
          status filter and the wave doseamento above (passesFilter), never
          bypassing it: a locked wave stays locked no matter what these
          narrow it down to. */}
      <div data-tour-id="investor-pipeline-filters" className="flex flex-wrap items-center gap-1.5">
        <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)}
          className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600">
          <option value="all">All sectors</option>
          {sectorOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}
          className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600">
          <option value="all">All geographies</option>
          {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600">
          <option value="all">All stages</option>
          {stageOptions.map((s) => <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>)}
        </select>
        {(sectorFilter !== 'all' || countryFilter !== 'all' || stageFilter !== 'all') && (
          <button onClick={() => { setSectorFilter('all'); setCountryFilter('all'); setStageFilter('all'); }}
            className="text-[11px] text-gray-400 hover:underline">
            Clear filters
          </button>
        )}
      </div>
      {data.usualCoInvestors && <p className="text-xs text-gray-400">Usually co-invests with: {data.usualCoInvestors}</p>}
      {actionError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]">{actionError}</p>}

      {/* Prompt 127 §3 — before this, the only hint that comparison existed
          at all was the per-card checkbox itself, with zero invitation to
          use it; a visible entry point even at zero-selected fixes that.
          Once a card is ticked, this same slot becomes the existing
          "N selected / Compare" banner — one discovery surface, not two. */}
      {!showComparison && (compareIds.length > 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-[#0E7490] bg-[#E8F4F8] px-3 py-2 text-xs">
          <span>{compareIds.length} selected to compare</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setCompareIds([])} className="text-gray-500 hover:underline">Clear</button>
            <button onClick={() => setShowComparison(true)} disabled={compareIds.length < 2}
              className="rounded-lg bg-[#0E7490] px-2.5 py-1 font-medium text-white disabled:opacity-40">
              Compare
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-2 text-xs text-gray-500">
          💡 Compare up to {MAX_COMPARE} startups side-by-side — tick the checkbox on any card below to get started.
        </div>
      ))}
      {showComparison && compareCards.length >= 2 && (
        <ComparisonView cards={compareCards} onClose={() => setShowComparison(false)} />
      )}

      <div data-tour-id="investor-pipeline-list" className="space-y-4">
      {waves.map((wave) => (
        <div key={wave.index} className={wave.unlocked ? '' : 'opacity-50'}>
          {waves.length > 1 && (
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              Wave {wave.index + 1}{!wave.unlocked && ' — locked until the wave above is treated'}
            </p>
          )}
          <div className="space-y-3">
            {/* Prompt 60 — a passed card moves to the Archive tab, not just
                grayed out here; still counted server-side toward this
                wave's unlock (see the API route), just not duplicated in
                both places. AP-13's "Passed" filter is the one exception
                that brings them back into view. */}
            {wave.items.filter(passesFilter).map((c) => (
              <div key={c.orgId} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={compareIds.includes(c.orgId)} onChange={() => toggleCompare(c.orgId)}
                      disabled={!compareIds.includes(c.orgId) && compareIds.length >= MAX_COMPARE}
                      className="mt-1" title="Select to compare" />
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{c.name}</div>
                      {c.oneLiner && <div className="text-xs text-gray-500">{c.oneLiner}</div>}
                      <div className="mt-1 text-xs text-gray-400">
                        {c.stage && (STAGE_LABELS[c.stage] ?? c.stage)}
                        {c.sectors.length > 0 && ` · ${c.sectors.join(', ')}`}
                        {fmtEur(c.roundTargetEur) && ` · raising ${fmtEur(c.roundTargetEur)}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {/* Bloco 3 — a per-card chip, not just the section header
                        above (which only renders when there's more than one
                        wave, i.e. never yet in practice with a single
                        startup in the network) — Today already says "1 new
                        match in your Wave 1", this is that same number made
                        visible on the card itself. */}
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500" title={`Wave ${wave.index + 1}`}>
                      W{wave.index + 1}
                    </span>
                    <div className="rounded-full bg-[#E8F4F8] px-2.5 py-1 text-xs font-semibold text-[#0E7490]">
                      {c.matchScore}% match{c.matchReasons.length > 0 && ` — ${c.matchReasons.join(', ')}`}
                    </div>
                  </div>
                </div>

                {c.trackingCount > 0 && (
                  <p className="mt-1.5 text-xs text-gray-400">
                    {c.trackingCount} other investor{c.trackingCount === 1 ? ' is' : 's are'} tracking {c.stage ? (STAGE_LABELS[c.stage] ?? c.stage) : 'this stage'} rounds
                  </p>
                )}

                <OwnershipCalculator roundValuationEur={c.roundValuationEur} roundTargetEur={c.roundTargetEur} roundValuationBasis={c.roundValuationBasis} />

                {c.status === 'passed' ? (
                  <p className="mt-3 text-xs text-gray-400">
                    Passed{c.passReason && ` — ${c.passReason}`}
                  </p>
                ) : c.status === 'interested' ? (
                  <div className="mt-3 flex items-center gap-2">
                    <p className="text-xs text-[#0E7490] font-medium">Interest expressed</p>
                    <button onClick={() => archiveManually(c.orgId)} disabled={busyOrgId === c.orgId} className="text-xs text-gray-400 hover:underline disabled:opacity-40">
                      Archive
                    </button>
                  </div>
                ) : wave.unlocked && confirming?.orgId === c.orgId ? (
                  // AP-07/08 — a confirmation step before either decision is
                  // recorded; Pass requires a free-text reason (max 1000
                  // chars). Cancel only clears local state, see cancelConfirm.
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    {confirming.action === 'interest' ? (
                      <p className="text-xs text-gray-700">Confirm you&apos;re interested in {c.name}? The founder will be notified.</p>
                    ) : (
                      <>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Reason for passing (required)</label>
                        <textarea value={reasonDraft} onChange={(e) => setReasonDraft(e.target.value.slice(0, REASON_MAX_LEN))}
                          rows={3} placeholder="Why isn't this a fit right now?"
                          className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
                        <p className="mt-0.5 text-[10px] text-gray-400">{reasonDraft.length}/{REASON_MAX_LEN} · This decision is final — the data room will be revoked and it can&apos;t be undone.</p>
                      </>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={cancelConfirm} disabled={busyOrgId === c.orgId}
                        className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-white disabled:opacity-40">
                        Cancel
                      </button>
                      <button
                        onClick={() => act(c.orgId, confirming.action, confirming.action === 'pass' ? reasonDraft : undefined)}
                        disabled={busyOrgId === c.orgId || (confirming.action === 'pass' && reasonDraft.trim().length === 0)}
                        className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                        {busyOrgId === c.orgId ? 'Saving…' : confirming.action === 'interest' ? 'Confirm interest' : 'Confirm pass'}
                      </button>
                    </div>
                  </div>
                ) : wave.unlocked ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {/* P120 Block A — a card without a grant is eligible by
                        published profile alone; the data room stays gated on
                        the founder actually consenting (access_grants). That
                        trust boundary doesn't move — only discovery does. */}
                    {c.hasDataRoomAccess ? (
                      <button onClick={() => onOpenStartup(c.orgId)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
                        Open data room
                      </button>
                    ) : (
                      <span className="rounded-lg border border-dashed border-gray-200 px-2.5 py-1.5 text-xs text-gray-400">
                        🔒 Access to documents is granted by the founder — express interest to start the conversation.
                      </span>
                    )}
                    <button onClick={() => startConfirm(c.orgId, 'interest')} disabled={busyOrgId === c.orgId}
                      className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                      Express interest
                    </button>
                    {remindedOrgId === c.orgId ? (
                      <span className="text-xs text-gray-400">Reminder set for 2 weeks</span>
                    ) : (
                      <button onClick={() => remindIn2Weeks(c.orgId)} className="text-xs text-gray-400 hover:underline">
                        Remind me in 2 weeks
                      </button>
                    )}
                    <button onClick={() => startConfirm(c.orgId, 'pass')} className="text-xs text-gray-400 hover:underline">Pass</button>
                    <button onClick={() => archiveManually(c.orgId)} disabled={busyOrgId === c.orgId} className="text-xs text-gray-400 hover:underline disabled:opacity-40">
                      Archive
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
      </div>
      {!firstUnlocked && <p className="text-xs text-gray-400">All caught up — check back as new matches arrive.</p>}
    </div>
  );
}
