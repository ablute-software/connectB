'use client';
// Item 13 — the user-visible half of support_tickets, shared between the
// founder shell (/support) and the investor workspace ("Support" tab).
// Reuses the existing list-then-detail card pattern already established
// elsewhere in this codebase (e.g. AccessRequestsQueue) rather than
// building a second messaging UI — support_ticket_events is not
// deal_messages, and shouldn't try to look like it.
import { useEffect, useState } from 'react';
import { Card } from './ui';

type TicketSummary = {
  id: string; created_at: string; category: string; subject: string;
  status: 'new' | 'open' | 'waiting_user' | 'resolved' | 'closed'; last_activity_at: string; unread: boolean;
};
type TicketEvent = { id: string; created_at: string; author: string; kind: string; body: string | null };
type TicketDetail = {
  id: string; created_at: string; category: string; subject: string; message: string;
  status: TicketSummary['status'];
};

const STATUS_LABEL: Record<TicketSummary['status'], string> = {
  new: 'New', open: 'Open', waiting_user: 'Waiting on you', resolved: 'Resolved', closed: 'Closed',
};
const STATUS_COLOR: Record<TicketSummary['status'], string> = {
  new: 'bg-blue-50 text-blue-700', open: 'bg-blue-50 text-blue-700',
  waiting_user: 'bg-amber-50 text-amber-800', resolved: 'bg-green-50 text-green-700', closed: 'bg-gray-100 text-gray-500',
};

export function useSupportUnreadCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/support/my-tickets').then((r) => r.json()).then((body) => {
      if (cancelled || body.ok === false) return;
      setCount((body.tickets ?? []).filter((t: TicketSummary) => t.unread).length);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return count;
}

export function SupportTicketsPanel() {
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  function refresh() {
    fetch('/api/support/my-tickets').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setTickets(body.tickets);
    }).catch(() => setErr('Failed to load.'));
  }
  useEffect(refresh, []);

  if (openId) {
    return <TicketThread id={openId} onBack={() => { setOpenId(null); refresh(); }} />;
  }

  return (
    <Card title="Support tickets">
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {!tickets ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : tickets.length === 0 ? (
        <p className="text-sm text-gray-400">No tickets yet — use Help &amp; support to reach us.</p>
      ) : (
        <ul className="space-y-1.5">
          {tickets.map((t) => (
            <li key={t.id}>
              <button onClick={() => setOpenId(t.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50">
                {t.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-[#0E7490]" aria-label="Unread reply" />}
                <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{t.subject}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[t.status]}`}>
                  {STATUS_LABEL[t.status]}
                </span>
                <span className="shrink-0 text-xs text-gray-400">{new Date(t.last_activity_at).toLocaleDateString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TicketThread({ id, onBack }: { id: string; onBack: () => void }) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [events, setEvents] = useState<TicketEvent[] | null>(null);
  const [err, setErr] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  function refresh() {
    fetch(`/api/support/my-tickets/${id}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setTicket(body.ticket); setEvents(body.events);
    }).catch(() => setErr('Failed to load.'));
  }
  useEffect(refresh, [id]);

  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true);
    const res = await fetch(`/api/support/my-tickets/${id}/reply`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: reply }),
    });
    const body = await res.json();
    setSending(false);
    if (body.ok === false) { setErr(body.error); return; }
    setReply('');
    refresh();
  }

  return (
    <Card title="Support ticket">
      <button onClick={onBack} className="mb-3 text-xs text-gray-400 hover:underline">← Back to tickets</button>
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {!ticket || !events ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <>
          <div className="mb-3 flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-800">{ticket.subject}</h3>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[ticket.status]}`}>
              {STATUS_LABEL[ticket.status]}
            </span>
          </div>
          <div className="space-y-2.5">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm text-gray-700">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">You · {new Date(ticket.created_at).toLocaleString()}</p>
              {ticket.message}
            </div>
            {events.map((e) => (
              <div key={e.id} className={`rounded-xl border p-3 text-sm ${
                e.author === 'admin' ? 'border-[#0E7490]/20 bg-[#E8F4F8] text-gray-800' : 'border-gray-100 bg-gray-50 text-gray-700'}`}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {e.kind === 'status_change' ? 'Status change' : e.author === 'admin' ? 'Sherlock Deal' : 'You'} · {new Date(e.created_at).toLocaleString()}
                </p>
                {e.body}
              </div>
            ))}
          </div>
          {ticket.status !== 'closed' && (
            <div className="mt-3">
              <textarea value={reply} onChange={(ev) => setReply(ev.target.value)} rows={3} maxLength={5000}
                placeholder="Reply…" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <button onClick={() => void sendReply()} disabled={sending || !reply.trim()}
                className="mt-2 rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
                {sending ? 'Sending…' : 'Send reply'}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
