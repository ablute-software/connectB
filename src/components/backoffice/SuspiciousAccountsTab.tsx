'use client';
// Prompt 244/245 — Backoffice "Suspicious accounts" queue: manual flagging
// by developers (NOT automatic detection — confirmed explicitly by Nuno),
// evidence with links back to the concrete rows behind it, and three
// actions (alert email / suspend for a chosen duration / delete + block
// email — see SuspiciousFlagActions.tsx). Extracted into its own file
// rather than inlined in queue/page.tsx (unlike the smaller existing tabs
// there) — that file is already ~1100 lines and this feature (create form +
// evidence refs + three actions + per-flag history) is substantial enough
// to warrant its own module, same as ArchivePanel/InvestorActionsPanel
// elsewhere in the backoffice/workspace surfaces.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { SuspiciousFlagActions } from './SuspiciousFlagActions';
import type { ModerationTargetType } from '@/lib/account-moderation';

interface EvidenceRef { table: string; id: string; note?: string }

interface Flag {
  id: string; targetType: ModerationTargetType; targetId: string; companyName: string;
  email: string | null; accountCreatedAt: string | null; evidence: string; evidenceRefs: EvidenceRef[];
  flaggedBy: string; flaggedAt: string; status: 'pending' | 'actioned';
}

interface FlagAction {
  id: string; actionType: 'alert_email' | 'suspend' | 'delete_and_block';
  suspendHours: number | null; emailId: string | null; actor: string; createdAt: string; notes: string | null;
}

const ACTION_LABEL: Record<FlagAction['actionType'], string> = {
  alert_email: 'Alert email sent', suspend: 'Suspended', delete_and_block: 'Deleted + email blocked',
};

function emptyRef(): EvidenceRef { return { table: '', id: '', note: '' }; }

function NewFlagForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [targetType, setTargetType] = useState<ModerationTargetType>('org');
  const [targetId, setTargetId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [accountCreatedAt, setAccountCreatedAt] = useState('');
  const [evidence, setEvidence] = useState('');
  const [refs, setRefs] = useState<EvidenceRef[]>([emptyRef()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function updateRef(i: number, patch: Partial<EvidenceRef>) {
    setRefs((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    if (!targetId.trim() || !companyName.trim() || !evidence.trim()) {
      setErr('Target ID, company name, and evidence are required.'); return;
    }
    setBusy(true); setErr('');
    const res = await fetch('/api/backoffice/suspicious-flags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetType, targetId: targetId.trim(), companyName: companyName.trim(),
        email: email.trim() || undefined,
        accountCreatedAt: accountCreatedAt ? new Date(accountCreatedAt).toISOString() : undefined,
        evidence: evidence.trim(),
        evidenceRefs: refs.filter((r) => r.table.trim() && r.id.trim()),
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!body.ok) { setErr(body.error); return; }
    onCreated();
  }

  return (
    <Card title="New flag">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-gray-500">
          Target type
          <select value={targetType} onChange={(e) => setTargetType(e.target.value as ModerationTargetType)}
            className="mt-0.5 block w-full rounded border border-gray-200 p-1.5 text-sm">
            <option value="org">Startup (org)</option>
            <option value="investor">Investor (catalog_entities)</option>
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Target ID (uuid — from your investigation)
          <input value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="e.g. the orgs.id or catalog_entities.id"
            className="mt-0.5 block w-full rounded border border-gray-200 p-1.5 text-sm" />
        </label>
        <label className="text-xs text-gray-500">
          Company name
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
            className="mt-0.5 block w-full rounded border border-gray-200 p-1.5 text-sm" />
        </label>
        <label className="text-xs text-gray-500">
          Email (needed for the alert-email / delete+block actions)
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
            className="mt-0.5 block w-full rounded border border-gray-200 p-1.5 text-sm" />
        </label>
        <label className="text-xs text-gray-500">
          Account created at
          <input value={accountCreatedAt} onChange={(e) => setAccountCreatedAt(e.target.value)} type="datetime-local"
            className="mt-0.5 block w-full rounded border border-gray-200 p-1.5 text-sm" />
        </label>
      </div>

      <label className="mt-3 block text-xs text-gray-500">
        Evidence (free text)
        <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={4}
          placeholder="What did you find, and why does it look suspicious?"
          className="mt-0.5 block w-full rounded border border-gray-200 p-1.5 text-sm" />
      </label>

      <div className="mt-3">
        <p className="text-xs text-gray-500">References to concrete rows (table + id, e.g. deal_messages / interactions / investor_relationship_decisions)</p>
        <div className="mt-1 space-y-1.5">
          {refs.map((r, i) => (
            <div key={i} className="flex flex-wrap gap-1.5">
              <input value={r.table} onChange={(e) => updateRef(i, { table: e.target.value })} placeholder="table"
                className="w-36 rounded border border-gray-200 p-1 text-xs" />
              <input value={r.id} onChange={(e) => updateRef(i, { id: e.target.value })} placeholder="row id"
                className="w-56 rounded border border-gray-200 p-1 text-xs" />
              <input value={r.note ?? ''} onChange={(e) => updateRef(i, { note: e.target.value })} placeholder="note (optional)"
                className="flex-1 rounded border border-gray-200 p-1 text-xs" />
              <button onClick={() => setRefs((prev) => prev.filter((_, idx) => idx !== i))} className="text-xs text-gray-400 hover:underline">Remove</button>
            </div>
          ))}
        </div>
        <button onClick={() => setRefs((prev) => [...prev, emptyRef()])} className="mt-1 text-xs text-[#0E7490] hover:underline">+ Add reference</button>
      </div>

      {err && <p className="mt-2 text-sm text-[#B00000]">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button disabled={busy} onClick={() => void submit()}
          className="rounded bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? 'Saving…' : 'Create flag'}
        </button>
        <button onClick={onCancel} className="rounded border border-gray-300 px-3 py-1.5 text-sm">Cancel</button>
      </div>
    </Card>
  );
}

function FlagDetail({ flag, onChanged }: { flag: Flag; onChanged: () => void }) {
  const [actions, setActions] = useState<FlagAction[] | null>(null);

  function refresh() {
    fetch(`/api/backoffice/suspicious-flags/${flag.id}`).then((r) => r.json()).then((body) => {
      if (body.ok) setActions(body.actions);
    });
  }
  useEffect(refresh, [flag.id]);

  return (
    <div className="space-y-2 rounded-lg bg-gray-50 p-3">
      <p className="whitespace-pre-wrap text-sm text-gray-700">{flag.evidence}</p>
      {flag.evidenceRefs.length > 0 && (
        <ul className="space-y-0.5 text-xs text-gray-500">
          {flag.evidenceRefs.map((r, i) => (
            <li key={i}>
              <code className="rounded bg-gray-100 px-1 py-0.5">{r.table}:{r.id}</code>
              {r.note ? ` — ${r.note}` : ''}
            </li>
          ))}
        </ul>
      )}
      <SuspiciousFlagActions flagId={flag.id} hasEmail={!!flag.email} onChanged={() => { refresh(); onChanged(); }} />
      {actions && actions.length > 0 && (
        <div className="border-t border-gray-200 pt-2">
          <p className="text-[11px] font-semibold uppercase text-gray-400">Action history</p>
          <ul className="mt-1 space-y-1">
            {actions.map((a) => (
              <li key={a.id} className="text-xs text-gray-600">
                <span className="font-medium">{ACTION_LABEL[a.actionType]}</span>
                {a.suspendHours ? ` (${a.suspendHours}h)` : ''}
                {' — '}{a.actor} · {new Date(a.createdAt).toLocaleString()}
                {a.notes && <div className="text-gray-500">{a.notes}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function SuspiciousAccountsTab() {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  function refresh() {
    fetch('/api/backoffice/suspicious-flags').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setFlags(body.flags);
    });
  }
  useEffect(refresh, []);

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      <div className="flex justify-end">
        {!showForm && <button onClick={() => setShowForm(true)} className="text-sm text-[#0E7490] hover:underline">+ Flag an account</button>}
      </div>
      {showForm && <NewFlagForm onCreated={() => { setShowForm(false); refresh(); }} onCancel={() => setShowForm(false)} />}

      <Card title={`Flags (${flags?.length ?? 0})`}>
        {!flags ? <p className="text-sm text-gray-400">Loading…</p> : flags.length === 0 ? (
          <p className="text-sm text-gray-400">No suspicious accounts flagged yet.</p>
        ) : (
          <ul className="space-y-2">
            {flags.map((f) => (
              <li key={f.id} className="rounded-lg border border-gray-100">
                <button onClick={() => setOpenId(openId === f.id ? null : f.id)}
                  className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                  <span className="font-medium">{f.companyName}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase text-gray-500">{f.targetType}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${f.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {f.status}
                  </span>
                  {f.email && <span className="text-xs text-gray-400">{f.email}</span>}
                  <span className="ml-auto text-xs text-gray-400">
                    flagged by {f.flaggedBy} · {new Date(f.flaggedAt).toLocaleString()}
                  </span>
                </button>
                {openId === f.id && (
                  <div className="border-t border-gray-100 px-3 py-2">
                    <FlagDetail flag={f} onChanged={refresh} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
