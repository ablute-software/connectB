'use client';
// Prompt 680 — the investor's own mirror of /documents/access-log (the
// founder's page): every time THIS investor opened a document, across every
// startup they follow. Reached from the Data room tab's own link, not a
// workspace tab of its own (same "separate full-navigation page" pattern
// /portal/startup/[orgId] already uses, not the tab-switching shell).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { LoadingState } from '@/components/workspace-shell/LoadingState';

interface AccessLog {
  available: boolean;
  views: { id: string; orgName: string; documentName: string; viewedAt: string; seconds: number | null; pages: number | null }[];
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function duration(seconds: number | null) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function InvestorAccessLogPage() {
  const [log, setLog] = useState<AccessLog | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/portal/access-log', { cache: 'no-store' }).then((r) => r.json()).then((b) => { if (b.ok === false) setErr(b.error); else setLog(b); }).catch((e) => setErr((e as Error).message));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-gray-900">Your access history</h1>
        <Link href="/portal" className="text-xs text-[#0E7490] hover:underline">← Back to your workspace</Link>
      </div>
      <p className="text-sm text-gray-500">Every time you opened a document shared with you — which startup, which document, when. Recorded automatically; it cannot be edited.</p>
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {!log && !err && <LoadingState text="Loading…" compact />}
      {log && !log.available && <p className="text-sm text-gray-400">Not available yet.</p>}
      {log?.available && (
        <Card title={`Document views (${log.views.length})`}>
          {log.views.length === 0 ? <p className="text-sm text-gray-400">You haven&apos;t opened a document yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400"><th className="py-1 pr-3">When</th><th className="pr-3">Startup</th><th className="pr-3">Document</th><th className="pr-3">Time</th><th>Pages</th></tr></thead>
                <tbody>
                  {log.views.map((v) => (
                    <tr key={v.id} className="border-t border-gray-50">
                      <td className="py-1.5 pr-3 whitespace-nowrap text-gray-600">{fmt(v.viewedAt)}</td>
                      <td className="pr-3 text-gray-800">{v.orgName}</td>
                      <td className="pr-3 text-gray-800">{v.documentName}</td>
                      <td className="pr-3 text-gray-600">{duration(v.seconds)}</td>
                      <td className="text-gray-600">{v.pages ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
