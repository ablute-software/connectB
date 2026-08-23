'use client';
// Prompt 330 — Pipeline's "Partners & colleagues" panel: the real estate
// max-w-[1600px] (shell.tsx, /pipeline only) leaves empty next to the
// table on wide screens, given real use. Reads from the SAME source
// /network's own "Your connections" list uses (GET /api/network,
// readConnectionsForActor/resolveActorDisplays in network-db.ts) — never a
// second, parallel connections list. Zero engagement counters, zero
// comparison between connections — same anti-ranking rule as the rest of
// My Network.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { authEnabled } from '@/lib/supabase';
import { NetworkAvatar } from '@/components/NetworkAvatar';

interface ConnectionRow { id: string; otherActorId: string; otherName: string; otherKind: 'founder' | 'investor'; originContext: string | null }

export function PartnersColleaguesPanel() {
  const [connections, setConnections] = useState<ConnectionRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function load() {
    if (!authEnabled) { setConnections([]); return; }
    fetch('/api/network').then((r) => r.json()).then((b) => setConnections(b.available ? b.connections : [])).catch(() => setConnections([]));
  }
  useEffect(load, []);

  function openAdd() {
    setAdding(true); setEmail(''); setMessage(''); setResult(null);
  }

  function submit() {
    setBusy(true); setResult(null);
    fetch('/api/network/invite-by-email', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), message: message.trim() }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setResult({ ok: false, text: b.error ?? 'Could not send the invite.' }); return; }
      if (b.found === false) { setResult({ ok: false, text: b.message }); return; }
      setResult({ ok: true, text: 'Invite sent — they need to accept before you\'re connected.' });
      setEmail(''); setMessage('');
    }).finally(() => setBusy(false));
  }

  return (
    <Card title="Partners & colleagues" right={
      !adding && <button onClick={openAdd} className="text-xs text-cyan-700 hover:underline">+ Add</button>
    }>
      {adding && (
        <div className="mb-3 space-y-1.5 border-b border-gray-100 pb-3">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
            placeholder="Their email on Sherlock Deal" className="w-full rounded-lg border border-gray-300 p-1.5 text-xs" />
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2}
            placeholder="How do you know them? (required — they'll see this)"
            className="w-full rounded-lg border border-gray-300 p-1.5 text-xs" />
          {result && (
            <p className={`text-[11px] ${result.ok ? 'text-emerald-700' : 'text-gray-500'}`}>{result.text}</p>
          )}
          <div className="flex gap-1.5">
            <button onClick={submit} disabled={busy || !email.trim() || !message.trim()}
              className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
              Send invite
            </button>
            <button onClick={() => setAdding(false)} className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600">Cancel</button>
          </div>
        </div>
      )}

      {!connections ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : connections.length === 0 ? (
        <p className="text-sm text-gray-400">No connections yet — see My Network to invite someone from shared context, or add a colleague by email above.</p>
      ) : (
        <ul className="space-y-2">
          {connections.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <NetworkAvatar name={c.otherName} kind={c.otherKind} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm text-gray-800">{c.otherName} <span className="text-[11px] font-normal text-gray-400">· {c.otherKind}</span></p>
                {c.originContext && <p className="truncate text-[11px] text-gray-400">{c.originContext}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
