'use client';
// Contact & Support — back-office "Customer Support" list.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';

interface Ticket {
  id: string; created_at: string; source: string; name: string; email: string;
  category: string; subject: string; status: string; priority: string; area: string | null;
  attachment_urls: string[]; last_activity_at: string; delayedNew: boolean; forgottenOpen: boolean; suggestClose: boolean;
}
interface Counts { new: number; atrasados: number; esquecidos: number; sugerirFechar: number; navBadge: number }

const STATUS_LABEL: Record<string, string> = { new: 'New', open: 'Open', waiting_user: 'Waiting on user', resolved: 'Resolved', closed: 'Closed' };
const CATEGORY_LABEL: Record<string, string> = {
  question: 'Question', problem: 'Problem/bug', billing: 'Billing',
  data_correction: 'Data correction', claim_profile: 'Profile claim', other: 'Other',
};
const SOURCE_LABEL: Record<string, string> = {
  landing: 'Landing', landing_investors: 'Landing (investors)', founder_app: 'App (founder)', investor_portal: 'Portal (investor)',
};
const PRIORITY_STYLE: Record<string, string> = {
  low: 'bg-gray-100 text-gray-500', normal: 'bg-cyan-50 text-cyan-800',
  high: 'bg-amber-100 text-amber-800', urgent: 'bg-red-100 text-red-800',
};

function age(iso: string) {
  const ms = Date.now() - Date.parse(iso);
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m`;
}

export default function SupportListPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('');

  function load() {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (category) params.set('category', category);
    if (source) params.set('source', source);
    fetch(`/api/backoffice/support?${params.toString()}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setTickets(body.tickets); setCounts(body.counts);
    });
  }
  useEffect(load, [status, category, source]);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;

  const summaryParts: string[] = [];
  if (counts) {
    if (counts.atrasados > 0) summaryParts.push(`${counts.atrasados} overdue`);
    if (counts.esquecidos > 0) summaryParts.push(`${counts.esquecidos} forgotten`);
    if (counts.sugerirFechar > 0) summaryParts.push(`${counts.sugerirFechar} suggest closing`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Customer Support</h1>
        {summaryParts.length > 0 && (
          <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">{summaryParts.join(' · ')}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs">
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs">
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      <Card title={tickets ? `Tickets (${tickets.length})` : 'Tickets'}>
        {!tickets ? <p className="text-sm text-gray-400">Loading…</p> : tickets.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing here.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-1.5">Status</th><th>Priority</th><th>Category</th><th>Area</th><th>Subject</th>
                <th>Who</th><th>Source</th><th>Age</th><th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-t border-gray-50">
                  <td className="py-2">
                    <Link href={`/backoffice/support/${t.id}`} className="font-medium text-[#0E7490] hover:underline">{STATUS_LABEL[t.status] ?? t.status}</Link>
                    {t.delayedNew && <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-800">OVERDUE</span>}
                    {t.forgottenOpen && <span className="ml-1.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-800">FORGOTTEN</span>}
                    {t.suggestClose && <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold text-gray-600">SUGGEST CLOSING</span>}
                  </td>
                  <td><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_STYLE[t.priority]}`}>{t.priority}</span></td>
                  <td className="text-xs text-gray-600">{CATEGORY_LABEL[t.category] ?? t.category}</td>
                  <td className="text-xs text-gray-500">{t.area ?? '—'}</td>
                  <td className="max-w-[220px] truncate">
                    <Link href={`/backoffice/support/${t.id}`} className="hover:underline">{t.subject}</Link>
                    {t.attachment_urls?.length > 0 && <span className="ml-1 text-gray-400" title={`${t.attachment_urls.length} attachment(s)`}>📎{t.attachment_urls.length}</span>}
                  </td>
                  <td className="text-xs text-gray-500">{t.name}<div className="text-gray-400">{t.email}</div></td>
                  <td className="text-xs text-gray-400">{SOURCE_LABEL[t.source] ?? t.source}</td>
                  <td className="text-xs text-gray-400">{age(t.created_at)}</td>
                  <td className="text-xs text-gray-400">{age(t.last_activity_at)} ago</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
