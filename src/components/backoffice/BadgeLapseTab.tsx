'use client';
// Prompt 601 §F — "tech master em lapso": the 2-month window passed with no
// use. The status was NOT revoked and nothing is charged; a person decides
// here, with the access history in view. "Keep" records the review and
// leaves the status as it is (a use still restores it by itself); "Revoke"
// ends the rights, with a reason, audited.
import { useCallback, useEffect, useState } from 'react';
import { formatDate } from '@/lib/platform-badges';

interface LapseRow {
  id: string; orgId: string; orgName: string; orgIsTest: boolean; grantedAt: string; justification: string | null;
  lapsedAt: string | null; lapseReviewedAt: string | null; lastWarningPct: number; hasSubscription: boolean;
  usage: { lastUse: string | null; sessions60d: number; activeDays60d: number } | null;
  window: { elapsedPct: number; daysLeft: number; deadlineAt: string; anchorAt: string } | null;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export function BadgeLapseTab() {
  const [rows, setRows] = useState<LapseRow[] | null>(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(() => {
    fetch('/api/backoffice/platform-badges?lapsed=1').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setRows(body.badges ?? []);
    }).catch((e) => setErr((e as Error).message || 'Failed to load.'));
  }, []);
  useEffect(load, [load]);

  async function act(payload: Record<string, unknown>, id: string) {
    setBusyId(id); setErr('');
    try {
      const res = await fetch('/api/backoffice/platform-badges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Failed.'); return; }
      setRevoking(null);
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!rows) return <p className="text-sm text-gray-400">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-gray-400">Queue clear — no tech master has passed the 2-month window without a use.</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Rights continue and nothing is charged while a row sits here. Using the app again restores the status automatically; <b>Keep</b> only records that a person looked.
      </p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
          <th className="py-1">Org</th><th>Granted</th><th>Last use</th><th>Sessions / active days (60d)</th><th>Lapsed</th><th>Warnings</th><th>Reviewed</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-gray-50 align-top">
              <td className="py-1.5 font-medium">{r.orgName}{r.orgIsTest && <span className="ml-1 text-[10px] text-gray-400">test</span>}
                {r.justification && <div className="text-[11px] font-normal text-gray-400">{r.justification}</div>}</td>
              <td className="text-gray-500">{formatDate(r.grantedAt)}</td>
              <td className="text-gray-600">{r.usage?.lastUse ? `${formatDate(r.usage.lastUse)} (${daysSince(r.usage.lastUse)}d ago)` : 'none since grant'}</td>
              <td className="text-gray-600">{r.usage ? `${r.usage.sessions60d} / ${r.usage.activeDays60d}` : '—'}</td>
              <td className="text-amber-800">{r.lapsedAt ? `${formatDate(r.lapsedAt)} (${daysSince(r.lapsedAt)}d)` : '—'}</td>
              <td className="text-gray-500">{r.lastWarningPct ? `up to ${r.lastWarningPct}%` : 'none'}</td>
              <td className="text-gray-500">{r.lapseReviewedAt ? formatDate(r.lapseReviewedAt) : <span className="text-amber-700">pending</span>}</td>
              <td className="whitespace-nowrap">
                {revoking?.id === r.id ? (
                  <span className="inline-flex items-center gap-1">
                    <input value={revoking.reason} onChange={(e) => setRevoking({ id: r.id, reason: e.target.value })} placeholder="Reason" autoComplete="off" className="w-36 rounded border border-gray-300 px-1.5 py-0.5 text-xs" />
                    <button disabled={busyId === r.id || revoking.reason.trim().length < 4} onClick={() => act({ action: 'revoke', id: r.id, reason: revoking.reason }, r.id)}
                      className="rounded bg-[#B00000] px-2 py-0.5 text-xs font-medium text-white disabled:opacity-40">Confirm</button>
                    <button onClick={() => setRevoking(null)} className="text-xs text-gray-500">Cancel</button>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {!r.lapseReviewedAt && (
                      <button disabled={busyId === r.id} onClick={() => act({ action: 'keep', id: r.id }, r.id)}
                        className="rounded-lg border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-40">Keep</button>
                    )}
                    <button disabled={busyId === r.id} onClick={() => setRevoking({ id: r.id, reason: '' })}
                      className="rounded-lg border border-red-300 px-2 py-0.5 text-xs font-medium text-red-800 hover:bg-red-50 disabled:opacity-40">Revoke…</button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
