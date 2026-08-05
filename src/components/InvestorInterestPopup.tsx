'use client';
// Prompt 126 E — "an investor expressed interest" popup. The decision
// itself is already recorded (investor_relationship_decisions) and an
// interaction + entity already auto-created server-side (migration 0124,
// matchdeal_record_interest_notification) by the time this ever shows
// anything — this only surfaces what already happened and lets the founder
// dismiss it. Polls + reacts to visibilitychange, same shape as
// ReminderPopup.tsx; placed bottom-left so the two never overlap if both
// are showing at once.
import { useEffect, useState } from 'react';
import Link from 'next/link';

const POLL_MS = 30_000;

interface InterestItem {
  catalogEntityId: string;
  investorName: string;
  reasonDetail: string | null;
  decidedAt: string;
  entityId: string | null;
}

export function InvestorInterestPopup() {
  const [items, setItems] = useState<InterestItem[]>([]);
  const [busy, setBusy] = useState(false);

  function load() {
    fetch('/api/founder/investor-interest', { cache: 'no-store' }).then((r) => r.json())
      .then((body) => setItems(body.items ?? [])).catch(() => {});
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    function onVisible() { if (document.visibilityState === 'visible') load(); }
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const current = items[0];
  if (!current) return null;

  async function dismiss() {
    setBusy(true);
    try {
      await fetch('/api/founder/investor-interest', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ catalogEntityId: current!.catalogEntityId }),
      });
      setItems((prev) => prev.filter((i) => i.catalogEntityId !== current!.catalogEntityId));
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-full max-w-sm rounded-xl border border-cyan-100 bg-white p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <span className="rounded-full bg-[#E8F4F8] px-1.5 py-0.5 text-[10px] font-medium text-[#0E7490]">Pipeline</span>
        <button onClick={dismiss} disabled={busy} className="text-sm text-gray-400 hover:text-gray-700 disabled:opacity-40">✕</button>
      </div>
      <p className="mt-1.5 text-sm font-medium text-gray-900">🎉 {current.investorName} expressed interest</p>
      {current.reasonDetail && <p className="mt-1 text-xs text-gray-500">&ldquo;{current.reasonDetail}&rdquo;</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {current.entityId && (
          <Link href={`/entities/${current.entityId}`} onClick={dismiss}
            className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">
            View
          </Link>
        )}
        <button onClick={dismiss} disabled={busy} className="ml-auto rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
          Dismiss
        </button>
      </div>
    </div>
  );
}
