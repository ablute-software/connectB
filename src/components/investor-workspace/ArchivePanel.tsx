'use client';
// Investor Workspace Archive (prompt 60) — "then vs now" board. A passed
// startup isn't gone, it's deal flow with a reason and a reopen path.
import { useEffect, useState } from 'react';

interface SnapshotView {
  data: { one_liner: string | null; description: string | null; stage: string | null; round_target_eur: number | null; round_instruments: string[]; traction: { label: string; value: string }[] };
  capturedAt: string;
}
interface ArchiveEntry {
  id: string; orgId: string; orgName: string; source: string; reasonDetail: string | null; archivedAt: string;
  restricted?: boolean;
  // Prompt 556 §C — the org itself was closed (its last member deleted).
  // Arrives alongside restricted: true, and takes precedence over it in the
  // copy below: the investor's own decision is not why there is nothing to
  // show here.
  unavailable?: boolean;
  firstContact: SnapshotView | null; lastContact: SnapshotView | null;
  now: { text: string; generatedAt: string } | null;
  badges: { raisedSinceYouPassed: boolean; newRoundOpen: boolean; nowMatchesThesis: boolean; trending: boolean } | null;
}

const REASON_LABELS: Record<string, string> = { ticket_too_small: 'Ticket too small', outside_thesis: 'Outside thesis', too_early: 'Too early', other: 'Other' };
const BADGE_LABELS: { key: keyof NonNullable<ArchiveEntry['badges']>; label: string }[] = [
  { key: 'raisedSinceYouPassed', label: 'Raised since you passed' },
  { key: 'newRoundOpen', label: 'New round open' },
  { key: 'nowMatchesThesis', label: 'Now matches your thesis' },
  { key: 'trending', label: 'Trending' },
];

function columnSummary(s: SnapshotView | null): string {
  if (!s) return '—';
  const d = s.data;
  const parts = [
    d.one_liner || d.description,
    d.stage,
    d.round_target_eur ? `raising €${d.round_target_eur.toLocaleString()}` : null,
    d.traction?.[0] ? `${d.traction[0].label} ${d.traction[0].value}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No details on file at this point.';
}

export function ArchivePanel() {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [usualCoInvestors, setUsualCoInvestors] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch('/api/portal/archive').then((r) => r.json()).then((d) => {
      setEntries(d.entries ?? []);
      setUsualCoInvestors(d.usualCoInvestors ?? null);
    });
  }
  useEffect(load, []);

  async function reopen(entryId: string) {
    setBusyId(entryId);
    try {
      await fetch('/api/portal/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entryId }) });
      load();
    } finally { setBusyId(null); }
  }

  if (!entries) return <p className="text-sm text-gray-400">Loading…</p>;
  if (entries.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">Nothing archived — startups you pass on land here, with full history and a way back in.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Archive</h1>
        <a href="/api/portal/export?type=archive" className="text-xs text-gray-400 hover:underline">Export CSV</a>
      </div>
      {usualCoInvestors && <p className="text-xs text-gray-400">Usually co-invests with: {usualCoInvestors}</p>}
      {entries.map((e) => {
        const activeBadges = e.badges ? BADGE_LABELS.filter((b) => e.badges![b.key]) : [];
        return (
          <div key={e.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{e.orgName}</div>
                <div className="text-xs text-gray-400">
                  {/* Prompt 214 §A.3 — "Archived by you" e nao so "Archived".
                      A ablute_ estava arquivada desde 5 Ago pelo proprio
                      investidor, mas ao ver "Archived" ao lado de um pass
                      feito noutra startup no mesmo dia, pareceu efeito
                      colateral. A origem tem de estar no cartao. */}
                  {e.source === 'pass' ? 'Passed'
                    : e.source === 'round_closed' ? 'Round closed'
                    : 'Archived by you'}
                  {e.reasonDetail && ` — ${REASON_LABELS[e.reasonDetail] ?? e.reasonDetail}`}
                  {' · '}{new Date(e.archivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
              {!e.restricted && !e.unavailable && (
                <button onClick={() => reopen(e.id)} disabled={busyId === e.id}
                  className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490] disabled:opacity-40">
                  {busyId === e.id ? 'Reopening…' : 'Reopen'}
                </button>
              )}
            </div>

            {e.unavailable ? (
              // Prompt 556 §C — one line, the same sentence the Pipeline
              // row uses. Checked before `restricted` on purpose: both are
              // true for a closed org that was also passed on, and "the
              // startup is gone" is the accurate reason, not "you decided".
              <p className="mt-2 text-xs text-gray-400">This startup is no longer available</p>
            ) : e.restricted ? (
              // AP-10 — a final Pass decision restricts the investor's own
              // view back down to name/reason/tag; the diligence history
              // (then/now, badges) is no longer shown here.
              <p className="mt-2 text-xs text-gray-400">Decision recorded — this relationship is closed and can&apos;t be reopened.</p>
            ) : (
              <>
                {activeBadges.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeBadges.map((b) => (
                      <span key={b.key} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{b.label}</span>
                    ))}
                  </div>
                )}

                <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-gray-400">First contact</div>
                    <p className="text-gray-600">{columnSummary(e.firstContact)}</p>
                  </div>
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-gray-400">Last contact</div>
                    <p className="text-gray-600">{columnSummary(e.lastContact)}</p>
                  </div>
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-[#0E7490]">Now</div>
                    <p className="text-gray-600">{e.now ? e.now.text : 'Not regenerated yet — will update on the founder\'s next round/profile edit.'}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
