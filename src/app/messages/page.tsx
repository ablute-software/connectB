'use client';
// P134-C — founder side of Sherlock messaging. One row per investor firm
// that has ever messaged this org, newest first, with an unread dot —
// mirrors the investor dossier's own Messages tab conceptually, just as a
// list rather than a single thread (a founder can have many).
//
// Addenda 2026-08-05 §1 — "+ New conversation" is the founder-initiate
// path Nuno decided on: restricted to investor firms with an active
// MatchDeal match against this startup (server-enforced by
// /api/founder/messages/eligible and re-checked again on POST) — a
// founder can never cold-message a Pipeline relationship that has no
// match, only reply once an investor writes first.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Tabs } from '@/components/ui';
import { SupportTicketsPanel, useSupportUnreadCount } from '@/components/SupportTicketsPanel';

interface ThreadRow { threadId: string; investorName: string; lastMessageAt: string; unread: boolean }
interface EligibleFirm { investorCatalogEntityId: string; name: string }

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function FounderMessagesPage() {
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [eligible, setEligible] = useState<EligibleFirm[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [selectedFirmId, setSelectedFirmId] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Item 13 — "a Support tab where messages already live," per the
  // mini-prompt: reuses this page's own header/layout instead of adding a
  // 10th top-level nav item or a second messaging system.
  const [tab, setTab] = useState<'messages' | 'support'>('messages');

  useEffect(() => {
    fetch('/api/founder/messages').then((r) => r.json()).then((d) => setThreads(d.threads ?? []));
    fetch('/api/founder/messages/eligible').then((r) => r.json()).then((d) => setEligible(d.firms ?? []));
  }, []);

  // Prompt 155 — same computation shell.tsx's own sidebar badge already
  // does (unreadMessages = unread thread count, unreadSupport = the shared
  // hook), just surfaced per-tab here too instead of only at the sidebar
  // level. Derived from `threads`, already fetched above — no second call.
  const unreadMessages = useMemo(() => (threads ?? []).filter((t) => t.unread).length, [threads]);
  const unreadSupport = useSupportUnreadCount();

  async function startConversation() {
    if (!selectedFirmId || !draftBody.trim()) return;
    setSending(true); setError(null);
    try {
      const res = await fetch('/api/founder/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ investorCatalogEntityId: selectedFirmId, body: draftBody }),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok || resBody.ok === false) {
        setError(resBody.error ?? 'Something went wrong — please try again.');
      } else {
        router.push(`/messages/${resBody.threadId}`);
      }
    } finally { setSending(false); }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Messages</h1>
          <p className="mt-1 text-sm text-gray-500">Conversations with investors on your Pipeline.</p>
        </div>
        {tab === 'messages' && eligible.length > 0 && (
          <button onClick={() => setShowNew((v) => !v)} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">
            + New conversation
          </button>
        )}
      </div>

      <div className="mt-3">
        <Tabs active={tab} onChange={(v) => setTab(v as 'messages' | 'support')}
          items={[{ key: 'messages', label: 'Messages', badge: unreadMessages }, { key: 'support', label: 'Support', badge: unreadSupport }]} />
      </div>

      {tab === 'support' && <div className="mt-4"><SupportTicketsPanel /></div>}

      {tab === 'messages' && showNew && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <label className="mb-1 block text-xs font-medium text-gray-700">Start a conversation with</label>
          <select value={selectedFirmId} onChange={(e) => setSelectedFirmId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm">
            <option value="">Choose an investor firm…</option>
            {eligible.map((f) => <option key={f.investorCatalogEntityId} value={f.investorCatalogEntityId}>{f.name}</option>)}
          </select>
          <textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={2} placeholder="Write your first message…"
            className="mt-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
          {error && <p className="mt-1.5 text-xs text-[#B00000]">{error}</p>}
          <div className="mt-2 flex justify-end">
            <button onClick={startConversation} disabled={sending || !selectedFirmId || !draftBody.trim()}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {tab === 'messages' && <div className="mt-4 space-y-2">
        {threads == null ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : threads.length === 0 ? (
          <div className="mx-auto mt-8 max-w-sm rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center">
            <p className="text-sm text-gray-600">No conversations yet.</p>
            <p className="mt-1 text-xs text-gray-400">
              {eligible.length > 0
                ? 'Start one with a matched investor above, or wait for one to write to you.'
                : 'A thread opens once an investor with an active relationship writes to you, or once you have an active MatchDeal match to start one yourself.'}
            </p>
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
      </div>}
    </div>
  );
}
