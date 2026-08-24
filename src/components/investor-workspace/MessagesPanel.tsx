'use client';
// Prompt 340 Block D — Messages promoted to a real tab: a list of threads
// across every startup (last excerpt + unread badge), opening the exact same
// DealThreadView the per-startup dossier's Messages sub-tab already uses
// (same fetch/post URLs) rather than a second thread UI.
//
// PORTAL_MESSAGES_READ_EVENT mirrors SupportTicketsPanel.tsx's own
// SUPPORT_TICKET_READ_EVENT pattern exactly: opening a thread here marks it
// read server-side (the same GET /api/portal/messages?orgId= that the
// per-startup dossier already relies on for that), and this event tells the
// shell's badge to re-check immediately instead of staying stale until a
// full page reload.
import { useEffect, useState } from 'react';
import { DealThreadView } from '@/components/deal-messages/DealThreadView';

const PORTAL_MESSAGES_READ_EVENT = 'sherlock-portal-messages-read';

interface ThreadRow { orgId: string; orgName: string; lastMessageAt: string; lastExcerpt: string; unread: boolean }

export function useInvestorMessagesUnreadCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch('/api/portal/messages/threads').then((r) => r.json()).then((d) => {
        if (cancelled) return;
        setCount(((d.threads ?? []) as ThreadRow[]).filter((t) => t.unread).length);
      }).catch(() => {});
    }
    load();
    window.addEventListener(PORTAL_MESSAGES_READ_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(PORTAL_MESSAGES_READ_EVENT, load); };
  }, []);
  return count;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function MessagesPanel() {
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  function load() {
    fetch('/api/portal/messages/threads').then((r) => r.json()).then((d) => setThreads(d.threads ?? [])).catch(() => setThreads([]));
  }
  useEffect(load, []);

  function openThread(orgId: string) {
    setSelectedOrgId(orgId);
    // Opening it fires DealThreadView's own GET, which marks the thread read
    // server-side — this just tells the badge (and this list) to catch up.
    setThreads((prev) => prev?.map((t) => (t.orgId === orgId ? { ...t, unread: false } : t)) ?? null);
    window.dispatchEvent(new Event(PORTAL_MESSAGES_READ_EVENT));
  }

  if (!threads) return <p className="text-sm text-gray-400">Loading…</p>;

  if (threads.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">No conversations yet.</p>
        <p className="mt-1 text-xs text-gray-400">Messaging opens once you&apos;ve expressed interest or a founder has granted you data-room access — start one from a Pipeline card&apos;s Messages tab.</p>
      </div>
    );
  }

  const selected = threads.find((t) => t.orgId === selectedOrgId) ?? null;

  return (
    <div className="space-y-4" data-tour-id="investor-messages-root">
      <h1 className="text-lg font-bold text-gray-900">Messages</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <ul className="space-y-1.5 md:col-span-1">
          {threads.map((t) => (
            <li key={t.orgId}>
              <button onClick={() => openThread(t.orgId)}
                className={`w-full rounded-lg border p-2.5 text-left text-sm ${selectedOrgId === t.orgId ? 'border-[#0E7490] bg-[#E8F4F8]' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate font-medium ${t.unread ? 'text-gray-900' : 'text-gray-700'}`}>{t.orgName}</span>
                  {t.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-[#0E7490]" />}
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500">{t.lastExcerpt || '—'}</p>
                <p className="mt-0.5 text-[10px] text-gray-400">{fmtDateTime(t.lastMessageAt)}</p>
              </button>
            </li>
          ))}
        </ul>
        <div className="md:col-span-2">
          {selected ? (
            <DealThreadView
              key={selected.orgId}
              viewerSide="investor"
              fetchUrl={`/api/portal/messages?orgId=${encodeURIComponent(selected.orgId)}`}
              postUrl="/api/portal/messages" extraPostBody={{ orgId: selected.orgId }}
            />
          ) : (
            <p className="text-sm text-gray-400">Select a conversation.</p>
          )}
        </div>
      </div>
    </div>
  );
}
