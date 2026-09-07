'use client';
// Prompt 605 §E — the suggestions queue, deliberately NOT a copy of Customer
// Support with a different filter. A complaint is triaged (status, priority,
// who is assigned, how late we are); an idea is DECIDED. So this screen shows
// the whole suggestion on the row — the text, the screenshot, where it came
// from, who sent it and which badge they hold — and offers exactly the four
// moves its lifecycle has.
//
// The screenshot is inline (§E: "visível na própria linha, não atrás de um
// download"), and the badge sits next to the name because "a sugestão de um
// tech master é literalmente o que o programa foi comprar".
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';

interface Suggestion {
  id: string; created_at: string; name: string; email: string;
  org_id: string | null; org_name: string | null; badge: string | null;
  area: string | null; subject: string; message: string;
  suggestion_status: string; suggestion_outcome: string | null; suggestion_outcome_url: string | null;
  attachments: { path: string; url: string | null; malwareFlagged?: boolean }[];
}
interface Counts { received: number; under_review: number; accepted: number; declined: number }

const STATUS_LABEL: Record<string, string> = {
  received: 'Received', under_review: 'Under review', accepted: 'Accepted', declined: 'Not accepted',
};
const STATUS_STYLE: Record<string, string> = {
  received: 'bg-cyan-50 text-cyan-800', under_review: 'bg-amber-50 text-amber-800',
  accepted: 'bg-emerald-50 text-emerald-800', declined: 'bg-gray-100 text-gray-500',
};
const BADGE_LABEL: Record<string, string> = { tech_master: 'tech master', pioneer: 'pioneer' };

function age(iso: string) {
  const ms = Date.now() - Date.parse(iso);
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
}

export default function SuggestionsPage() {
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, { note: string; url: string }>>({});

  const load = useCallback(() => {
    const qs = status ? `?status=${status}` : '';
    fetch(`/api/backoffice/suggestions${qs}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); setItems([]); return; }
      setErr(''); setItems(body.suggestions); setCounts(body.counts);
    });
  }, [status]);
  useEffect(load, [load]);

  async function decide(id: string, next: string) {
    setBusy(id); setErr('');
    const draft = outcome[id] ?? { note: '', url: '' };
    const res = await fetch(`/api/backoffice/suggestions/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: next, outcome: draft.note, outcomeUrl: draft.url }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Request failed.' }));
    setBusy(null);
    if (res.ok === false) { setErr(res.error); return; }
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Suggestions</h1>
        {counts && (
          <span className="text-xs text-gray-500">
            {counts.received} to look at · {counts.under_review} under review · {counts.accepted} accepted · {counts.declined} not accepted
          </span>
        )}
      </div>

      <p className="text-xs text-gray-500">
        From the tech master and pioneer programmes, through the &ldquo;Tell us&rdquo; widget. An accepted suggestion
        needs a line saying what was done — otherwise the person who sent it has no way of knowing it mattered.
      </p>

      <div className="flex flex-wrap gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs">
          <option value="">All</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      {err && <p className="text-sm text-[#B00000]">{err}</p>}

      <Card title={items ? `Suggestions (${items.length})` : 'Suggestions'}>
        {!items ? <p className="text-sm text-gray-400">Loading…</p> : items.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing here yet.</p>
        ) : (
          <div className="space-y-4">
            {items.map((s) => {
              const draft = outcome[s.id] ?? { note: s.suggestion_outcome ?? '', url: s.suggestion_outcome_url ?? '' };
              return (
                <div key={s.id} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[s.suggestion_status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[s.suggestion_status] ?? s.suggestion_status}
                    </span>
                    {s.area && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{s.area}</span>}
                    <span className="text-xs text-gray-400">{age(s.created_at)}</span>
                    <Link href={`/backoffice/support/${s.id}`} className="ml-auto text-[11px] text-[#0E7490] hover:underline">Full ticket →</Link>
                  </div>

                  <h3 className="mt-2 text-sm font-semibold text-gray-900">{s.subject}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{s.message}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>{s.name} · {s.email}</span>
                    {s.org_name && <span className="text-gray-400">· {s.org_name}</span>}
                    {s.badge && (
                      <span className="rounded-full bg-[#0E7490]/10 px-2 py-0.5 text-[10px] font-semibold text-[#0E7490]">
                        {BADGE_LABEL[s.badge] ?? s.badge}
                      </span>
                    )}
                  </div>

                  {s.attachments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {s.attachments.map((a) => (
                        a.malwareFlagged ? (
                          <span key={a.path} className="rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-700">Attachment withheld — flagged by the scan</span>
                        ) : a.url ? (
                          <a key={a.path} href={a.url} target="_blank" rel="noreferrer">
                            {/* A short-lived signed URL from a private bucket,
                                not an asset next/image could optimise. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.url} alt="Screenshot sent with this suggestion"
                              className="max-h-48 rounded-lg border border-gray-200 object-contain object-top" />
                          </a>
                        ) : (
                          <span key={a.path} className="text-[11px] text-gray-400">Attachment unavailable</span>
                        )
                      ))}
                    </div>
                  )}

                  {s.suggestion_status === 'accepted' && s.suggestion_outcome && (
                    <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                      <b>What was done:</b> {s.suggestion_outcome}
                      {s.suggestion_outcome_url && (
                        <> · <a href={s.suggestion_outcome_url} target="_blank" rel="noreferrer" className="underline">link</a></>
                      )}
                    </div>
                  )}

                  <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input value={draft.note} placeholder="What was done (required to accept)" autoComplete="off"
                        onChange={(e) => setOutcome((o) => ({ ...o, [s.id]: { ...draft, note: e.target.value } }))}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs" />
                      <input value={draft.url} placeholder="Link to it (optional)" autoComplete="off"
                        onChange={(e) => setOutcome((o) => ({ ...o, [s.id]: { ...draft, url: e.target.value } }))}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(['received', 'under_review', 'accepted', 'declined'] as const)
                        .filter((k) => k !== s.suggestion_status)
                        .map((k) => (
                          <button key={k} disabled={busy === s.id} onClick={() => decide(s.id, k)}
                            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                            {busy === s.id ? '…' : STATUS_LABEL[k]}
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
