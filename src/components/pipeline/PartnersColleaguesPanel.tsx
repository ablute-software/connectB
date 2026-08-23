'use client';
// Prompt 330 — Pipeline's "Partners & colleagues" panel: the real estate
// max-w-[1600px] (shell.tsx, /pipeline only) leaves empty next to the
// table on wide screens, given real use. Reads from the SAME source
// /network's own "Your connections" list uses (GET /api/network,
// readConnectionsForActor/resolveActorDisplays in network-db.ts) — never a
// second, parallel connections list. Zero engagement counters, zero
// comparison between connections — same anti-ranking rule as the rest of
// My Network. "+Add" reuses InviteByEmailForm — the ONE implementation of
// the email-invite mechanism (Prompt 335 §D1), shared with My Network's own
// "My contacts" panel.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { authEnabled } from '@/lib/supabase';
import { NetworkAvatar } from '@/components/NetworkAvatar';
import { InviteByEmailForm } from '@/components/network/InviteByEmailForm';

interface ConnectionRow { id: string; otherActorId: string; otherName: string; otherKind: 'founder' | 'investor'; originContext: string | null }

export function PartnersColleaguesPanel() {
  const [connections, setConnections] = useState<ConnectionRow[] | null>(null);
  const [adding, setAdding] = useState(false);

  function load() {
    if (!authEnabled) { setConnections([]); return; }
    fetch('/api/network').then((r) => r.json()).then((b) => setConnections(b.available ? b.connections : [])).catch(() => setConnections([]));
  }
  useEffect(load, []);

  return (
    <Card title="Partners & colleagues" right={
      !adding && <button onClick={() => setAdding(true)} className="text-xs text-cyan-700 hover:underline">+ Add</button>
    }>
      {adding && (
        <div className="mb-3 border-b border-gray-100 pb-3">
          <InviteByEmailForm />
          <button onClick={() => setAdding(false)} className="mt-1.5 rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600">Close</button>
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
