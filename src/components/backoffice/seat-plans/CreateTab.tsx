'use client';
// Prompt 904 Adenda 1 (v2) — sub-tab 1, "Create plan": pick a firm from the catalog and give it N seats BEFORE
// anyone has claimed it. A firm that already has an active plan is not offered the form again, only the shortcut.
import { useEffect, useState } from 'react';
import { FirmManager } from './FirmManager';
import { getJson, type Hit } from './shared';

export function CreateTab({ entityId, onPick, onOpenInPlans, onChanged }: {
  entityId: string | null; onPick: (id: string | null) => void; onOpenInPlans: (id: string) => void; onChanged: () => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      void getJson<{ results: Hit[] }>(`?q=${encodeURIComponent(q.trim())}`).then((d) => setHits(d.ok ? d.results : []));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Give a firm&apos;s catalog profile N seats before anyone has claimed it (pre-assignment), or create a code bound to that
        profile. Leave the real Portugal Ventures profile for when you decide to; tests go on a zz-test-… profile.
      </p>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Pick a firm</h2>
        <input autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalog by name…" aria-label="Search the catalog"
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        {hits.length > 0 && (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100 text-sm">
            {hits.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => { onPick(h.id); setQ(''); setHits([]); }} className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-gray-50">
                  <span>{h.name}{h.is_test ? <span className="ml-2 rounded bg-gray-100 px-1 text-[10px] text-gray-500">test</span> : null}</span>
                  <span className="text-xs text-gray-400">{h.website ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {entityId && <FirmManager key={entityId} entityId={entityId} mode="create" onOpenInPlans={onOpenInPlans} onChanged={onChanged} />}
    </div>
  );
}
