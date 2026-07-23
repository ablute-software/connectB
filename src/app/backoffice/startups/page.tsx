'use client';
// BLOCO 3 — Startups: org health, aggregates only. No drill-in, no
// impersonation — "nós não lemos o teu pipeline." Plans & Account batch adds
// per-org plan management (view/set + pending upgrade requests) for the
// platform team, since there's no billing infra yet — the flip is manual.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { PLANS, planName, normalizePlan } from '@/lib/plans';
import type { PlanTier } from '@/lib/types';

interface OrgHealth {
  orgId: string; name: string; plan: string; createdAt: string;
  planChangeRequested: string | null; planChangeRequestedAt: string | null;
  members: number; grants: number; interactionsThisWeek: number; lastLogin: string | null;
  health: 'active' | 'quiet' | 'dormant';
}

const HEALTH_STYLE: Record<OrgHealth['health'], string> = {
  active: 'bg-green-50 text-green-700', quiet: 'bg-amber-50 text-amber-700', dormant: 'bg-gray-100 text-gray-500',
};

export default function BackofficeStartupsPage() {
  const [orgs, setOrgs] = useState<OrgHealth[] | null>(null);
  const [planManagement, setPlanManagement] = useState(false);
  const [err, setErr] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  function load() {
    fetch('/api/backoffice/startups').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setOrgs(body.orgs);
      setPlanManagement(!!body.planManagement);
    });
  }
  useEffect(load, []);

  async function setPlan(orgId: string, tier: PlanTier) {
    setSavingId(orgId);
    try {
      const res = await fetch('/api/backoffice/set-plan', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, tier }),
      });
      const body = await res.json();
      if (!body.ok) { alert(`Set plan failed: ${body.error}`); return; }
      load();
    } finally {
      setSavingId(null);
    }
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!orgs) return <p className="text-sm text-gray-400">Loading…</p>;

  const pending = orgs.filter((o) => o.planChangeRequested);

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Startups</h1>

      {planManagement && pending.length > 0 && (
        <Card title={`Pending plan-change requests (${pending.length})`}>
          <ul className="divide-y divide-gray-100 text-sm">
            {pending.map((o) => (
              <li key={o.orgId} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{o.name}</span>
                <span className="text-xs text-gray-500">
                  {planName(normalizePlan(o.plan))} → <b>{planName(normalizePlan(o.planChangeRequested))}</b>
                  {o.planChangeRequestedAt && ` · pedido ${o.planChangeRequestedAt.slice(0, 10)}`}
                </span>
                <button
                  onClick={() => setPlan(o.orgId, normalizePlan(o.planChangeRequested))}
                  disabled={savingId === o.orgId}
                  className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                  {savingId === o.orgId ? 'A aplicar…' : 'Aplicar pedido'}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Orgs (${orgs.length})`}>
        <p className="mb-3 text-xs text-gray-500">Counts and timestamps only — never entity/person names, interaction content, or pipeline stage.</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-1.5">Org</th><th>Plan</th><th>Members</th><th>Grants</th><th>Interactions/wk</th><th>Last login</th><th>Health</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.orgId} className="border-t border-gray-50">
                <td className="py-2 font-medium">{o.name}<div className="text-xs font-normal text-gray-400">since {o.createdAt.slice(0, 10)}</div></td>
                <td>
                  {planManagement ? (
                    <div className="flex items-center gap-1.5">
                      <select value={normalizePlan(o.plan)} disabled={savingId === o.orgId}
                        onChange={(e) => setPlan(o.orgId, e.target.value as PlanTier)}
                        className="rounded border border-gray-300 px-1.5 py-0.5 text-xs">
                        {PLANS.map((p) => <option key={p.tier} value={p.tier}>{p.name}</option>)}
                      </select>
                      {o.planChangeRequested && (
                        <span title={`Requested ${planName(normalizePlan(o.planChangeRequested))}`}
                          className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">req</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-500">{planName(normalizePlan(o.plan))}</span>
                  )}
                </td>
                <td className="text-gray-600">{o.members}</td>
                <td className="text-gray-600">{o.grants}</td>
                <td className="text-gray-600">{o.interactionsThisWeek}</td>
                <td className="text-xs text-gray-400">{o.lastLogin ? o.lastLogin.slice(0, 10) : 'never'}</td>
                <td><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${HEALTH_STYLE[o.health]}`}>{o.health}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!planManagement && (
          <p className="mt-3 text-[11px] text-gray-400">Plan management activates once migration 0028 is applied.</p>
        )}
      </Card>
    </div>
  );
}
