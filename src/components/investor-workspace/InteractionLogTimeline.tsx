'use client';
// P133/P134-B — the interaction log's form + timeline body, extracted out
// of InteractionLogDrawer so the dossier's Activity tab (P134-B) can embed
// it directly (no drawer chrome), while the Pipeline card's drawer shortcut
// keeps working exactly as before, just as a thin wrapper around this.
//
// P134-D (§4) — added date+time display (was date-only), an occurred-at
// field so a past interaction can actually be logged as having happened
// when it happened (the server always accepted this; nothing sent it),
// a person picker sourced from the startup's own company_people (falls
// back to free text via "Other…" — the person spoken to is very often not
// registered anywhere yet), and a document picker limited to files this
// firm already has data-room access to (never a new upload path).
import { useEffect, useState } from 'react';
import { investorJourneySteps } from '@/lib/investor-journey';
import { InvestorJourneyStrip } from './InvestorJourneyStrip';

// Prompt 216 §B — contexto para a faixa "ponto da situação". Opcional: o
// drawer da Pipeline (InteractionLogDrawer) não o passa e fica exatamente
// como estava; só o separador de atividade do dossier o fornece. Tudo aqui
// é investor-visível por construção (mensagens da thread DELE, docs com
// gate já resolvido, decisão DELE) — ver §A do prompt e investor-journey.ts.
export interface JourneyContext {
  messages: { createdAt: string }[];
  accessibleDocs: { id: string; name: string }[];
  status: 'open' | 'passed' | 'interested';
  decidedAt: string | null;
  onOpenDoc: (documentId: string) => void;
}

interface TimelineEntry {
  id: string;
  kind: 'manual' | 'interested' | 'passed' | 'archived' | 'reopened' | 'matchdeal_link';
  automatic: boolean;
  at: string;
  channel: string | null;
  content: string;
  links: { label: string; url: string }[];
  personName: string | null;
  document: { id: string; name: string } | null;
}
interface PersonOption { id: string; fullName: string; title: string | null; isFounder: boolean }
interface DocOption { id: string; name: string }

const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'email', label: 'Email' }, { value: 'call', label: 'Call' }, { value: 'meeting', label: 'Meeting' },
  { value: 'message', label: 'Message' }, { value: 'matchdeal', label: 'MatchDeal' }, { value: 'other', label: 'Other' },
];
const CHANNEL_LABEL = Object.fromEntries(CHANNEL_OPTIONS.map((c) => [c.value, c.label]));
const KIND_LABEL: Record<string, string> = {
  interested: '✓ Interest expressed', passed: '✕ Passed', archived: '📦 Archived',
  reopened: '↺ Reopened', matchdeal_link: '💬 MatchDeal',
};
const OTHER_PERSON_VALUE = '__other__';

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time, not the UTC ISO
// string Date#toISOString gives — sliced-off UTC would silently shift the
// displayed value by the viewer's own timezone offset.
function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function InteractionLogTimeline({ orgId, journey }: { orgId: string; journey?: JourneyContext }) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [documents, setDocuments] = useState<DocOption[]>([]);
  const [personDocAvailable, setPersonDocAvailable] = useState(false);
  const [channel, setChannel] = useState('email');
  const [content, setContent] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => toLocalInputValue(new Date()));
  const [personId, setPersonId] = useState('');
  const [personNameOther, setPersonNameOther] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [draftLinks, setDraftLinks] = useState<{ label: string; url: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch(`/api/portal/interaction-log?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then((d) => {
      setEntries(d.entries ?? []);
      setPeople(d.people ?? []);
      setDocuments(d.documents ?? []);
      setPersonDocAvailable(!!d.personDocumentAvailable);
    });
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
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/portal/interaction-log', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orgId, channel, content, links: draftLinks,
          occurredAt: new Date(occurredAt).toISOString(),
          personId: personId && personId !== OTHER_PERSON_VALUE ? personId : undefined,
          personNameOther: personId === OTHER_PERSON_VALUE ? personNameOther : undefined,
          documentId: documentId || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setError(body.error ?? 'Something went wrong — please try again.');
      } else {
        setContent(''); setDraftLinks([]); setPersonId(''); setPersonNameOther(''); setDocumentId('');
        setOccurredAt(toLocalInputValue(new Date()));
        load();
      }
    } finally { setSaving(false); }
  }

  // §B — a âncora do "see in history": rola até à entrada e realça-a por
  // um instante. O id vem da própria entrada do log (ver o li abaixo).
  function scrollToEntry(entryId: string) {
    const el = document.getElementById(`log-entry-${entryId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-[#0E7490]');
    setTimeout(() => el.classList.remove('ring-2', 'ring-[#0E7490]'), 1600);
  }

  const journeyStrip = journey && entries != null ? investorJourneySteps({
    entries: entries.map((e) => ({ id: e.id, kind: e.kind, at: e.at, document: e.document })),
    messages: journey.messages, accessibleDocs: journey.accessibleDocs,
    status: journey.status, decidedAt: journey.decidedAt,
  }) : null;

  return (
    <div>
      {journeyStrip && (
        <InvestorJourneyStrip steps={journeyStrip} onOpenDoc={journey!.onOpenDoc} onSeeInHistory={scrollToEntry} />
      )}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-medium text-gray-700">Log interaction</label>
          <a href={`/api/portal/export?type=interaction-log&orgId=${encodeURIComponent(orgId)}`}
            className="text-xs text-gray-400 hover:underline">
            Export CSV
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={channel} onChange={(e) => setChannel(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs">
            {CHANNEL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input type="datetime-local" value={occurredAt} max={toLocalInputValue(new Date())}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700" />
        </div>
        {personDocAvailable && people.length > 0 && (
          <select value={personId} onChange={(e) => setPersonId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs">
            <option value="">Who was this with? (optional)</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}{p.title ? ` — ${p.title}` : ''}{p.isFounder ? ' · Founder' : ''}</option>)}
            <option value={OTHER_PERSON_VALUE}>Other…</option>
          </select>
        )}
        {personDocAvailable && personId === OTHER_PERSON_VALUE && (
          <input value={personNameOther} onChange={(e) => setPersonNameOther(e.target.value)} placeholder="Their name"
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
        )}
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={2} placeholder="What happened?"
          className="mt-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
        {personDocAvailable && documents.length > 0 && (
          <select value={documentId} onChange={(e) => setDocumentId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs">
            <option value="">Attach a data-room document (optional)</option>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
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
      </div>

      <div className="mt-4 space-y-2">
        {entries == null ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-400">No interactions yet.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} id={`log-entry-${e.id}`} className="rounded border border-gray-100 bg-gray-50 p-3 text-sm transition-shadow">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{fmtDateTime(e.at)}</span>
                  {e.kind === 'manual' && e.channel && (
                    <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5">{CHANNEL_LABEL[e.channel] ?? e.channel}</span>
                  )}
                  {e.personName && <span className="text-gray-500">with {e.personName}</span>}
                  {e.kind !== 'manual' && <span className="font-medium text-gray-600">{KIND_LABEL[e.kind]}</span>}
                </div>
                <p className="whitespace-pre-wrap text-gray-700">{e.content}</p>
                {(e.links.length > 0 || e.document) && (
                  <ul className="mt-1.5 space-y-0.5">
                    {e.document && (
                      <li className="text-xs text-[#0E7490]">📄 {e.document.name} (data room)</li>
                    )}
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
  );
}
