'use client';
// P133 (item 10) — investor-side interaction log drawer. Mirrors the
// founder-side CRM's own ThreadDrawer.tsx shell (fixed right-side panel,
// sticky header, timeline list) — the exact UI shape this feature is meant
// to be the investor-side counterpart of. Founder has no route that reads
// this data at all (see /api/portal/interaction-log's own header comment).
import { useEffect, useState } from 'react';

interface TimelineEntry {
  id: string;
  kind: 'manual' | 'interested' | 'passed' | 'archived' | 'reopened' | 'matchdeal_link';
  automatic: boolean;
  at: string;
  channel: string | null;
  content: string;
  links: { label: string; url: string }[];
}

const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'email', label: 'Email' }, { value: 'call', label: 'Call' }, { value: 'meeting', label: 'Meeting' },
  { value: 'message', label: 'Message' }, { value: 'matchdeal', label: 'MatchDeal' }, { value: 'other', label: 'Other' },
];
const CHANNEL_LABEL = Object.fromEntries(CHANNEL_OPTIONS.map((c) => [c.value, c.label]));
const KIND_LABEL: Record<string, string> = {
  interested: '✓ Interest expressed', passed: '✕ Passed', archived: '📦 Archived',
  reopened: '↺ Reopened', matchdeal_link: '💬 MatchDeal',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function InteractionLogDrawer({ orgId, orgName, onClose }: { orgId: string; orgName: string; onClose: () => void }) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [channel, setChannel] = useState('email');
  const [content, setContent] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [draftLinks, setDraftLinks] = useState<{ label: string; url: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qaToast, setQaToast] = useState<string | null>(null);

  function load() {
    fetch(`/api/portal/interaction-log?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then((d) => setEntries(d.entries ?? []));
  }
  useEffect(load, [orgId]);

  function addLink() {
    const url = linkUrl.trim();
    if (!/^https?:\/\//i.test(url)) return;
    setDraftLinks((ls) => [...ls, { label: linkLabel.trim() || url, url }]);
    setLinkLabel(''); setLinkUrl('');
  }
  function removeLink(i: number) {
    setDraftLinks((ls) => ls.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!content.trim()) return;
    setSaving(true); setError(null); setQaToast(null);
    try {
      const res = await fetch('/api/portal/interaction-log', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, channel, content, links: draftLinks }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setError(body.error ?? 'Something went wrong — please try again.');
      } else {
        setContent(''); setDraftLinks([]);
        if (body.qa) setQaToast('QA session — action simulated, nothing recorded.');
        load();
      }
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-gray-900">{orgName}</h2>
              <p className="mt-0.5 text-xs text-gray-500">Interaction log — private to your firm.</p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <a href={`/api/portal/export?type=interaction-log&orgId=${encodeURIComponent(orgId)}`}
                className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50">
                Export CSV
              </a>
              <button onClick={onClose} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50">Close</button>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <label className="mb-1 block text-xs font-medium text-gray-700">Log interaction</label>
            <select value={channel} onChange={(e) => setChannel(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs">
              {CHANNEL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={2} placeholder="What happened?"
              className="mt-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Link label (optional)"
                className="w-32 rounded-lg border border-gray-300 px-2 py-1 text-[11px]" />
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…"
                className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-[11px]" />
              <button onClick={addLink} className="rounded-lg border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-white">+ Link</button>
            </div>
            {draftLinks.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {draftLinks.map((l, i) => (
                  <li key={i} className="flex items-center justify-between text-[11px] text-gray-500">
                    <span className="truncate">{l.label}</span>
                    <button onClick={() => removeLink(i)} className="text-gray-400 hover:underline">Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-gray-400">The founder never sees this log.</span>
              <button onClick={submit} disabled={saving || !content.trim()}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                {saving ? 'Saving…' : 'Log interaction'}
              </button>
            </div>
            {error && <p className="mt-1.5 text-[11px] text-[#B00000]">{error}</p>}
            {qaToast && <p className="mt-1.5 text-[11px] text-amber-800">{qaToast}</p>}
          </div>
        </div>

        <div className="space-y-2 px-5 py-4">
          {entries == null ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-400">No interactions yet.</p>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={e.id} className="rounded border border-gray-100 bg-gray-50 p-3 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>{fmtDate(e.at)}</span>
                    {e.kind === 'manual' && e.channel && (
                      <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5">{CHANNEL_LABEL[e.channel] ?? e.channel}</span>
                    )}
                    {e.kind !== 'manual' && <span className="font-medium text-gray-600">{KIND_LABEL[e.kind]}</span>}
                  </div>
                  <p className="whitespace-pre-wrap text-gray-700">{e.content}</p>
                  {e.links.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {e.links.map((l, i) => (
                        <li key={i}>
                          <a href={l.url} target="_blank" rel="noreferrer" className="text-xs text-[#0E7490] hover:underline">{l.label} →</a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
