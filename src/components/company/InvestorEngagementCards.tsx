'use client';
// Investor Workspace Fase 3 (prompt 56) — founder-side surfaces for Q&A,
// round updates, and soft commits. Three compact cards rather than a
// separate page: this is Company-tab-adjacent, day-to-day founder work,
// same home as the data room checklist (Prompt 55).
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface Question { id: string; question: string; answer: string | null; is_faq: boolean; asked_by_email: string; created_at: string }
interface Update { id: string; title: string; body: string; created_at: string }
interface SoftCommit { id: string; investor_email: string; amount_eur: number; confirmed_by_founder: boolean; created_at: string }
interface InvestorDecision { id: string; decision: 'interested' | 'passed'; reasonDetail: string | null; decidedAt: string; investorName: string }

function fmtEur(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

export function InvestorQACard() {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch('/api/org/questions').then((r) => r.json()).then((d) => setQuestions(d.questions ?? []));
  }
  useEffect(load, []);

  async function answer(id: string) {
    const answerText = drafts[id]?.trim();
    if (!answerText) return;
    setBusyId(id);
    try {
      await fetch('/api/org/questions', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, answer: answerText }),
      });
      load();
    } finally { setBusyId(null); }
  }

  async function toggleFaq(id: string, isFaq: boolean) {
    setBusyId(id);
    try {
      await fetch('/api/org/questions', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, is_faq: !isFaq }),
      });
      load();
    } finally { setBusyId(null); }
  }

  if (questions === null) return null;

  return (
    <Card title="Investor Q&A">
      {questions.length === 0 ? (
        <p className="text-xs text-gray-400">No questions yet.</p>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => (
            <div key={q.id} className="rounded-lg border border-gray-100 p-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                {q.question}
                {q.is_faq && <span className="rounded-full bg-[#E8F4F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#0E7490]">FAQ</span>}
              </div>
              <p className="mt-0.5 text-[11px] text-gray-400">{q.asked_by_email} · {new Date(q.created_at).toLocaleDateString()}</p>
              {q.answer ? (
                <p className="mt-1.5 text-xs text-gray-600">{q.answer}</p>
              ) : (
                <div className="mt-1.5 flex gap-2">
                  <input value={drafts[q.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [q.id]: e.target.value })}
                    placeholder="Write an answer…" className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
                  <button onClick={() => answer(q.id)} disabled={busyId === q.id}
                    className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Reply</button>
                </div>
              )}
              {q.answer && (
                <button onClick={() => toggleFaq(q.id, q.is_faq)} disabled={busyId === q.id}
                  className="mt-1.5 text-[11px] text-gray-400 hover:underline">
                  {q.is_faq ? 'Remove from FAQ' : 'Promote to FAQ'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function RoundUpdatesCard() {
  const [updates, setUpdates] = useState<Update[] | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastEmailed, setLastEmailed] = useState<number | null>(null);

  function load() {
    fetch('/api/org/updates').then((r) => r.json()).then((d) => setUpdates(d.updates ?? []));
  }
  useEffect(load, []);

  async function publish() {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/org/updates', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      const data = await res.json();
      if (data.ok) { setTitle(''); setBody(''); setLastEmailed(data.emailedCount ?? 0); load(); }
    } finally { setSaving(false); }
  }

  return (
    <Card title="Round updates">
      <div className="space-y-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Update title"
          className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="What's new since last time…"
          className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
        <button onClick={publish} disabled={saving || !title.trim() || !body.trim()}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {saving ? 'Publishing…' : 'Publish to investors'}
        </button>
        {lastEmailed != null && <p className="text-[11px] text-gray-400">Emailed {lastEmailed} investor{lastEmailed === 1 ? '' : 's'}.</p>}
      </div>
      {updates && updates.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          {updates.map((u) => (
            <div key={u.id} className="text-xs">
              <span className="font-medium text-gray-700">{u.title}</span>
              <span className="ml-2 text-gray-400">{new Date(u.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// AP-11 — every Interested/Pass an investor records on this org's Pipeline
// card, with the free-text reason for a Pass. Org-level (AP-14): whichever
// teammate on the investor's side decided, this is the one decision the
// founder sees — there's no per-teammate view to reconcile.
export function InvestorDecisionsCard() {
  const [decisions, setDecisions] = useState<InvestorDecision[] | null>(null);

  useEffect(() => {
    fetch('/api/org/investor-decisions').then((r) => r.json()).then((d) => setDecisions(d.decisions ?? []));
  }, []);

  if (!decisions || decisions.length === 0) return null;

  return (
    <Card title="Investor decisions">
      <div className="space-y-2">
        {decisions.map((d) => (
          <div key={d.id} className="rounded-lg border border-gray-100 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-800">{d.investorName}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${d.decision === 'passed' ? 'bg-gray-100 text-gray-500' : 'bg-[#E8F4F8] text-[#0E7490]'}`}>
                {d.decision === 'passed' ? 'Passed' : 'Interested'}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-400">{new Date(d.decidedAt).toLocaleDateString()}</p>
            {d.reasonDetail && <p className="mt-1.5 text-xs text-gray-600">{d.reasonDetail}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

// P136 — the disclosure ladder's own founder-side approval surface. Level
// 3 (named-contact messaging + a data-room request) is the one step in the
// ladder that needs a human decision — level 2 is frictionless by design
// (see investor-interest-level.ts's own header). Lands here (Company tab,
// right alongside the read-only Investor decisions card) AND as a real
// task on the founder's own Today (see requestInterestLevel in
// investor-interest-level-db.ts) — two surfaces, one underlying row.
interface InterestLevelRequest {
  id: string; investorName: string; status: 'granted' | 'pending' | 'denied';
  requestedAt: string; decidedAt: string | null; note: string | null; shareDirectEmail: boolean;
}

export function InterestLevelRequestsCard() {
  const [requests, setRequests] = useState<InterestLevelRequest[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [shareEmailDraft, setShareEmailDraft] = useState<Record<string, boolean>>({});

  function load() {
    fetch('/api/founder/interest-level-requests').then((r) => r.json()).then((d) => setRequests(d.requests ?? []));
  }
  useEffect(load, []);

  async function decide(id: string, decision: 'granted' | 'denied') {
    setBusyId(id);
    try {
      await fetch('/api/founder/interest-level-requests', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, decision, note: noteDraft[id]?.trim() || undefined, shareDirectEmail: !!shareEmailDraft[id] }),
      });
      load();
    } finally { setBusyId(null); }
  }

  if (!requests || requests.length === 0) return null;
  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');

  return (
    <Card title="Contact requests">
      <div className="space-y-2">
        {pending.map((r) => (
          <div key={r.id} className="rounded-lg border border-gray-100 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-800">{r.investorName}</span>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Pending</span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-400">Requested {new Date(r.requestedAt).toLocaleDateString()}</p>
            <p className="mt-1.5 text-xs text-gray-600">Wants to message a named contact at your company and ask about data-room access.</p>
            <textarea value={noteDraft[r.id] ?? ''} onChange={(e) => setNoteDraft({ ...noteDraft, [r.id]: e.target.value })}
              rows={1} placeholder="Note (optional)" className="mt-2 w-full rounded-lg border border-gray-300 px-2 py-1 text-xs" />
            <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gray-500">
              <input type="checkbox" checked={!!shareEmailDraft[r.id]} onChange={(e) => setShareEmailDraft({ ...shareEmailDraft, [r.id]: e.target.checked })} />
              Also share our direct email with this firm
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button onClick={() => decide(r.id, 'granted')} disabled={busyId === r.id}
                className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Approve</button>
              <button onClick={() => decide(r.id, 'denied')} disabled={busyId === r.id}
                className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">Deny</button>
            </div>
          </div>
        ))}
        {decided.map((r) => (
          <div key={r.id} className="rounded-lg border border-gray-100 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-800">{r.investorName}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.status === 'granted' ? 'bg-[#E8F4F8] text-[#0E7490]' : 'bg-gray-100 text-gray-500'}`}>
                {r.status === 'granted' ? 'Granted' : 'Denied'}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-400">{r.decidedAt && new Date(r.decidedAt).toLocaleDateString()}{r.status === 'granted' && r.shareDirectEmail && ' · Direct email shared'}</p>
            {r.note && <p className="mt-1.5 text-xs text-gray-600">{r.note}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function SoftCommitsCard() {
  const [commits, setCommits] = useState<SoftCommit[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch('/api/org/soft-commits').then((r) => r.json()).then((d) => setCommits(d.commits ?? []));
  }
  useEffect(load, []);

  async function confirm(id: string, confirmed: boolean) {
    setBusyId(id);
    try {
      await fetch('/api/org/soft-commits', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, confirmed }),
      });
      load();
    } finally { setBusyId(null); }
  }

  if (!commits || commits.length === 0) return null;

  return (
    <Card title="Soft commits">
      <p className="mb-2 text-xs text-gray-400">Confirm the ones you trust — only confirmed amounts feed the round progress bar investors see.</p>
      <div className="space-y-1.5">
        {commits.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
            <div>
              <span className="font-medium text-gray-700">{c.investor_email}</span>
              <span className="ml-2 text-gray-500">{fmtEur(c.amount_eur)}</span>
            </div>
            <button onClick={() => confirm(c.id, !c.confirmed_by_founder)} disabled={busyId === c.id}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${c.confirmed_by_founder ? 'bg-[#E8F4F8] text-[#0E7490]' : 'border border-gray-200 text-gray-600'}`}>
              {c.confirmed_by_founder ? 'Confirmed' : 'Confirm'}
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}
