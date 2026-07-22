'use client';
// BLOCO 3 — Startups: org health, aggregates only. No drill-in, no
// impersonation — "nós não lemos o teu pipeline."
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface OrgHealth {
  orgId: string; name: string; plan: string; createdAt: string;
  members: number; grants: number; interactionsThisWeek: number; lastLogin: string | null;
  health: 'active' | 'quiet' | 'dormant';
}

const HEALTH_STYLE: Record<OrgHealth['health'], string> = {
  active: 'bg-green-50 text-green-700', quiet: 'bg-amber-50 text-amber-700', dormant: 'bg-gray-100 text-gray-500',
};

export default function BackofficeStartupsPage() {
  const [orgs, setOrgs] = useState<OrgHealth[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/startups').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setOrgs(body.orgs);
    });
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!orgs) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Startups</h1>
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
                <td className="text-gray-500 capitalize">{o.plan}</td>
                <td className="text-gray-600">{o.members}</td>
                <td className="text-gray-600">{o.grants}</td>
                <td className="text-gray-600">{o.interactionsThisWeek}</td>
                <td className="text-xs text-gray-400">{o.lastLogin ? o.lastLogin.slice(0, 10) : 'never'}</td>
                <td><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${HEALTH_STYLE[o.health]}`}>{o.health}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
