'use client';
// Prompt 124 §2 (Block A) — MatchDeal's own metrics, the app floor's 6th
// tab. Every counter here already exists in real tables — this is a screen,
// not new instrumentation. Read-only: no touches to the matching engine.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface MatchDealData {
  swipesPerDay: number; likesLastWeek: number; passesLastWeek: number; activeMatches: number;
  activePairings: { startup: number; investor: number };
  weekStart: string | null;
  usageByTier: Record<string, { profiles: number; shown: number; likes: number; reconsiderations: number }>;
}

interface RankRow {
  profileId: string; label: string; activeMinutes: number; standbyMinutes: number;
  accessesPerDay: number; sessionCount: number; hourlyHistogram: number[];
}
interface UsageRankingData { windowDays: number; byKind: { startup: RankRow[]; investor: RankRow[] }; hourlyHistogram: number[] }

interface AffinityRow {
  viewerProfileId: string; viewerKind?: 'startup' | 'investor'; viewerLabel: string; sampleSize: number;
  overallAvgDecisionSeconds: number; overallLikeRatePct: number;
  topPattern: {
    type: 'sector' | 'stage'; value: string; sampleSize: number;
    avgDecisionSeconds: number; likeRatePct: number;
    elsewhereAvgDecisionSeconds: number; elsewhereLikeRatePct: number;
  } | null;
}
interface AffinityData { minSample: number; rows: AffinityRow[] }

const TIER_LABEL: Record<string, string> = { tier_a: 'Tier A (Elementary)', tier_b: 'Tier B (List of Suspects)', tier_c: 'Tier C (Butler)', unknown: 'Unknown tier' };

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}min`;
}

function HourlyHistogram({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  return (
    <div className="flex h-12 items-end gap-0.5">
      {hours.map((v, h) => (
        <div key={h} title={`${h}:00 — ${v}`} className="w-2 flex-1 rounded-t bg-[#0E7490]" style={{ height: `${Math.max(2, (v / max) * 100)}%`, opacity: v > 0 ? 1 : 0.15 }} />
      ))}
    </div>
  );
}

// Prompt 546 — hoisted out of UsageRankingSection. Declaring a component in
// another component's body gives it a new identity on every render, which
// React treats as a different type and remounts rather than re-renders;
// here that threw away the expanded row's DOM on every unrelated state
// change. Same fix as the Vault trees, found by the lint rule that prompt
// turned on.
function RankTable({ rows, expandedId, setExpandedId }: {
  rows: RankRow[]; expandedId: string | null; setExpandedId: (id: string | null) => void;
}) {
  if (rows.length === 0) return <p className="text-sm text-gray-400">No usage recorded in this window yet.</p>;
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.profileId} className="rounded-lg border border-gray-50 p-2">
          <button onClick={() => setExpandedId(expandedId === r.profileId ? null : r.profileId)} className="flex w-full items-center justify-between text-left text-sm">
            <span className="font-semibold text-gray-900">{r.label}</span>
            <span className="flex gap-3 text-xs text-gray-500">
              <span>{r.activeMinutes}min active</span>
              <span className="text-gray-300">·</span>
              <span>{r.standbyMinutes}min standby</span>
              <span className="text-gray-300">·</span>
              <span>{r.accessesPerDay}/day</span>
            </span>
          </button>
          {expandedId === r.profileId && (
            <div className="mt-2 border-t border-gray-50 pt-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">Usual hours of access (UTC)</p>
              <HourlyHistogram hours={r.hourlyHistogram} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function UsageRankingSection() {
  const [data, setData] = useState<UsageRankingData | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backoffice/metrics/matchdeal/usage-ranking').then((r) => r.json()).then((body) => { if (body.ok) setData(body); });
  }, []);

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <Card title={`MatchDeal usage ranking — last ${data.windowDays} days`}>
      <p className="mb-3 text-xs text-gray-400">
        Active and standby minutes are kept separate, never summed. Hours-of-access below is aggregated across all
        participants (UTC) — per-person hours appear when a row is expanded.
      </p>
      <div className="mb-4">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">Usual hours of access — all participants (UTC)</p>
        <HourlyHistogram hours={data.hourlyHistogram} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Startups</h3>
          <RankTable rows={data.byKind.startup} expandedId={expandedId} setExpandedId={setExpandedId} />
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Investors</h3>
          <RankTable rows={data.byKind.investor} expandedId={expandedId} setExpandedId={setExpandedId} />
        </div>
      </div>
    </Card>
  );
}

function AffinitySection() {
  const [data, setData] = useState<AffinityData | null>(null);

  useEffect(() => {
    fetch('/api/backoffice/metrics/matchdeal/affinity').then((r) => r.json()).then((body) => { if (body.ok) setData(body); });
  }, []);

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const withPattern = data.rows.filter((r) => r.topPattern);

  return (
    <Card title="Profile affinity — per-viewer decision time & like rate">
      <p className="mb-3 text-xs text-gray-400">
        Diagnostic only — internal, admin-only, never surfaced to any investor/startup-facing page (see migration 0204).
        Decision time is approximated from the most recent prior exposure, not a measured dwell time; a pattern only
        shows below a minimum sample of {data.minSample} exposure-backed swipes — otherwise it honestly says so.
      </p>
      {withPattern.length === 0 ? (
        <p className="text-sm text-gray-400">No viewer has enough exposure-backed swipes yet for a pattern to be meaningful.</p>
      ) : (
        <ul className="space-y-2">
          {withPattern.map((r) => (
            <li key={r.viewerProfileId} className="rounded-lg border border-gray-50 p-2.5 text-sm">
              <span className="font-semibold text-gray-900">{r.viewerLabel}</span>
              <span className="ml-1.5 text-xs text-gray-400">({r.viewerKind ?? '—'}, {r.sampleSize} swipes)</span>
              <p className="mt-1 text-xs text-gray-600">
                Spends {fmtDuration(r.topPattern!.avgDecisionSeconds)} avg on <span className="font-medium">{r.topPattern!.value}</span> profiles
                ({r.topPattern!.type}), {r.topPattern!.likeRatePct}% like rate — vs {fmtDuration(r.topPattern!.elsewhereAvgDecisionSeconds)}/{r.topPattern!.elsewhereLikeRatePct}% elsewhere.
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="text-2xl font-bold text-[#0E7490]">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
}

export function MatchDealTab() {
  const [data, setData] = useState<MatchDealData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/metrics/matchdeal').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error); return; }
      setData(body);
    }).catch(() => setErr('Failed to load.'));
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Swipes / day" value={data.swipesPerDay} hint="last 7 days, daily average" />
        <Stat label="Likes (7d)" value={data.likesLastWeek} />
        <Stat label="Passes (7d)" value={data.passesLastWeek} />
        <Stat label="Active matches" value={data.activeMatches} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active pairings — startup" value={data.activePairings.startup} hint="paired PWA devices" />
        <Stat label="Active pairings — investor" value={data.activePairings.investor} hint="paired PWA devices" />
      </div>

      <Card title={`Usage by tier — week of ${data.weekStart ?? '—'}`}>
        {Object.keys(data.usageByTier).length === 0 ? (
          <p className="text-sm text-gray-400">No weekly activity recorded yet this week.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-1.5">Tier</th><th>Profiles active</th><th>Shown</th><th>Likes</th><th>Reconsiderations</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.usageByTier).map(([tier, row]) => (
                <tr key={tier} className="border-t border-gray-50">
                  <td className="py-2 font-medium">{TIER_LABEL[tier] ?? tier}</td>
                  <td className="text-gray-600">{row.profiles}</td>
                  <td className="text-gray-600">{row.shown}</td>
                  <td className="text-gray-600">{row.likes}</td>
                  <td className="text-gray-600">{row.reconsiderations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <UsageRankingSection />
      <AffinitySection />
    </div>
  );
}
