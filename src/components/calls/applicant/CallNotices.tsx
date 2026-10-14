'use client';
// Prompt 907 (I3, I5) — the applicant's in-app notices, on top of the Calls area until dismissed (spec §23). The same pattern as the investor's
// "you have been added to a firm" notice: a row per event, shown until seen. Dismissing marks it seen on the server.
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Notice { id: string; kind: string; title: string; body: string | null; linkPath: string | null; createdAt: string }

export function CallNotices({ onSeen }: { onSeen?: () => void }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/calls/apply/notices', { cache: 'no-store' }).then((r) => r.json()).then((d) => { if (alive && d?.ok) setNotices(d.notices ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (notices.length === 0) return null;
  async function dismiss(id: string) {
    setNotices((all) => all.filter((n) => n.id !== id));
    await fetch('/api/calls/apply/notices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [id] }) }).catch(() => {});
    onSeen?.();
  }
  return (
    <ul className="mt-4 space-y-2" data-testid="call-notices" aria-label="Notifications">
      {notices.map((n) => (
        <li key={n.id} className="flex items-start justify-between gap-3 rounded-xl border border-[#BAD9E3] bg-[#E8F4F8] px-4 py-3" data-testid="call-notice">
          <span className="text-sm text-gray-800"><b className="block text-gray-900">{n.title}</b>{n.body}
            {n.linkPath && <> <Link href={n.linkPath} className="font-semibold text-[#0E7490] hover:underline">Open</Link></>}
          </span>
          <button type="button" onClick={() => void dismiss(n.id)} className="shrink-0 text-xs text-gray-500 hover:underline" aria-label="Dismiss">Dismiss</button>
        </li>
      ))}
    </ul>
  );
}
