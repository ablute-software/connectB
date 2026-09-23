'use client';
// Prompt 728 §5 — "é o número que decide quando a promoção automática por
// afinidade passa a fazer sentido." Real counts from GET /api/backoffice/
// interlocutor-coverage — no illustrative placeholders.
import { useEffect, useState } from 'react';

interface Counts { total: number; withHook: number; withHookAndSource: number; withAnySource: number }
interface CoverageData { global: Counts; byOrg: (Counts & { orgId: string; orgName: string })[] }

function pct(n: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((n / total) * 100)}%`;
}

function CoverageRow({ label, counts }: { label: string; counts: Counts }) {
  return (
    <tr className="border-t border-gray-100">
      <td className="py-2 pr-3 text-sm text-gray-700">{label}</td>
      <td className="py-2 pr-3 text-sm text-gray-500">{counts.total}</td>
      <td className="py-2 pr-3 text-sm text-gray-900">{pct(counts.withHook, counts.total)} <span className="text-gray-400">({counts.withHook})</span></td>
      <td className="py-2 pr-3 text-sm text-gray-900">{pct(counts.withHookAndSource, counts.total)} <span className="text-gray-400">({counts.withHookAndSource})</span></td>
      <td className="py-2 text-sm text-gray-900">{pct(counts.withAnySource, counts.total)} <span className="text-gray-400">({counts.withAnySource})</span></td>
    </tr>
  );
}

export default function InterlocutorCoveragePage() {
  const [data, setData] = useState<CoverageData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/interlocutor-coverage').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'not available'); return; }
      setData(body);
    }).catch(() => setErr('not available'));
  }, []);

  return (
    <div>
      <h1 className="text-lg font-semibold text-gray-900">Interlocutor coverage</h1>
      <p className="mt-1 text-sm text-gray-500">
        Active-wave opportunities (wave 1, not contacted) with a contactable person who has a hook, a hook backed by a
        source, or any saved contact source at all. Prompt 728&apos;s own bar: this is the number that decides when
        promoting a documented affinity to the recommended person automatically would stop being a guess.
      </p>

      {err && <p className="mt-4 text-sm text-amber-700">{err}</p>}

      {data && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-gray-400">
                <th className="py-2 pl-3 pr-3">Org</th>
                <th className="py-2 pr-3">Opportunities</th>
                <th className="py-2 pr-3">With hook</th>
                <th className="py-2 pr-3">With hook + source</th>
                <th className="py-2">With any saved source</th>
              </tr>
            </thead>
            <tbody>
              <CoverageRow label="Global" counts={data.global} />
              {data.byOrg.map((o) => <CoverageRow key={o.orgId} label={o.orgName} counts={o} />)}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-gray-400">
        &quot;With any saved source&quot; reads linkedin_url/email_verified/email_guess on the materialized person — the
        closest honest signal available on `people` today; there is no dedicated sources column on this table.
      </p>
    </div>
  );
}
