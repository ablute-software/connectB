'use client';
// Investor Workspace Pipeline (prompt 58) — startups presented in waves by
// match score. Mirrors the founder-side pipeline's doseamento principle:
// only the current wave is actionable, the rest stay locked until it's
// fully treated (every card passed or expressed interest on).
import { useEffect, useState } from 'react';
import { OwnershipCalculator } from './OwnershipCalculator';
import { ComparisonView } from './ComparisonView';

const MAX_COMPARE = 3;

interface Card {
  orgId: string; name: string; oneLiner: string | null; sectors: string[]; stage: string | null;
  hqCity: string | null; country: string | null; roundTargetEur: number | null; roundValuationEur: number | null; roundInstruments: string[];
  matchScore: number; matchReasons: string[]; status: 'open' | 'passed' | 'interested'; passReason: string | null;
  trackingCount: number;
}
interface Wave { index: number; items: Card[]; unlocked: boolean }
interface PipelineResponse { linked: boolean; waves?: Wave[]; usualCoInvestors?: string | null }

const PASS_REASONS: { value: string; label: string }[] = [
  { value: 'ticket_too_small', label: 'Ticket too small' },
  { value: 'outside_thesis', label: 'Outside thesis' },
  { value: 'too_early', label: 'Too early' },
  { value: 'other', label: 'Other' },
];
const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };

function fmtEur(n: number | null) {
  return n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

// Only ever one real org today, so "open data room" doesn't need to route
// between multiple startup cards yet — see the shell's own comment on
// entityName for the matching limitation. Revisit if/when the catalog
// grows past ablute_.
export function PipelinePanel({ onOpenStartup }: { onOpenStartup: () => void }) {
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [passingOrgId, setPassingOrgId] = useState<string | null>(null);
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);
  const [remindedOrgId, setRemindedOrgId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  function toggleCompare(orgId: string) {
    setCompareIds((ids) => (ids.includes(orgId) ? ids.filter((id) => id !== orgId) : ids.length < MAX_COMPARE ? [...ids, orgId] : ids));
  }

  function load() {
    fetch('/api/portal/pipeline').then((r) => r.json()).then(setData);
  }
  useEffect(load, []);

  async function act(orgId: string, action: 'pass' | 'interest', reason?: string) {
    setBusyOrgId(orgId);
    try {
      await fetch('/api/portal/pipeline', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, action, reason }),
      });
      setPassingOrgId(null);
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

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Pipeline</h1>
        <a href="/api/portal/export?type=pipeline" className="text-xs text-gray-400 hover:underline">Export CSV</a>
      </div>
      {data.usualCoInvestors && <p className="text-xs text-gray-400">Usually co-invests with: {data.usualCoInvestors}</p>}

      {compareIds.length > 0 && !showComparison && (
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
      )}
      {showComparison && compareCards.length >= 2 && (
        <ComparisonView cards={compareCards} onClose={() => setShowComparison(false)} />
      )}

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
                both places. */}
            {wave.items.filter((c) => c.status !== 'passed').map((c) => (
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

                <div className="mt-2">
                  <OwnershipCalculator roundValuationEur={c.roundValuationEur} roundTargetEur={c.roundTargetEur} />
                </div>

                {c.status === 'passed' ? (
                  <p className="mt-3 text-xs text-gray-400">
                    Passed{c.passReason && ` — ${PASS_REASONS.find((r) => r.value === c.passReason)?.label ?? c.passReason}`}
                  </p>
                ) : c.status === 'interested' ? (
                  <div className="mt-3 flex items-center gap-2">
                    <p className="text-xs text-[#0E7490] font-medium">Interest expressed</p>
                    <button onClick={() => archiveManually(c.orgId)} disabled={busyOrgId === c.orgId} className="text-xs text-gray-400 hover:underline disabled:opacity-40">
                      Archive
                    </button>
                  </div>
                ) : wave.unlocked ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button onClick={onOpenStartup} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
                      Open data room
                    </button>
                    <button onClick={() => act(c.orgId, 'interest')} disabled={busyOrgId === c.orgId}
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
                    {passingOrgId === c.orgId ? (
                      <div className="flex items-center gap-1.5">
                        {PASS_REASONS.map((r) => (
                          <button key={r.value} onClick={() => act(c.orgId, 'pass', r.value)} disabled={busyOrgId === c.orgId}
                            className="rounded-full border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                            {r.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button onClick={() => setPassingOrgId(c.orgId)} className="text-xs text-gray-400 hover:underline">Pass</button>
                    )}
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
      {!firstUnlocked && <p className="text-xs text-gray-400">All caught up — check back as new matches arrive.</p>}
    </div>
  );
}
