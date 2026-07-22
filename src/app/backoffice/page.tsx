'use client';
// Back-office — platform-admin view (developers): contributions queue
// (§1b, aggregated across every org), submission review queue, global
// catalog with verification state, and the distribution log (which
// investors were delivered to which orgs — prevents duplicate sends).
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';

type Contribution = {
  id: string; subject_type: 'entity' | 'person'; subject_name: string; org_name: string;
  field: string; value: unknown; note: string | null; status: 'submitted' | 'verified' | 'rejected';
  created_at: string; reviewer_notes: string | null;
};

function ContributionsCard() {
  const [items, setItems] = useState<Contribution[] | null>(null);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  function refresh() {
    fetch('/api/backoffice/contributions').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setItems(body.contributions);
    });
  }
  useEffect(refresh, []);

  async function review(id: string, decision: 'verified' | 'rejected') {
    await fetch(`/api/backoffice/contributions/${id}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, notes: notes[id] }),
    });
    refresh();
  }

  if (err) return <Card title="Contributions"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!items) return <Card title="Contributions"><p className="text-sm text-gray-400">Loading…</p></Card>;

  const pending = items.filter((c) => c.status === 'submitted');
  const reviewed = items.filter((c) => c.status !== 'submitted');

  // Grouped by subject so "14 startups say X's email is Y" reads as one cluster.
  const groups = new Map<string, Contribution[]>();
  for (const c of pending) {
    const key = `${c.subject_type}:${c.subject_name}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  return (
    <Card title={`Contributions — cross-org queue (${pending.length})`}>
      <p className="mb-3 text-xs text-gray-500">
        Authored edits from every org's own "Add info," aggregated by subject. Verifying just confirms accuracy today —
        a shared public catalog for entities/people (auto-flowing to every org) is a later phase.
      </p>
      {groups.size === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
        <div className="space-y-3">
          {[...groups.entries()].map(([key, list]) => (
            <div key={key} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="mb-1.5 text-sm font-semibold">{list[0].subject_name} <span className="font-normal text-gray-400">({list[0].subject_type})</span></div>
              <ul className="space-y-1.5">
                {list.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{c.field}:</span> {String(c.value)}
                    <span className="text-xs text-gray-400">by {c.org_name} · {c.created_at.slice(0, 10)}</span>
                    {c.note && <span className="text-xs text-gray-500">— {c.note}</span>}
                    <input placeholder="Reviewer notes" value={notes[c.id] ?? ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                      className="ml-auto min-w-[160px] rounded border border-gray-200 px-2 py-1 text-xs" />
                    <button onClick={() => review(c.id, 'verified')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800">Verify</button>
                    <button onClick={() => review(c.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50">Reject</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {reviewed.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-400">Review history ({reviewed.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {reviewed.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className={`rounded-full px-1.5 py-0.5 font-semibold ${c.status === 'verified' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{c.status}</span>
                <span>{c.subject_name} — {c.field}: {String(c.value)}</span>
                <span className="text-gray-400">by {c.org_name}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

export default function BackofficePage() {
  const { db, reviewSubmission } = useStore();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const queue = db.submissions.filter((s) => s.status === 'pending_review');
  const history = db.submissions.filter((s) => s.status !== 'pending_review');

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold">Back-office</h1>
        <span className="rounded-full bg-gray-900 px-2.5 py-0.5 text-[11px] font-semibold text-white">platform admin</span>
      </div>
      <p className="max-w-2xl text-sm text-gray-500">
        Founder-submitted investors arrive here. Verify existence and factuality before merging into the global
        catalog — only <b>verified</b> entries can be distributed in packs. The distribution log below guarantees the
        same investor is never delivered twice to the same founder.
      </p>

      <ContributionsCard />

      <Card title={`Review queue (${queue.length})`}>
        {queue.length === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
          <ul className="space-y-3">
            {queue.map((s) => (
              <li key={s.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{s.payload.name}</span>
                  <span className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500">{s.payload.type.replace('_', ' ')}</span>
                  <span className="text-xs text-gray-400">{s.payload.hq_city}{s.payload.hq_country ? `, ${s.payload.hq_country}` : ''}</span>
                  {s.payload.website && <a href={s.payload.website} target="_blank" className="text-xs text-[#0E7490] hover:underline">{s.payload.website.replace('https://', '')}</a>}
                  <span className="ml-auto text-[11px] text-gray-400">by <b>{s.submitted_by}</b> · {s.created_at.slice(0, 10)}</span>
                </div>
                {s.payload.sectors.length > 0 && (
                  <div className="mt-1.5 flex gap-1">
                    {s.payload.sectors.map((x) => <span key={x} className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500">{x}</span>)}
                  </div>
                )}
                {s.payload.notes && <p className="mt-2 text-xs text-gray-500">Submitter notes: {s.payload.notes}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <input placeholder="Reviewer notes (source checked, corrections…)" value={notes[s.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })}
                    className="min-w-[240px] flex-1 rounded-xl border border-gray-200 px-3 py-1.5 text-sm" />
                  <button onClick={() => reviewSubmission(s.id, 'approved', notes[s.id])}
                    className="rounded-xl bg-green-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-800">
                    Verify & merge to catalog
                  </button>
                  <button onClick={() => reviewSubmission(s.id, 'rejected', notes[s.id])}
                    className="rounded-xl border border-red-200 px-3 py-1.5 text-sm text-[#B00000] hover:bg-red-50">
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Global catalog (${db.catalog.length})`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-1.5">Investor</th><th>Type</th><th>HQ</th><th>Status</th><th>Source</th><th>Verified</th>
            </tr>
          </thead>
          <tbody>
            {db.catalog.map((c) => (
              <tr key={c.id} className="border-t border-gray-50">
                <td className="py-2 font-medium">{c.name}</td>
                <td className="text-gray-500">{c.type.replace('_', ' ')}</td>
                <td className="text-gray-500">{c.hq_city}, {c.hq_country}</td>
                <td>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    c.verification_status === 'verified' ? 'bg-green-50 text-green-700'
                    : c.verification_status === 'pending' ? 'bg-amber-50 text-amber-700'
                    : 'bg-red-50 text-red-700'}`}>
                    {c.verification_status}
                  </span>
                </td>
                <td className="text-xs text-gray-500">{c.source === 'team' ? 'team' : 'founder submission'}</td>
                <td className="text-xs text-gray-400">{c.verified_at?.slice(0, 10) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Distribution log — who received what">
        {db.unlocks.length === 0 ? (
          <p className="text-sm text-gray-400">No deliveries yet. Every pack unlock is recorded here per org and per investor.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-1.5">Date</th><th>Org</th><th>Pack</th><th>Investors delivered</th>
              </tr>
            </thead>
            <tbody>
              {db.unlocks.map((u) => (
                <tr key={u.id} className="border-t border-gray-50 align-top">
                  <td className="py-2 text-xs text-gray-400">{u.unlocked_at.slice(0, 10)}</td>
                  <td className="text-xs font-medium">{db.org.name}</td>
                  <td className="text-xs">{db.packs.find((p) => p.id === u.pack_id)?.name}</td>
                  <td className="text-xs text-gray-600">
                    {u.delivered_catalog_ids.map((cid) => db.catalog.find((c) => c.id === cid)?.name).join(' · ') || '— (all already owned)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] text-gray-400">
          Delivery is idempotent: an investor already delivered (or already in the org’s pipeline) is skipped on unlock.
        </p>
      </Card>

      {history.length > 0 && (
        <Card title="Review history">
          <ul className="space-y-1.5 text-sm">
            {history.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.status === 'merged' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{s.status}</span>
                <span className="font-medium">{s.payload.name}</span>
                <span className="text-xs text-gray-400">by {s.submitted_by} · {s.reviewed_at?.slice(0, 10)}</span>
                {s.reviewer_notes && <span className="text-xs text-gray-500">— {s.reviewer_notes}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
