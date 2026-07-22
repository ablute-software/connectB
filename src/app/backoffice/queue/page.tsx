'use client';
// BLOCO 3 — Fila: the 4 review queues, tabbed, each pending→decided.
// Contributions/GDPR logic carried over from the pre-Bloco-3 backoffice
// page; Submissions/Claims are new tabs consolidating what used to be a
// separate founder-store-scoped "Review queue" section.
import { useEffect, useState } from 'react';
import { Card, Tooltip } from '@/components/ui';

type Tab = 'contributions' | 'submissions' | 'claims' | 'gdpr';

const TABS: { key: Tab; label: string }[] = [
  { key: 'contributions', label: 'Contributions' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'claims', label: 'Claims' },
  { key: 'gdpr', label: 'GDPR' },
];

type Contribution = {
  id: string; subject_type: 'entity' | 'person'; subject_name: string; org_name: string;
  field: string; value: unknown; note: string | null; status: 'submitted' | 'verified' | 'rejected';
  created_at: string; reviewer_notes: string | null;
  source: 'user' | 'ai'; confidence: number | null; source_url: string | null;
};

function ContributionsTab() {
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

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;

  const pending = items.filter((c) => c.status === 'submitted');
  const reviewed = items.filter((c) => c.status !== 'submitted');
  const groups = new Map<string, Contribution[]>();
  for (const c of pending) {
    const key = `${c.subject_type}:${c.subject_name}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  return (
    <Card title={`Contributions — cross-org (${pending.length})`}>
      <p className="mb-3 text-xs text-gray-500">
        Authored edits from every org's own "Add info," aggregated by subject, sources side by side.
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
                    {c.source === 'ai' ? (
                      <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-800">
                        ✨ AI {c.confidence != null ? `${Math.round(c.confidence * 100)}%` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">by {c.org_name} · {c.created_at.slice(0, 10)}</span>
                    )}
                    {c.source_url && <a href={c.source_url} target="_blank" rel="noreferrer" className="text-xs text-[#0E7490] hover:underline">source</a>}
                    {c.note && <span className="text-xs text-gray-500">— {c.note}</span>}
                    <input placeholder="Reviewer notes" value={notes[c.id] ?? ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                      className="ml-auto min-w-[160px] rounded border border-gray-200 px-2 py-1 text-xs" />
                    <Tooltip text="Marks this fact as confirmed true — verified facts are eligible for the shared catalog.">
                      <button onClick={() => review(c.id, 'verified')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800">Verify</button>
                    </Tooltip>
                    <Tooltip text="Discards this submitted fact — it stays out of the catalog.">
                      <button onClick={() => review(c.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50">Reject</button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {reviewed.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-400">Decided ({reviewed.length})</summary>
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

type Submission = {
  id: string; org_id: string; org_name: string; status: 'pending_review' | 'approved' | 'rejected' | 'merged';
  payload: { name: string; type: string; hq_city?: string; hq_country?: string; sectors: string[]; website?: string; notes?: string };
  reviewer_notes: string | null; created_at: string; reviewed_at: string | null;
};

function SubmissionsTab() {
  const [items, setItems] = useState<Submission[] | null>(null);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  function refresh() {
    fetch('/api/backoffice/submissions').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setItems(body.submissions);
    });
  }
  useEffect(refresh, []);

  async function review(id: string, decision: 'approved' | 'rejected') {
    await fetch(`/api/backoffice/submissions/${id}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, notes: notes[id] }),
    });
    refresh();
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;
  const pending = items.filter((s) => s.status === 'pending_review');
  const decided = items.filter((s) => s.status !== 'pending_review');

  return (
    <Card title={`Submissions — cross-org (${pending.length})`}>
      <p className="mb-3 text-xs text-gray-500">Founder-submitted investors. Approve merges into the global catalog (verified); only verified entries distribute via packs.</p>
      {pending.length === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
        <ul className="space-y-3">
          {pending.map((s) => (
            <li key={s.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{s.payload.name}</span>
                <span className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500">{s.payload.type.replace('_', ' ')}</span>
                <span className="text-xs text-gray-400">{s.payload.hq_city}{s.payload.hq_country ? `, ${s.payload.hq_country}` : ''}</span>
                {s.payload.website && <a href={s.payload.website} target="_blank" rel="noreferrer" className="text-xs text-[#0E7490] hover:underline">{s.payload.website.replace('https://', '')}</a>}
                <span className="ml-auto text-[11px] text-gray-400">by <b>{s.org_name}</b> · {s.created_at.slice(0, 10)}</span>
              </div>
              {s.payload.sectors?.length > 0 && (
                <div className="mt-1.5 flex gap-1">
                  {s.payload.sectors.map((x) => <span key={x} className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500">{x}</span>)}
                </div>
              )}
              {s.payload.notes && <p className="mt-2 text-xs text-gray-500">Submitter notes: {s.payload.notes}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <input placeholder="Reviewer notes" value={notes[s.id] ?? ''} onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })}
                  className="min-w-[240px] flex-1 rounded-xl border border-gray-200 px-3 py-1.5 text-sm" />
                <Tooltip text="Confirms this investor is real and adds it to the shared catalog every org can discover.">
                  <button onClick={() => review(s.id, 'approved')} className="rounded-xl bg-green-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-800">Verify & merge to catalog</button>
                </Tooltip>
                <Tooltip text="Declines this submission — it stays private to the submitting org only.">
                  <button onClick={() => review(s.id, 'rejected')} className="rounded-xl border border-red-200 px-3 py-1.5 text-sm text-[#B00000] hover:bg-red-50">Reject</button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}
      {decided.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-400">Decided ({decided.length})</summary>
          <ul className="mt-2 space-y-1.5 text-sm">
            {decided.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.status === 'approved' || s.status === 'merged' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{s.status}</span>
                <span className="font-medium">{s.payload.name}</span>
                <span className="text-xs text-gray-400">by {s.org_name} · {s.reviewed_at?.slice(0, 10)}</span>
                {s.reviewer_notes && <span className="text-xs text-gray-500">— {s.reviewer_notes}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

type Claim = {
  id: string; person_id: string | null; claimant_email: string; match_score: number | null;
  status: 'pending' | 'approved' | 'rejected'; created_at: string; resolved_at: string | null;
  personName: string | null; orgName: string | null;
};

function ClaimsTab() {
  const [items, setItems] = useState<Claim[] | null>(null);
  const [err, setErr] = useState('');

  function refresh() {
    fetch('/api/backoffice/claims').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setItems(body.claims);
    });
  }
  useEffect(refresh, []);

  async function resolve(id: string, decision: 'approved' | 'rejected') {
    await fetch(`/api/backoffice/claims/${id}/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
    });
    refresh();
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;
  const pending = items.filter((c) => c.status === 'pending');
  const decided = items.filter((c) => c.status !== 'pending');

  return (
    <Card title={`Profile claims (${pending.length})`}>
      <p className="mb-3 text-xs text-gray-500">
        LinkedIn self-claim (IRM_SPEC §5) — empty until LinkedIn OAuth is configured. Match score is the overlap between
        the LinkedIn account and the record shown to startups; only a high score should be approved.
      </p>
      {pending.length === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
        <ul className="space-y-2">
          {pending.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
              <span className="font-medium">{c.claimant_email}</span>
              {c.personName && <span className="text-xs text-gray-500">→ {c.personName} ({c.orgName})</span>}
              {c.match_score != null && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${c.match_score >= 0.95 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                  match {Math.round(c.match_score * 100)}%
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <Tooltip text="Confirms this LinkedIn account is the same person as the record — grants them self-claim access.">
                  <button onClick={() => resolve(c.id, 'approved')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800">Approve</button>
                </Tooltip>
                <Tooltip text="Declines the claim — the match score or evidence wasn't convincing enough.">
                  <button onClick={() => resolve(c.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50">Reject</button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}
      {decided.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-400">Decided ({decided.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {decided.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className={`rounded-full px-1.5 py-0.5 font-semibold ${c.status === 'approved' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{c.status}</span>
                <span>{c.claimant_email}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

type GdprRequest = {
  id: string; person_id: string | null; claimant_name: string | null; claimant_email: string;
  kind: 'rectify' | 'erase'; details: string | null; status: 'pending' | 'resolved' | 'rejected';
  created_at: string; resolved_at: string | null;
  matches: { personId: string; name: string; orgName: string }[];
};

const GDPR_DEADLINE_DAYS = 30;

function daysLeft(createdAt: string): number {
  const deadline = new Date(createdAt).getTime() + GDPR_DEADLINE_DAYS * 24 * 60 * 60 * 1000;
  return Math.ceil((deadline - Date.now()) / (24 * 60 * 60 * 1000));
}

function GdprTab() {
  const [items, setItems] = useState<GdprRequest[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  function refresh() {
    fetch('/api/backoffice/gdpr').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setItems(body.requests);
    });
  }
  useEffect(refresh, []);

  async function resolve(id: string, decision: 'resolved' | 'rejected') {
    setBusy(id);
    await fetch(`/api/backoffice/gdpr/${id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) });
    setBusy(null); refresh();
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;
  const pending = items.filter((r) => r.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const past = items.filter((r) => r.status !== 'pending');
  const overdueCount = pending.filter((r) => daysLeft(r.created_at) <= 7).length;

  return (
    <Card title={`GDPR / RGPD requests (${pending.length})`} tint={overdueCount > 0 ? 'red' : undefined}>
      <p className="mb-3 text-xs text-gray-500">
        Legal deadline is {GDPR_DEADLINE_DAYS} days from submission. "Erase" nulls PII on every matched people row across every org.
      </p>
      {pending.length === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
        <ul className="space-y-2">
          {pending.map((r) => {
            const left = daysLeft(r.created_at);
            const deadlineClass = left <= 7 ? 'text-[#B00000] font-semibold' : left <= 14 ? 'text-amber-600 font-semibold' : 'text-gray-400';
            return (
              <li key={r.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.kind === 'erase' ? 'bg-red-100 text-red-800' : 'bg-cyan-100 text-cyan-800'}`}>{r.kind}</span>
                  <span className="font-medium">{r.claimant_name || r.claimant_email}</span>
                  <span className="text-xs text-gray-400">{r.claimant_email}</span>
                  <span className={`ml-auto text-xs ${deadlineClass}`}>{left < 0 ? `${-left}d overdue` : `${left}d left`}</span>
                </div>
                {r.details && <p className="mt-1 text-xs text-gray-600">{r.details}</p>}
                <div className="mt-1 text-xs text-gray-400">
                  {r.matches.length === 0 ? 'No matching record found by email — link manually if needed.' : `Matches: ${r.matches.map((m) => `${m.name} (${m.orgName})`).join(', ')}`}
                </div>
                <div className="mt-2 flex gap-2">
                  <Tooltip text={r.kind === 'erase' ? 'Nulls out PII on every matched person record across every org — irreversible.' : 'Marks this rectification request as handled.'}>
                    <button disabled={busy === r.id} onClick={() => resolve(r.id, 'resolved')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-40">
                      {r.kind === 'erase' ? 'Erase & resolve' : 'Mark resolved'}
                    </button>
                  </Tooltip>
                  <Tooltip text="Declines the request — no data is changed.">
                    <button disabled={busy === r.id} onClick={() => resolve(r.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50 disabled:opacity-40">Reject</button>
                  </Tooltip>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {past.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-400">Decided ({past.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {past.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className={`rounded-full px-1.5 py-0.5 font-semibold ${r.status === 'resolved' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{r.status}</span>
                <span>{r.kind} — {r.claimant_email}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

export default function BackofficeQueuePage() {
  const [tab, setTab] = useState<Tab>('contributions');
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Fila</h1>
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium ${tab === t.key ? 'border-b-2 border-[#0E7490] text-[#0E7490]' : 'text-gray-400 hover:text-gray-600'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'contributions' && <ContributionsTab />}
      {tab === 'submissions' && <SubmissionsTab />}
      {tab === 'claims' && <ClaimsTab />}
      {tab === 'gdpr' && <GdprTab />}
    </div>
  );
}
