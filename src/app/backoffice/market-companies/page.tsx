'use client';
// Prompt 574 §D — read-only: "which orgs list this company as competitor
// (n)". Lives in Data, not Review — there is no review action on
// org_competitors anywhere in this codebase (see the API route's own
// header for the diagnosis), so this is a new aggregation view, not a
// relocated queue.
import { useEffect, useState } from 'react';

interface CompanyRow {
  companyId: string; companyName: string; domain: string | null; companyType: string | null;
  sectors: string[]; lifeStatus: string | null; orgCount: number; orgNames: string[];
  relations: string[]; positionings: string[]; competitorTypes: string[];
}

export default function MarketCompaniesPage() {
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/market-companies').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'not available'); return; }
      setRows(body.companies);
    }).catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!rows) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Market companies</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Every company a startup on the platform has listed as a competitor, grouped and counted across orgs —
          read-only, no approval step. (Not to be confused with &quot;Competitor intel&quot; under Review, which
          tracks investor_investments — a different table entirely.)
        </p>
      </div>
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        {rows.length === 0 ? <p className="text-sm text-gray-400">No org has listed a competitor yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  <th className="pb-2">Company</th>
                  <th className="w-24 pb-2">Orgs</th>
                  <th className="pb-2">Listed by</th>
                  <th className="pb-2">Positioning / type</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.companyId} className="border-b border-gray-50 align-top">
                    <td className="py-2.5">
                      <div className="font-semibold text-gray-900">{r.companyName}</div>
                      <div className="text-xs text-gray-400">{r.domain}{r.sectors.length ? ` · ${r.sectors.join(', ')}` : ''}</div>
                    </td>
                    <td className="py-2.5 font-bold text-gray-700">{r.orgCount}</td>
                    <td className="py-2.5 text-xs text-gray-500">{r.orgNames.join(', ')}</td>
                    <td className="py-2.5 text-xs text-gray-500">
                      {r.competitorTypes.length > 0 && <div>{r.competitorTypes.join(', ')}</div>}
                      {r.positionings.length > 0 && <div className="text-gray-400">{r.positionings.join(' · ')}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
