'use client';
// SherlockDeal_Metricas_BackOffice_V1, Section 8. "A peça mais útil de
// todo o back office na fase inicial."
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { PeriodPicker, type Period } from './PeriodPicker';
import { FunnelView, type FunnelResult } from './FunnelView';

interface ActivationData {
  funnel: FunnelResult;
  retention: {
    retention7d: number | null; retention30d: number | null;
    byCohortMonth: { month: string; activated: number; retained30d: number }[];
    inactiveOver30d: number;
  };
  activity: { startupsWithActivity: number; investorsWithActivity: number; medianDaysToFirstAction: number | null };
}

function MiniStat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <div className="text-lg font-bold text-[#0E7490]">{value}</div>
      <div className="mt-0.5 text-[11px] text-gray-500">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
}

export function ActivationRetentionTab() {
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<ActivationData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`/api/backoffice/metrics/activation?period=${period}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setData(body); setErr('');
    }).catch(() => setErr('Failed to load.'));
  }, [period]);

  return (
    <div className="space-y-5">
      <PeriodPicker period={period} onChange={setPeriod} />
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {!data ? <p className="text-sm text-gray-400">Loading…</p> : (
        <>
          <Card title="Activation funnel">
            <p className="mb-2 text-xs text-gray-400">
              &quot;Pipeline visualizada&quot; has no page-view tracking anywhere in this codebase — approximated as &quot;has ≥1
              investor interaction&quot;, a lower bound, not a literal view count.
            </p>
            <FunnelView funnel={data.funnel} />
          </Card>

          <Card title="Retention">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="7-day retention" value={data.retention.retention7d != null ? `${data.retention.retention7d}%` : '—'} />
              <MiniStat label="30-day retention" value={data.retention.retention30d != null ? `${data.retention.retention30d}%` : '—'} />
              <MiniStat label="Inactive >30 days" value={data.retention.inactiveOver30d} />
            </div>
            {data.retention.byCohortMonth.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400"><th className="py-1.5">Cohort month</th><th>Activated</th><th>Retained 30d</th></tr></thead>
                  <tbody>
                    {data.retention.byCohortMonth.map((c) => (
                      <tr key={c.month} className="border-t border-gray-50">
                        <td className="py-1.5">{c.month}</td><td>{c.activated}</td><td>{c.retained30d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Relevant activity">
            <p className="mb-3 text-xs text-gray-400">
              Startups: a logged interaction, an analytics event, or a catalog edit in the period — several planned
              signals (Smart Calendar, AI Drafts, Review/Optimization) aren&apos;t tracked yet. Investors: distinct
              investors who swiped in MatchDeal in the period.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Startups with activity" value={data.activity.startupsWithActivity} />
              <MiniStat label="Investors with activity" value={data.activity.investorsWithActivity} hint="distinct investors, MatchDeal swipes" />
              <MiniStat label="Median days to first action" value={data.activity.medianDaysToFirstAction ?? '—'} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
