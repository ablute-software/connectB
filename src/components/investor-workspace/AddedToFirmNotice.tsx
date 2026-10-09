'use client';
// Prompt 904 Adenda 1 — shown once to someone the back-office added to a firm: the platform half of "You've been
// added to X" (the other half is the email). Dismissing it marks the notice as seen, so it does not come back.
import { useEffect, useState } from 'react';

type Notice = { id: string; firmName: string };

export function AddedToFirmNotice() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    fetch('/api/portal/seats/notices').then((r) => r.json()).then((d) => setNotices(d.ok ? d.notices ?? [] : [])).catch(() => {});
  }, []);

  if (notices.length === 0) return null;

  function dismiss() {
    const ids = notices.map((n) => n.id);
    setNotices([]);
    fetch('/api/portal/seats/notices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) }).catch(() => {});
  }

  const names = [...new Set(notices.map((n) => n.firmName))];
  return (
    <div role="status" data-testid="added-to-firm" className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
      <div>
        <p className="text-sm font-bold text-emerald-900">You&apos;ve been added to {names.join(' and ')}</p>
        <p className="mt-1 text-xs text-emerald-800">The Sherlock Deal team gave you a seat. It is active, nothing else to do.</p>
      </div>
      <button type="button" onClick={dismiss} className="rounded-lg border border-emerald-600 px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Got it</button>
    </div>
  );
}
