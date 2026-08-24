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
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';

const POLL_MS = 30_000;

interface InterestItem {
  catalogEntityId: string;
  investorName: string;
  reasonDetail: string | null;
  decidedAt: string;
  entityId: string | null;
}

export function InvestorInterestPopup() {
  const { refreshFromServer } = useStore();
  const router = useRouter();
  const [items, setItems] = useState<InterestItem[]>([]);
  const [busy, setBusy] = useState(false);
  // Prompt 346 §A — "an investor's interest can never look lost": the
  // founder workspace only ever hydrates its store once on load, so the
  // entity/task this popup is ABOUT (born server-side by
  // matchdeal_record_interest_notification, moments before this popup ever
  // shows) stays invisible to Pipeline/Tasks/Today/search until an F5 —
  // exactly the confirmed incident (SQL showed the entity existed;
  // /entities/[id] still said "Entity not found" because it only ever
  // reads the stale client store). seenIds tracks what THIS mounted
  // instance has already reacted to, so a refresh only fires for a
  // genuinely new arrival, never on every 30s poll of the same item.
  const seenIdsRef = useRef<Set<string>>(new Set());

  function load() {
    fetch('/api/founder/investor-interest', { cache: 'no-store' }).then((r) => r.json())
      .then((body) => {
        const next = (body.items ?? []) as InterestItem[];
        setItems(next);
        const hasNew = next.some((i) => !seenIdsRef.current.has(i.catalogEntityId));
        for (const i of next) seenIdsRef.current.add(i.catalogEntityId);
        // Reused refresh, not a parallel load path — see store-context.tsx's
        // own comment on refreshFromServer.
        if (hasNew) void refreshFromServer();
      }).catch(() => {});
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    function onVisible() { if (document.visibilityState === 'visible') load(); }
    document.addEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Prompt 346 §A — "View" only navigates AFTER the store refresh
  // completes (or is already settled), so it can never land on a store
  // that still doesn't know the entity exists. A plain Link here would
  // navigate on click regardless of that refresh's own timing.
  async function viewEntity() {
    if (!current!.entityId) return;
    setBusy(true);
    try {
      await refreshFromServer();
      router.push(`/entities/${current!.entityId}`);
    } finally {
      setBusy(false);
      void dismiss();
    }
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
            <button onClick={() => void viewEntity()} disabled={busy}
              className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b] disabled:opacity-40">
              {busy ? 'Opening…' : 'View'}
            </button>
          )}
          <button onClick={dismiss} disabled={busy} className="ml-auto rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
