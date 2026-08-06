'use client';
// Prompt 126 E — "an investor expressed interest" popup. The decision
// itself is always recorded (investor_relationship_decisions) by the time
// this shows anything; the entity/interaction/task side effect
// (matchdeal_record_interest_notification) is best-effort and, as of
// 2026-08-06, actually reliable — for months it silently failed for any
// investor catalog entity with no website/phone/address on file (fixed in
// migrations 0127/0129; the caller's swallowed error is fixed in
// pipeline/route.ts, same commit). Don't assume the entity exists purely
// because this popup is showing — that's exactly the bug that went
// unnoticed. Polls + reacts to visibilitychange, same shape as
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
    <div className="fixed bottom-4 left-4 z-50 w-full max-w-sm overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-emerald-500 to-green-400 px-4 py-2">
        <span className="text-xs font-bold uppercase tracking-wide text-white">🎉 New interest</span>
        <button onClick={dismiss} disabled={busy} className="text-white/80 hover:text-white disabled:opacity-40">✕</button>
      </div>
      <div className="p-4">
        <p className="text-sm font-medium text-gray-900">{current.investorName} expressed interest</p>
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
    </div>
  );
}
