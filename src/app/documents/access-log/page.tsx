'use client';
// The founder's own view of every DOCUMENT access (document_views: who, when,
// how long, how many pages).
//
// Prompt 886/877 — this page used to also list "Sherlock team access to this
// workspace" (the Developer Viewer's viewer_enter/viewer_exit lines). By
// Nuno's decision, an authorised admin viewing an account is logged internally
// and is not shown to the organisation, so that section is removed and the
// route no longer returns it. Document views are unaffected.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';

interface AccessLog {
  available: boolean;
  views: { id: string; documentName: string; viewerEmail: string | null; viewedAt: string; seconds: number | null; pages: number | null }[];
  teamAccess: { id: string; enteredAt: string; durationMs: number | null; closedBy: string | null; reason: string | null }[];
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function duration(ms: number | null, seconds: number | null) {
  const s = ms != null ? Math.round(ms / 1000) : seconds;
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function AccessLogPage() {
  const [log, setLog] = useState<AccessLog | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/account/access-log', { cache: 'no-store' }).then((r) => r.json()).then((b) => { if (b.ok === false) setErr(b.error); else setLog(b); }).catch((e) => setErr((e as Error).message));
  }, []);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Access log</h1>
        <Link href="/documents" className="text-xs text-[#0E7490] hover:underline">← Documents &amp; Vault Data Room</Link>
      </div>
      <p className="text-sm text-gray-500">Every time a document of yours is opened — who, when, how long, and how many pages. Recorded automatically; it cannot be edited.</p>
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {!log && !err && <p className="text-sm text-gray-400">Loading…</p>}
      {log && !log.available && <p className="text-sm text-gray-400">Not available in this workspace yet.</p>}
      {log?.available && (
        <>
          <Card title={`Document views (${log.views.length})`}>
            {log.views.length === 0 ? <p className="text-sm text-gray-400">No document has been opened yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400"><th className="py-1 pr-3">When</th><th className="pr-3">Who</th><th className="pr-3">Document</th><th className="pr-3">Time</th><th>Pages</th></tr></thead>
                  <tbody>
                    {log.views.map((v) => (
                      <tr key={v.id} className="border-t border-gray-50">
                        <td className="py-1.5 pr-3 whitespace-nowrap text-gray-600">{fmt(v.viewedAt)}</td>
                        <td className="pr-3 text-gray-800">{v.viewerEmail ?? '(unknown)'}</td>
                        <td className="pr-3 text-gray-800">{v.documentName}</td>
                        <td className="pr-3 text-gray-600">{duration(null, v.seconds)}</td>
                        <td className="text-gray-600">{v.pages ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
