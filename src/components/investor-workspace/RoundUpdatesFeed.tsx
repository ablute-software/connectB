'use client';
// Investor Workspace Fase 3 (prompt 56), Bloco 2 — the portal-side feed,
// most recent first. This is the "reason to come back" mechanism; kept
// deliberately simple (no read-state, no pagination) for v1.
import { useEffect, useState } from 'react';
import { roundUpdateEditedAt } from '@/lib/round-updates';

// Prompt 906 §B — a founder can now edit or delete an update. A deleted one is simply not in the list any more;
// an edited one arrives with its new text and `updated_at`, and says so. No notification goes out for either.
interface Update { id: string; title: string; body: string; created_at: string; updated_at?: string | null }

export function RoundUpdatesFeed({ orgId }: { orgId: string }) {
  const [updates, setUpdates] = useState<Update[] | null>(null);

  useEffect(() => {
    fetch(`/api/portal/updates?org_id=${orgId}`).then((r) => r.json()).then((d) => setUpdates(d.updates ?? []));
  }, [orgId]);

  if (!updates || updates.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Round updates</h2>
      <div className="mt-2 space-y-3">
        {updates.map((u) => {
          const editedAt = roundUpdateEditedAt(u);
          return (
            <div key={u.id} className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-gray-800">{u.title}</h3>
                <span className="shrink-0 text-[10px] text-gray-400">
                  {new Date(u.created_at).toLocaleDateString()}
                  {editedAt && ` · edited ${new Date(editedAt).toLocaleDateString()}`}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{u.body}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
