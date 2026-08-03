'use client';
// Contact & Support — back-office ticket detail: original message + event
// timeline, plus the four actions (status, priority, note, reply).
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui';

interface Ticket {
  id: string; created_at: string; source: string; org_id: string | null; user_id: string | null;
  name: string; email: string; category: string; subject: string; message: string; context: string | null; area: string | null;
  status: string; priority: string; last_activity_at: string; first_response_at: string | null; resolved_at: string | null;
}
interface Event { id: string; created_at: string; author: string; kind: string; body: string | null }
interface Attachment { path: string; url: string | null }

const STATUS_LABEL: Record<string, string> = { new: 'New', open: 'Open', waiting_user: 'Waiting on user', resolved: 'Resolved', closed: 'Closed' };
const CATEGORY_LABEL: Record<string, string> = {
  question: 'Question', problem: 'Problem/bug', billing: 'Billing',
  data_correction: 'Data correction', claim_profile: 'Profile claim', other: 'Other',
};
const SOURCE_LABEL: Record<string, string> = {
  landing: 'Landing', landing_investors: 'Landing (investors)', founder_app: 'App (founder)', investor_portal: 'Portal (investor)',
};
const KIND_LABEL: Record<string, string> = { note: 'Internal note', reply: 'Reply', status_change: 'Change', email_sent: 'Email sent' };

export default function SupportTicketPage() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [alsoEmail, setAlsoEmail] = useState(false);

  function load() {
    fetch(`/api/backoffice/support/${id}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setTicket(body.ticket); setEvents(body.events); setAttachments(body.attachments ?? []);
    });
  }
  useEffect(load, [id]);

  async function act(body: Record<string, unknown>) {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/backoffice/support/${id}/action`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) { setErr(data.error ?? 'Failed.'); return; }
      setNote(''); setReply(''); setAlsoEmail(false);
      load();
    } finally { setBusy(false); }
  }

  if (err && !ticket) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!ticket) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/backoffice/support" className="text-xs text-[#0E7490] hover:underline">← Customer Support</Link>

      <Card title={ticket.subject}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="font-semibold text-gray-700">{ticket.name}</span> · {ticket.email}
          · {CATEGORY_LABEL[ticket.category] ?? ticket.category} · {SOURCE_LABEL[ticket.source] ?? ticket.source}
          {ticket.area && <> · area: {ticket.area}</>}
          · {ticket.created_at.slice(0, 16).replace('T', ' ')}
        </div>
        <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-800">{ticket.message}</p>
        {ticket.context && <p className="mt-2 text-xs text-gray-500">Screen: {ticket.context}</p>}
        {attachments.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-gray-500">Attachments</p>
            <div className="flex flex-wrap gap-2">
              {attachments.map((a) => a.url ? (
                <a key={a.path} href={a.url} target="_blank" rel="noreferrer" className="block">
                  <img src={a.url} alt="Attachment" className="h-20 w-20 rounded-lg border border-gray-200 object-cover" />
                </a>
              ) : (
                <span key={a.path} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-400">Unavailable</span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-xs text-gray-500">Status
            <select value={ticket.status} disabled={busy} onChange={(e) => act({ action: 'status', value: e.target.value })}
              className="ml-1.5 rounded border border-gray-300 px-1.5 py-1 text-xs">
              {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Priority
            <select value={ticket.priority} disabled={busy} onChange={(e) => act({ action: 'priority', value: e.target.value })}
              className="ml-1.5 rounded border border-gray-300 px-1.5 py-1 text-xs">
              <option value="low">low</option><option value="normal">normal</option>
              <option value="high">high</option><option value="urgent">urgent</option>
            </select>
          </label>
        </div>
        {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
      </Card>

      <Card title="Timeline">
        {events.length === 0 ? <p className="text-sm text-gray-400">No events yet.</p> : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="rounded-lg border border-gray-100 p-2 text-sm">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-600">{KIND_LABEL[e.kind] ?? e.kind}</span>
                  <span>{e.author}</span>
                  <span className="ml-auto">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
                </div>
                {e.body && <p className="mt-1 whitespace-pre-wrap text-gray-700">{e.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Internal note">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          placeholder="Only visible in the back-office…" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
        <button disabled={busy || !note.trim()} onClick={() => act({ action: 'note', body: note })}
          className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40">
          Add note
        </button>
      </Card>

      <Card title="Reply">
        <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4}
          placeholder={`Reply to ${ticket.name}…`} className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
        <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={alsoEmail} onChange={(e) => setAlsoEmail(e.target.checked)} />
          Also send by email
        </label>
        <button disabled={busy || !reply.trim()} onClick={() => act({ action: 'reply', body: reply, alsoEmail })}
          className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {alsoEmail ? 'Reply and send email' : 'Save reply'}
        </button>
      </Card>
    </div>
  );
}
