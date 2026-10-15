'use client';
// Prompt 909 (Adenda 2b) — the in-app notices of whoever imports from documents, on top of the Calls list: "Proposal ready to review" (Review opens that
// call, straight on the review) and "We could not read the documents" (with why). Shown until seen. The same pattern as the applicant's notices.
import { useEffect, useState } from 'react';
import { IMPORT_NOTICES_EVENT } from '@/lib/calls/ai-import/screen-state';
import { callsApi } from './api';

interface Notice { id: string; kind: 'import_ready' | 'import_failed'; title: string; body: string | null; callId: string }

export function ImportNotices({ onReview }: { onReview: (callId: string) => void }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => {
    let alive = true;
    void callsApi.importNotices().then((r) => { if (alive && r.ok) setNotices(r.body.notices ?? []); });
    return () => { alive = false; };
  }, []);
  if (notices.length === 0) return null;
  async function seen(id: string) {
    setNotices((all) => all.filter((n) => n.id !== id));
    await callsApi.markImportNoticesSeen({ ids: [id] });
    window.dispatchEvent(new Event(IMPORT_NOTICES_EVENT));
  }
  return (
    <ul className="mb-4 space-y-2" aria-label="Notifications" data-testid="import-notices">
      {notices.map((n) => (
        <li key={n.id} className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 ${n.kind === 'import_ready' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`} data-testid="import-notice" data-kind={n.kind}>
          <span className="text-sm text-gray-800"><b className="block text-gray-900">{n.title}</b>{n.body}</span>
          <span className="flex shrink-0 items-center gap-3 text-xs">
            <button type="button" onClick={() => { void seen(n.id); onReview(n.callId); }} className="font-semibold text-[#0E7490] hover:underline" data-testid="import-notice-open">{n.kind === 'import_ready' ? 'Review' : 'Open the call'}</button>
            <button type="button" onClick={() => void seen(n.id)} className="text-gray-500 hover:underline" aria-label="Dismiss">Dismiss</button>
          </span>
        </li>
      ))}
    </ul>
  );
}
