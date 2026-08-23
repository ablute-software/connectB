'use client';
// Prompt 320 — My Network 5/9: Pathfinder. "Who opens this door for me" —
// which of the founder's own connections has a verified invested
// relationship with the investor behind this entity. Same fetch-own-data,
// filter-by-entityId pattern as CompetitorInvestmentCard.tsx. No result is a
// neutral, non-alarming state (never invites fabricating a connection) —
// the whole card just doesn't render if the feature isn't applicable, and
// shows a calm sentence rather than "0 matches" when it IS applicable but
// empty.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { authEnabled } from '@/lib/supabase';

interface PathfinderMatch { actorId: string; name: string; alreadyRequested: boolean }

export function PathfinderCard({ entityId }: { entityId: string }) {
  const [data, setData] = useState<{ applicable: boolean; investorName?: string; investorActorId?: string; matches?: PathfinderMatch[] } | null>(null);
  const [askedIds, setAskedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!authEnabled) return;
    let cancelled = false;
    fetch(`/api/network/pathfinder?entityId=${entityId}`).then((r) => r.json())
      .then((body) => { if (!cancelled) setData(body.ok ? body : { applicable: false }); })
      .catch(() => { if (!cancelled) setData({ applicable: false }); });
    return () => { cancelled = true; };
  }, [entityId]);

  if (!data || !data.applicable || !data.investorActorId) return null;

  function ask(connectionActorId: string) {
    if (!data?.investorActorId) return;
    setBusyId(connectionActorId);
    fetch('/api/network/pathfinder', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionActorId, targetActorId: data.investorActorId }),
    }).then((r) => r.json()).then((b) => { if (b.ok) setAskedIds((prev) => new Set(prev).add(connectionActorId)); })
      .finally(() => setBusyId(null));
  }

  const matches = data.matches ?? [];

  return (
    <Card title="🧭 Pathfinder">
      {matches.length === 0 ? (
        <p className="text-sm text-gray-400">None of your connections have a verified relationship with this investor yet.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">{matches.length} of your connections {matches.length === 1 ? 'has' : 'have'} a verified relationship with {data.investorName}:</p>
          <ul className="space-y-1.5">
            {matches.map((m) => {
              const alreadyAsked = m.alreadyRequested || askedIds.has(m.actorId);
              return (
                <li key={m.actorId} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2">
                  <span className="text-sm text-gray-800">{m.name}</span>
                  <button onClick={() => ask(m.actorId)} disabled={alreadyAsked || busyId === m.actorId}
                    className="shrink-0 rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
                    {alreadyAsked ? 'Already asked' : `Ask ${m.name} for an intro`}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
