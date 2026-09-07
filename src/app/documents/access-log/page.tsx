'use client';
// Prompt 603 commitments 3 and 4 — the founder's own view of every document
// access (document_views: who, when, how long, how many pages) and of every
// time the Sherlock team entered this workspace (the Developer Viewer's own
// audit lines: when, for how long). Records that already existed; this is
// the window the commitments promise.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';

interface AccessLog {
  available: boolean;
  views: { id: string; documentName: string; viewerEmail: string | null; viewedAt: string; seconds: number | null; pages: number | null }[];
  teamAccess: { id: string; enteredAt: string; durationMs: number | null; closedBy: string | null }[];
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
      <p className="text-sm text-gray-500">Every time a document of yours is opened, and every time our team entered your workspace. Both are recorded automatically; neither can be edited.</p>
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
          <div id="team">
            <Card title={`Sherlock team access to this workspace (${log.teamAccess.length})`}>
              <p className="mb-2 text-xs text-gray-500">Our staff can open a read-only view of a workspace to resolve a support request or investigate a fault. Every entry is logged with the time and the duration and shown here.</p>
              {log.teamAccess.length === 0 ? <p className="text-sm text-gray-400">Nobody from our team has entered this workspace.</p> : (
                <ul className="space-y-1 text-sm text-gray-700">
                  {log.teamAccess.map((t) => (
                    <li key={t.id}>{fmt(t.enteredAt)} — {t.durationMs != null ? `for ${duration(t.durationMs, null)}` : 'duration not recorded'}</li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
