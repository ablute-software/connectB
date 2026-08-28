'use client';
// Prompt 421 §E — confirmed multi-seat-per-firm IS a real concept here
// (matchdeal_investor_members has a `unique(user_id, catalog_entity_id)`
// constraint, not one-row-per-firm — the same shape org_members uses on
// the founder side). What's DIFFERENT from the founder side, and the
// reason this doesn't mirror TeamPanel's email-invite flow: a colleague
// joins by searching for the firm and linking themselves (LinkEntityFlow,
// InvestorProfilePanel.tsx — domain-verified or admin-reviewed), the same
// self-serve flow every investor already goes through. Building a SECOND,
// parallel invite-by-email mechanism would fragment how people join
// without solving a real gap, so "adding" a colleague here is instructions
// pointing at that existing flow, not a new one. What IS new and genuinely
// useful: seeing each colleague's role and revoking access for someone who
// left the firm — ColleaguesCard was read-only for both.
import { useEffect, useState } from 'react';

interface Colleague { id: string; email: string; name: string | null; role: string | null }

export function AppAccessTab() {
  const [entityName, setEntityName] = useState<string | null>(null);
  const [colleagues, setColleagues] = useState<Colleague[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  function load() {
    fetch('/api/portal/colleagues').then((r) => r.json()).then((d) => {
      setEntityName(d.linked ? d.entityName ?? null : null);
      setColleagues(d.linked ? d.colleagues : []);
    });
  }
  useEffect(load, []);

  async function revoke(id: string) {
    setRevokingId(id); setErr('');
    try {
      const res = await fetch('/api/portal/colleagues/revoke', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: id }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not revoke.'); return; }
      load();
    } finally { setRevokingId(null); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Your team on Sherlock Deal</h2>
        {colleagues === null ? (
          <p className="mt-2 text-xs text-gray-400">Loading…</p>
        ) : colleagues.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">No other colleagues from your firm have joined yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {colleagues.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">{c.name ?? c.email}</span>
                  {c.name && <span className="ml-2 text-xs text-gray-400">{c.email}</span>}
                  {c.role && <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{c.role}</span>}
                </div>
                <button onClick={() => revoke(c.id)} disabled={revokingId === c.id}
                  className="shrink-0 text-xs text-gray-400 hover:text-[#B00000] disabled:opacity-40">
                  {revokingId === c.id ? 'Revoking…' : 'Revoke access'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
      </div>

      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-xs text-gray-500">
        <h3 className="text-xs font-semibold text-gray-700">Adding a colleague</h3>
        <p className="mt-1">
          There&apos;s no separate invite step — a colleague signs up on Sherlock Deal and searches for{' '}
          <b>{entityName ?? 'your firm'}</b> the same way you did. If their sign-in email matches your firm&apos;s
          domain, they&apos;re linked automatically; otherwise it&apos;s reviewed and approved shortly.
        </p>
      </div>
    </div>
  );
}
