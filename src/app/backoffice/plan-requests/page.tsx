'use client';
// PLAN-02/03 — Private Detective (4th investor plan) contact requests.
// Own section, per spec: New -> Under review -> Contacted -> Proposal sent
// -> Converted -> Closed, with internal notes.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface Request {
  id: string; created_at: string; first_name: string; last_name: string; email: string;
  investor_type: string; firm_name: string; message: string; firm_website: string | null;
  linkedin: string | null; status: string; internal_notes: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  new: 'New', under_review: 'Under review', contacted: 'Contacted',
  proposal_sent: 'Proposal sent', converted: 'Converted', closed: 'Closed',
};

export default function PlanRequestsPage() {
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [err, setErr] = useState('');
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch('/api/backoffice/plan-requests').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setRequests(body.requests);
    });
  }
  useEffect(load, []);

  async function updateStatus(id: string, status: string) {
    setBusyId(id);
    try {
      await fetch('/api/backoffice/plan-requests', {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, status }),
      });
      load();
    } finally { setBusyId(null); }
  }

  async function saveNotes(id: string) {
    setBusyId(id);
    try {
      await fetch('/api/backoffice/plan-requests', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, internal_notes: notesDraft[id] ?? '' }),
      });
      load();
    } finally { setBusyId(null); }
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Private Detective requests</h1>
      <Card title={requests ? `Requests (${requests.length})` : 'Requests'}>
        {!requests ? <p className="text-sm text-gray-400">Loading…</p> : requests.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing here.</p>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <div key={r.id} className="rounded-lg border border-gray-100 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-gray-800">{r.first_name} {r.last_name} · {r.firm_name}</div>
                    <div className="text-xs text-gray-400">{r.email} · {r.investor_type}</div>
                    {(r.firm_website || r.linkedin) && (
                      <div className="mt-0.5 text-xs text-gray-400">
                        {r.firm_website && <span>{r.firm_website}</span>}
                        {r.firm_website && r.linkedin && ' · '}
                        {r.linkedin && <span>{r.linkedin}</span>}
                      </div>
                    )}
                  </div>
                  <select value={r.status} disabled={busyId === r.id} onChange={(e) => updateStatus(r.id, e.target.value)}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
                    {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                <p className="mt-2 text-xs text-gray-600">{r.message}</p>
                <p className="mt-1 text-[11px] text-gray-400">Submitted {new Date(r.created_at).toLocaleString()}</p>
                <div className="mt-2 flex gap-2">
                  <input value={notesDraft[r.id] ?? r.internal_notes ?? ''} onChange={(e) => setNotesDraft({ ...notesDraft, [r.id]: e.target.value })}
                    placeholder="Internal notes…" className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
                  <button onClick={() => saveNotes(r.id)} disabled={busyId === r.id}
                    className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                    Save notes
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
