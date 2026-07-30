'use client';
// SherlockDeal_Metricas_BackOffice_V1, Section 9.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { FunnelView, type FunnelResult } from './FunnelView';
import { HistoricalDataNotice } from './HistoricalDataNotice';

interface FundraisingData {
  funnel: FunnelResult;
  rates: {
    pipelineContactRate: number | null; replyRate: number | null; conversationConversionRate: number | null;
    diligenceConversionRate: number | null; passRate: number | null; medianDaysToFirstQualifiedConversation: number | null;
  };
  byStartup: { orgId: string; orgName: string; pipeline: number; contacted: number; replied: number; conversations: number; diligences: number; investments: number; passes: number; staleOver30d: number }[];
  sourceDistribution: Record<string, number>;
  dataRoom: {
    startupsWithDataRoom: number; pitchDecksOpened: number;
    level2Requests: { submitted: number; approved: number; rejected: number };
    ddRequests: { submitted: number; approved: number; rejected: number };
    medianDaysToDecision: number | null;
  };
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <div className="text-lg font-bold text-[#0E7490]">{value}</div>
      <div className="mt-0.5 text-[11px] text-gray-500">{label}</div>
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  catalog: 'Sherlock curated pipeline', manual: 'Adicionado manualmente', match_deal: 'MatchDeal match', unknown: 'Unknown',
};

export function FundraisingOutcomesTab() {
  const [data, setData] = useState<FundraisingData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/metrics/fundraising').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setData(body); setErr('');
    }).catch(() => setErr('Failed to load.'));
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-5">
      <Card title="Main funnel">
        <FunnelView funnel={data.funnel} />
        <HistoricalDataNotice />
      </Card>

      <Card title="Key rates">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MiniStat label="Pipeline contact rate" value={data.rates.pipelineContactRate != null ? `${data.rates.pipelineContactRate}%` : '—'} />
          <MiniStat label="Reply rate" value={data.rates.replyRate != null ? `${data.rates.replyRate}%` : '—'} />
          <MiniStat label="Conversation conversion" value={data.rates.conversationConversionRate != null ? `${data.rates.conversationConversionRate}%` : '—'} />
          <MiniStat label="Diligence conversion" value={data.rates.diligenceConversionRate != null ? `${data.rates.diligenceConversionRate}%` : '—'} />
          <MiniStat label="Pass rate" value={data.rates.passRate != null ? `${data.rates.passRate}%` : '—'} />
          <MiniStat label="Median days to qualified conversation" value={data.rates.medianDaysToFirstQualifiedConversation ?? '—'} />
        </div>
      </Card>

      <Card title="Results by startup">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-1.5">Startup</th><th>Pipeline</th><th>Contacted</th><th>Replied</th><th>Conversations</th><th>Diligence</th><th>Invested</th><th>Passed</th><th>Stale &gt;30d</th>
              </tr>
            </thead>
            <tbody>
              {data.byStartup.map((r) => (
                <tr key={r.orgId} className="border-t border-gray-50">
                  <td className="py-1.5 font-medium">{r.orgName}</td><td>{r.pipeline}</td><td>{r.contacted}</td><td>{r.replied}</td>
                  <td>{r.conversations}</td><td>{r.diligences}</td><td>{r.investments}</td><td>{r.passes}</td><td>{r.staleOver30d}</td>
                </tr>
              ))}
              {data.byStartup.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-gray-400">No pipeline data yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Investor source">
        <p className="mb-2 text-xs text-gray-400">Distribution only in V1 — comparing contact/reply/conversion rates BY source needs more volume to mean anything (deferred to V2).</p>
        <ul className="space-y-1 text-sm">
          {Object.entries(data.sourceDistribution).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <li key={k} className="flex items-center justify-between border-b border-gray-50 py-1 last:border-0">
              <span className="text-gray-600">{SOURCE_LABELS[k] ?? k}</span><span className="font-medium text-gray-900">{v}</span>
            </li>
          ))}
        </ul>
        {/* MET-06 — confirmed via schema: entities.source is already
            per RELATION (one entities row = one org's own relationship
            with that investor, set independently at insert time), not a
            fixed investor-level value — the ambiguity MET-06 asked about
            doesn't apply here. The real gap is value coverage: the check
            constraint only allows catalog/manual/match_deal, not the
            spec's 7 categories, so bulk imports, invites, and "already
            known contact" are all indistinguishable from a plain manual
            add today. See the chat report for the proposed value-set
            expansion — not implemented yet, pending sign-off. */}
        <p className="mt-2 text-[11px] text-amber-700">
          ⚠ Already per relation (each startup&apos;s own pipeline entry has its own source), not per investor — but only 3 of the
          spec&apos;s 7 categories exist today, so most relations show as &quot;Manually added&quot; even when they arrived a more
          specific way. See MET-06 for the proposed fix.
        </p>
      </Card>

      <Card title="Data Room & access">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Startups with Data Room" value={data.dataRoom.startupsWithDataRoom} />
          <MiniStat label="Pitch decks opened" value={data.dataRoom.pitchDecksOpened} />
          <MiniStat label="Access grants submitted" value={data.dataRoom.level2Requests.submitted} />
          <MiniStat label="Access grants confirmed" value={data.dataRoom.level2Requests.approved} />
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          Level 2 vs. Due Diligence access aren&apos;t distinct states in access_grants today, and a rejected request is never
          granted at all (no row survives to count as &quot;rejected&quot;) — both documented gaps, not hidden zeros.
        </p>
      </Card>
    </div>
  );
}
