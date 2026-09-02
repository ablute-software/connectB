'use client';
// Prompt 531 §9-14 — Backoffice → Startups → Strikes.
//
// Deliberately a tab inside the existing Startups page (same `Tabs`
// component, same `Card`, same table conventions as the Orgs tab beside it)
// rather than a new back-office area: the request is explicit that this
// belongs in Startups and that existing back-office patterns should be
// reused instead of custom components.
//
// The two states it keeps visibly separate, because the product treats them
// separately: the strike COUNT, and the My Network BAN. Reversing a strike
// recomputes the count; it does not lift a suspension (there is no product
// rule for lifting one, and inventing one here would be inventing policy).
// What the tab does instead is surface the mismatch — "ban no longer
// required by the strike count" — so a moderator decides it deliberately.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';

interface StrikeRow {
  actorId: string; actorKind: 'founder' | 'investor'; orgId: string | null; name: string;
  activeStrikes: number; totalStrikes: number; suspendedAt: string | null;
  banned: boolean; banNoLongerRequired: boolean; pendingAppeals: number; lastStrikeAt: string | null;
}
interface StrikeDetail {
  id: string; status: 'active' | 'reversed'; appliedAt: string; appliedByEmail: string | null;
  reversedAt: string | null; reversedByEmail: string | null; reversalReason: string | null;
  contentRemoved: boolean; ticketId: string; postId: string | null;
  contentPreview: string | null; contentCreatedAt: string | null; postRemovedAt: string | null;
  appeal: { id: string; status: 'pending' | 'upheld' | 'reversed'; body: string; createdAt: string; decidedAt: string | null; decisionNote: string | null } | null;
}

type Filter = 'all' | 'active_strikes' | 'banned' | 'appeal_pending';

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All', active_strikes: 'Active strikes', banned: 'Network banned', appeal_pending: 'Appeal pending',
};

function fmt(iso: string | null) {
  return iso ? iso.slice(0, 10) : '—';
}

export function NetworkStrikesTab() {
  const [rows, setRows] = useState<StrikeRow[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openActorId, setOpenActorId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StrikeDetail[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonFor, setReasonFor] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/backoffice/network-strikes').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setAvailable(body.available !== false);
      setRows(body.rows ?? []);
    }).catch(() => setErr('Could not load strikes.'));
  }, []);
  useEffect(load, [load]);

  const loadDetail = useCallback((actorId: string) => {
    setDetail(null);
    fetch(`/api/backoffice/network-strikes?actorId=${actorId}`).then((r) => r.json()).then((body) => {
      if (body.ok) setDetail(body.strikes ?? []);
    }).catch(() => setDetail([]));
  }, []);

  function toggleActor(actorId: string) {
    if (openActorId === actorId) { setOpenActorId(null); setDetail(null); return; }
    setOpenActorId(actorId);
    loadDetail(actorId);
  }

  async function act(payload: Record<string, unknown>, actorId: string) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/backoffice/network-strikes', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) { setErr(data.error ?? 'Failed.'); return; }
      setReason(''); setReasonFor(null);
      load();
      if (openActorId === actorId) loadDetail(actorId);
    } finally { setBusy(false); }
  }

  if (err && !rows) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!rows) return <p className="text-sm text-gray-400">Loading…</p>;
  if (!available) {
    return <p className="text-sm text-gray-400">My Network strike management activates once migration 0291 is applied.</p>;
  }

  const filtered = rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === 'active_strikes') return r.activeStrikes > 0;
    if (filter === 'banned') return r.banned;
    if (filter === 'appeal_pending') return r.pendingAppeals > 0;
    return true;
  });

  return (
    <Card title={`My Network strikes (${filtered.length}${q || filter !== 'all' ? ` of ${rows.length}` : ''})`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…"
          className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <div className="flex gap-1">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${filter === f ? 'bg-[#0E7490] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        <p className="ml-auto text-xs text-gray-500">3 strikes suspends My Network access — never the SherlockDeal account.</p>
      </div>
      {err && <p className="mb-2 text-xs text-[#B00000]">{err}</p>}

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400">No startup or investor currently has a strike or a My Network restriction.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-1.5 pr-3">Startup / actor</th>
                <th className="py-1.5 pr-3">Strikes</th>
                <th className="py-1.5 pr-3">Network status</th>
                <th className="py-1.5 pr-3">Appeal</th>
                <th className="py-1.5 pr-3">Last strike</th>
                <th className="py-1.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.actorId} className="border-t border-gray-50 align-top">
                  <td className="py-2 pr-3">
                    <button onClick={() => toggleActor(r.actorId)} className="font-medium text-gray-800 hover:text-[#0E7490] hover:underline">
                      {openActorId === r.actorId ? '▾ ' : '▸ '}{r.name}
                    </button>
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">{r.actorKind}</span>
                  </td>
                  <td className="pr-3">
                    <span className={`font-semibold ${r.activeStrikes > 0 ? 'text-[#B00000]' : 'text-gray-400'}`}>{r.activeStrikes}</span>
                    {r.totalStrikes > r.activeStrikes && (
                      <span className="ml-1 text-[10px] text-gray-400">({r.totalStrikes - r.activeStrikes} reversed)</span>
                    )}
                  </td>
                  <td className="pr-3">
                    {r.banned ? (
                      <>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-[#B00000]">Banned</span>
                        <span className="ml-1 text-[10px] text-gray-400">{fmt(r.suspendedAt)}</span>
                        {r.banNoLongerRequired && (
                          <span className="mt-1 block text-[10px] text-amber-700" title="Strikes were reversed below the threshold. The product has no auto-lift rule — lifting is a deliberate decision.">
                            below threshold — review
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700">Active</span>
                    )}
                  </td>
                  <td className="pr-3">
                    {r.pendingAppeals > 0
                      ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Appeal pending</span>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="pr-3 text-xs text-gray-400 whitespace-nowrap">{fmt(r.lastStrikeAt)}</td>
                  <td>
                    {r.banned ? (
                      <button disabled={busy} onClick={() => act({ action: 'lift_ban', actorId: r.actorId, reason: reasonFor === `ban:${r.actorId}` ? reason : undefined }, r.actorId)}
                        className="rounded-lg border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 whitespace-nowrap">
                        Lift Network ban
                      </button>
                    ) : (
                      <button disabled={busy} onClick={() => act({ action: 'apply_ban', actorId: r.actorId }, r.actorId)}
                        className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-medium text-[#B00000] hover:bg-red-50 disabled:opacity-40 whitespace-nowrap">
                        Ban from Network
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openActorId && (
        <div className="mt-4 rounded-lg border border-gray-200 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Strike history</p>
          {!detail ? <p className="text-sm text-gray-400">Loading…</p> : detail.length === 0 ? (
            <p className="text-sm text-gray-400">No strikes on record — any Network restriction here was applied directly.</p>
          ) : (
            <ul className="space-y-2">
              {detail.map((s) => (
                <li key={s.id} className="rounded-lg border border-gray-100 p-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.status === 'active' ? 'bg-red-100 text-[#B00000]' : 'bg-gray-100 text-gray-500'}`}>
                      {s.status === 'active' ? 'Active strike' : 'Reversed'}
                    </span>
                    <span className="text-gray-500">{s.appliedAt.slice(0, 16).replace('T', ' ')}</span>
                    {s.appliedByEmail && <span className="text-gray-400">by {s.appliedByEmail}</span>}
                    {s.contentRemoved && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">Content removed</span>}
                    {s.appeal && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.appeal.status === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
                        Appeal {s.appeal.status}
                      </span>
                    )}
                    <Link href={`/backoffice/support/${s.ticketId}`} className="ml-auto text-[11px] text-[#0E7490] hover:underline">
                      Open moderation case →
                    </Link>
                  </div>

                  {s.contentPreview && (
                    <p className="mt-1.5 whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700">
                      {s.contentPreview.length > 400 ? `${s.contentPreview.slice(0, 400)}…` : s.contentPreview}
                      {s.contentCreatedAt && <span className="mt-1 block text-[10px] text-gray-400">Posted {fmt(s.contentCreatedAt)}{s.postRemovedAt ? ` · removed ${fmt(s.postRemovedAt)}` : ''}</span>}
                    </p>
                  )}

                  {s.status === 'reversed' && (
                    <p className="mt-1 text-[11px] text-gray-500">
                      Reversed {fmt(s.reversedAt)}{s.reversedByEmail && ` by ${s.reversedByEmail}`}
                      {s.reversalReason && ` — ${s.reversalReason}`}
                    </p>
                  )}

                  {s.appeal && (
                    <div className="mt-2 rounded border border-amber-100 bg-amber-50 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Appeal · submitted {fmt(s.appeal.createdAt)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-amber-900">{s.appeal.body}</p>
                      {s.appeal.status === 'pending' ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button disabled={busy} onClick={() => act({ action: 'decide_appeal', appealId: s.appeal!.id, outcome: 'upheld', note: reasonFor === `appeal:${s.appeal!.id}` ? reason : undefined }, openActorId)}
                            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                            Uphold strike
                          </button>
                          <button disabled={busy} onClick={() => act({ action: 'decide_appeal', appealId: s.appeal!.id, outcome: 'reversed', note: reasonFor === `appeal:${s.appeal!.id}` ? reason : undefined }, openActorId)}
                            className="rounded-lg bg-[#0E7490] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40">
                            Reverse strike
                          </button>
                          <input value={reasonFor === `appeal:${s.appeal.id}` ? reason : ''}
                            onFocus={() => setReasonFor(`appeal:${s.appeal!.id}`)}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Internal note (optional)"
                            className="min-w-[12rem] flex-1 rounded border border-amber-200 px-2 py-1 text-[11px]" />
                        </div>
                      ) : (
                        <p className="mt-1 text-[10px] text-amber-700">
                          Decided {fmt(s.appeal.decidedAt)}{s.appeal.decisionNote && ` — ${s.appeal.decisionNote}`}
                        </p>
                      )}
                    </div>
                  )}

                  {s.status === 'active' && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button disabled={busy} onClick={() => act({ action: 'reverse_strike', strikeId: s.id, reason: reasonFor === `strike:${s.id}` ? reason : undefined }, openActorId)}
                        className="rounded-lg border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                        Reverse strike
                      </button>
                      <input value={reasonFor === `strike:${s.id}` ? reason : ''}
                        onFocus={() => setReasonFor(`strike:${s.id}`)}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Internal reason (optional) — e.g. strike applied to wrong post"
                        className="min-w-[16rem] flex-1 rounded border border-gray-200 px-2 py-1 text-[11px]" />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-gray-400">
            Reversing a strike recomputes the count but never lifts an existing My Network ban — the two are separate states and
            lifting one is its own decision. Nothing here is deleted: reversals are recorded alongside the original action.
          </p>
        </div>
      )}
    </Card>
  );
}
