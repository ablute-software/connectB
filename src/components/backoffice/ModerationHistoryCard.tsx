'use client';
// Prompt 123 Block C.2 — the "History" subtab shared by Startups and
// Investors: every suspend/undo/delete action recorded, newest first.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import type { ModerationTargetType } from '@/lib/account-moderation';

interface Action {
  id: string; targetType: ModerationTargetType; targetId: string; action: 'suspend' | 'undo' | 'delete';
  justification: string; actorEmail: string; createdAt: string; quarantineUntil: string | null;
}

const ACTION_STYLE: Record<Action['action'], string> = {
  suspend: 'bg-amber-50 text-amber-700', undo: 'bg-emerald-50 text-emerald-700', delete: 'bg-red-50 text-red-700',
};

export function ModerationHistoryCard({ targetType, nameById }: { targetType: ModerationTargetType; nameById: Map<string, string> }) {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`/api/backoffice/moderation/history?targetType=${targetType}`).then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error); return; }
      setActions(body.actions);
    }).catch(() => setErr('Failed to load.'));
  }, [targetType]);

  return (
    <Card title="History">
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {!actions ? <p className="text-sm text-gray-400">Loading…</p> : actions.length === 0 ? (
        <p className="text-sm text-gray-400">No moderation actions recorded yet.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {actions.map((a) => (
            <li key={a.id} className="rounded-lg border border-gray-100 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${ACTION_STYLE[a.action]}`}>{a.action}</span>
                <span className="font-medium">{nameById.get(a.targetId) ?? a.targetId}</span>
                <span className="ml-auto text-xs text-gray-400">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-xs text-gray-600">{a.justification}</p>
              <p className="mt-0.5 text-[11px] text-gray-400">by {a.actorEmail}{a.quarantineUntil && ` · quarantine until ${new Date(a.quarantineUntil).toLocaleDateString()}`}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
