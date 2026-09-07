'use client';
// Prompt 572 §D — read-only ranking, filling the "Contributions by user"
// placeholder BackofficeShell left in the Insight group (see that file's own
// comment: "moves here ... once 572-574 land"). Deliberately view-only: every
// actual decision (verify/reject a fact) stays in the Review › Contributions
// queue this page links back to — this one only answers "who is
// contributing, and how much of it holds up."
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface RankingRow {
  userId: string; name: string; orgNames: string[];
  proposed: number; accepted: number; rate: number; points: number; lastContributionAt: string;
}
interface Data {
  ranking: RankingRow[];
  aiContributionCount: number;
  legacyUnattributedCount: number;
  legacyUnattributedLastAt: string | null;
  provenanceFixDate: string;
  pointsTableEmpty: boolean;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ContributionsInsightPage() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/contribution-ranking').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'not available'); return; }
      setData(body);
    }).catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  const maxPoints = Math.max(1, ...data.ranking.map((r) => r.points));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Contributions by user</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Who is filling in the catalog by hand, and how much of what they submit is verified as true. Decisions
          happen in{' '}
          <Link href="/backoffice/queue?tab=contributions" className="text-[#0E7490] hover:underline">Review › Contributions</Link>
          {' '}— this page is a read-only leaderboard.
        </p>
      </div>

      {data.pointsTableEmpty && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          The points column is real (it reads <code>contribution_points</code> directly) but nothing on the platform
          awards points yet, so every row shows 0. Not a bug in this page — there is no live caller of the
          <code> contribute_catalog_person</code> function it sums.
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-bold text-gray-900">Ranking — by points, then accepted, then proposed</div>
        {data.ranking.length === 0 ? (
          <p className="text-sm text-gray-400">No attributed contributions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  <th className="w-10 pb-2">#</th>
                  <th className="pb-2">User</th>
                  <th className="pb-2">Org</th>
                  <th className="w-24 pb-2">Proposed</th>
                  <th className="w-24 pb-2">Accepted</th>
                  <th className="w-24 pb-2">Rate</th>
                  <th className="w-40 pb-2">Points</th>
                  <th className="pb-2">Last contribution</th>
                </tr>
              </thead>
              <tbody>
                {data.ranking.map((r, i) => (
                  <tr key={r.userId} className="border-b border-gray-50">
                    <td className="py-2.5 font-bold text-gray-400">{i + 1}</td>
                    <td className="py-2.5 font-semibold text-gray-900">{r.name}</td>
                    <td className="py-2.5 text-gray-500">{r.orgNames.join(', ') || '—'}</td>
                    <td className="py-2.5 text-gray-500">{r.proposed}</td>
                    <td className="py-2.5 text-gray-500">{r.accepted}</td>
                    <td className="py-2.5">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.rate >= 0.7 ? 'bg-green-50 text-green-700' : r.rate >= 0.4 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                        {Math.round(r.rate * 100)}%
                      </span>
                    </td>
                    <td className="py-2.5">
                      <div className="relative flex h-5 items-center overflow-hidden rounded">
                        <div className="absolute inset-y-0 left-0 rounded bg-[#E8F4F8]" style={{ width: `${(r.points / maxPoints) * 100}%` }} />
                        <span className="relative pl-2 text-xs font-bold text-gray-900">{r.points}</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-gray-500">{fmtDate(r.lastContributionAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(data.legacyUnattributedCount > 0 || data.aiContributionCount > 0) && (
        <p className="text-xs text-gray-400">
          {data.legacyUnattributedCount > 0 && (
            <>{data.legacyUnattributedCount} contribution{data.legacyUnattributedCount === 1 ? '' : 's'} from before {fmtDate(data.provenanceFixDate)}
            {data.legacyUnattributedLastAt ? ` (most recently ${fmtDate(data.legacyUnattributedLastAt)})` : ''} have no recorded author and are not attributed to anyone above. </>
          )}
          {data.aiContributionCount > 0 && <>{data.aiContributionCount} AI-sourced contribution{data.aiContributionCount === 1 ? '' : 's'} are excluded from this leaderboard — they were not proposed by a person.</>}
        </p>
      )}
    </div>
  );
}
