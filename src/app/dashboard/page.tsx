'use client';
// Dashboard — campaign at a glance
import { useStore } from '@/lib/store';
import { Card, EntityLink, fmtEur } from '@/components/ui';
import { outboundCounts, passReasonAlert } from '@/lib/rules';
import type { EntityStatus } from '@/lib/types';

const STATUS_ORDER: EntityStatus[] = ['not_contacted', 'contacted', 'in_conversation', 'diligence', 'passed', 'invested', 'dormant'];
const STATUS_BAR: Record<EntityStatus, string> = {
  not_contacted: 'bg-gray-300', contacted: 'bg-cyan-300', in_conversation: 'bg-cyan-500',
  diligence: 'bg-[#0E7490]', passed: 'bg-red-400', invested: 'bg-green-600', dormant: 'bg-gray-400',
};

export default function DashboardPage() {
  const { db } = useStore();
  const caps = outboundCounts(db);
  const alert = passReasonAlert(db);
  const active = db.entities.filter((e) => ['in_conversation', 'diligence'].includes(e.status)).length;
  const passes = db.interactions.filter((i) => i.classification === 'pass');
  const followupsDue = db.tasks.filter((t) => !t.done && t.kind === 'follow_up'
    && t.due_at && new Date(t.due_at) < new Date(Date.now() + 7 * 86400_000));
  const softCircled = db.entities.reduce((s, e) => s + (e.interest_eur ?? 0), 0);

  const contacted = db.entities.filter((e) => e.status !== 'not_contacted').length;
  const replied = new Set(db.interactions.filter((i) => i.direction === 'in').map((i) => i.entity_id)).size;
  const meetings = new Set(db.interactions.filter((i) => i.channel === 'meeting' || i.classification === 'meeting_request').map((i) => i.entity_id)).size;
  const diligence = db.entities.filter((e) => e.status === 'diligence').length;
  const invested = db.entities.filter((e) => e.status === 'invested').length;
  const funnel = [
    { label: 'contacted', n: contacted }, { label: 'replied', n: replied },
    { label: 'meeting', n: meetings }, { label: 'diligence', n: diligence }, { label: 'committed', n: invested },
  ];

  const passCounts = new Map<string, { count: number; sample?: string }>();
  for (const p of passes) {
    const k = p.pass_reason_category ?? 'other';
    const cur = passCounts.get(k) ?? { count: 0 };
    passCounts.set(k, { count: cur.count + 1, sample: cur.sample ?? p.pass_reason });
  }

  const viewsByDoc = new Map<string, number>();
  for (const v of db.views) viewsByDoc.set(v.document_id, (viewsByDoc.get(v.document_id) ?? 0) + 1);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Dashboard</h1>

      {alert && (
        <div className="rounded-lg border-l-4 border-[#B00000] bg-red-50 px-4 py-3 text-sm">
          <span className="font-semibold text-[#B00000]">⚠ Same pass reason ({alert.category.replace('_', ' ')}) at {alert.count} investors — the pitch may be the problem. Review before sending more.</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><div className="text-2xl font-bold text-[#0E7490]">{active}</div>
          <div className="text-xs text-gray-500">Active conversations<br />benchmark: seeds close on 15–40</div></Card>
        <Card><div className="text-2xl font-bold">{caps.week}<span className="text-sm font-normal text-gray-400">/{caps.weeklyCap}</span></div>
          <div className="mt-1 h-1.5 rounded bg-gray-100"><div className={`h-full rounded ${caps.week >= caps.weeklyCap - 2 ? 'bg-amber-500' : 'bg-[#0E7490]'}`} style={{ width: `${Math.min(100, caps.week / caps.weeklyCap * 100)}%` }} /></div>
          <div className="text-xs text-gray-500">Sent this week</div></Card>
        <Card><div className="text-2xl font-bold">{followupsDue.length}</div>
          <div className="text-xs text-gray-500">Follow-ups due next 7 days</div></Card>
        <Card><div className="text-2xl font-bold">{passes.length}</div>
          <div className="text-xs text-gray-500">Passes (with reasons)</div></Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Round progress" tint="blue">
          <div className="text-xl font-bold text-[#0E7490]">{fmtEur(softCircled)} <span className="text-sm font-normal text-gray-500">/ €1.3M target</span></div>
          <div className="mt-2 h-3 overflow-hidden rounded bg-white">
            <div className="h-full bg-[#0E7490]" style={{ width: `${Math.min(100, softCircled / 1300000 * 100)}%` }} />
          </div>
          <div className="mt-4 space-y-1">
            {funnel.map((f, i) => (
              <div key={f.label} className="flex items-center gap-2 text-sm">
                <span className="w-20 text-xs text-gray-500">{f.label}</span>
                <div className="h-4 rounded bg-[#0E7490]/80" style={{ width: `${Math.max(4, f.n / Math.max(1, funnel[0].n) * 100)}%` }} />
                <span className="text-xs font-medium">{f.n}</span>
                {i > 0 && funnel[i - 1].n > 0 && <span className="text-[10px] text-gray-400">{Math.round(f.n / funnel[i - 1].n * 100)}%</span>}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Status breakdown">
          <div className="space-y-1.5">
            {STATUS_ORDER.map((s) => {
              const n = db.entities.filter((e) => e.status === s).length;
              return (
                <div key={s} className="flex items-center gap-2 text-sm">
                  <span className="w-28 text-xs text-gray-500">{s.replace('_', ' ')}</span>
                  <div className={`h-3 rounded ${STATUS_BAR[s]}`} style={{ width: `${Math.max(3, n / db.entities.length * 100)}%` }} />
                  <span className="text-xs">{n}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Pass reasons">
          {passCounts.size === 0 ? <p className="text-sm text-gray-400">No passes yet — when they come, the reasons are the most valuable data you collect.</p> : (
            <ul className="space-y-1.5 text-sm">
              {[...passCounts.entries()].sort((a, b) => b[1].count - a[1].count).map(([k, v]) => (
                <li key={k}>
                  <span className="font-medium">{k.replace('_', ' ')}</span> — {v.count}
                  {v.sample && <span className="block text-xs text-gray-500">“{v.sample.slice(0, 80)}”</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Upcoming follow-ups">
          {followupsDue.length === 0 ? <p className="text-sm text-gray-400">None in the next 7 days.</p> : (
            <ul className="space-y-1.5 text-sm">
              {followupsDue.slice(0, 6).map((t) => (
                <li key={t.id} className="flex justify-between gap-2">
                  <span>{t.title} {t.entity_id && <EntityLink id={t.entity_id}>→</EntityLink>}</span>
                  <span className="text-xs text-gray-400">{t.due_at?.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Data room engagement">
          {db.views.length === 0 ? <p className="text-sm text-gray-400">No investor views yet. Views appear here the moment a grantee opens a document.</p> : (
            <ul className="space-y-1.5 text-sm">
              {[...viewsByDoc.entries()].map(([docId, n]) => (
                <li key={docId} className="flex justify-between">
                  <span>{db.documents.find((d) => d.id === docId)?.name}</span>
                  <span className="text-xs text-gray-500">{n} view(s)</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`Overrides log (${db.overrides.length})`}>
        {db.overrides.length === 0 ? <p className="text-sm text-gray-400">No rules overridden. Good.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">Date</th><th>Rule</th><th>Entity</th><th>Justification</th></tr></thead>
            <tbody>
              {db.overrides.map((o) => (
                <tr key={o.id} className="border-t border-gray-100">
                  <td className="py-1.5 text-xs text-gray-500">{o.created_at.slice(0, 10)}</td>
                  <td className="text-xs">{o.rule.replace('_', ' ')}</td>
                  <td className="text-xs">{o.entity_id && <EntityLink id={o.entity_id}>{db.entities.find((e) => e.id === o.entity_id)?.name}</EntityLink>}</td>
                  <td className="text-xs text-gray-600">{o.justification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
