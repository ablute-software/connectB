'use client';
// P134-C — founder side of Sherlock messaging. One row per investor firm
// that has ever messaged this org, newest first, with an unread dot —
// mirrors the investor dossier's own Messages tab conceptually, just as a
// list rather than a single thread (a founder can have many).
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface ThreadRow { threadId: string; investorName: string; lastMessageAt: string; unread: boolean }

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function FounderMessagesPage() {
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);

  useEffect(() => {
    fetch('/api/founder/messages').then((r) => r.json()).then((d) => setThreads(d.threads ?? []));
  }, []);

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <h1 className="text-lg font-bold text-gray-900">Messages</h1>
      <p className="mt-1 text-sm text-gray-500">Conversations with investors on your Pipeline.</p>

      <div className="mt-4 space-y-2">
        {threads == null ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : threads.length === 0 ? (
          <div className="mx-auto mt-8 max-w-sm rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center">
            <p className="text-sm text-gray-600">No conversations yet.</p>
            <p className="mt-1 text-xs text-gray-400">A thread opens once an investor with an active relationship sends you a message.</p>
          </div>
        ) : (
          threads.map((t) => (
            <Link key={t.threadId} href={`/messages/${t.threadId}`}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 hover:border-[#0E7490]">
              <div className="flex items-center gap-2">
                {t.unread && <span className="h-2 w-2 rounded-full bg-[#0E7490]" title="Unread" />}
                <span className={`text-sm ${t.unread ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{t.investorName}</span>
              </div>
              <span className="text-xs text-gray-400">{fmtDate(t.lastMessageAt)}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
