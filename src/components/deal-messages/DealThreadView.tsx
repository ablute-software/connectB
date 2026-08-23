'use client';
// P134-C — shared Sherlock messaging thread UI, used by both sides: the
// investor dossier's Messages tab and the founder's own /messages page.
// Only the fetch/post URLs and which side "I" am differ between callers —
// the chronological list, composer, and "Seen" logic are identical.
import { useEffect, useRef, useState } from 'react';

export interface MessageDoc { id: string; name: string; accessible: boolean }
export interface DealMessage {
  id: string; senderSide: 'investor' | 'founder'; senderUserId: string;
  body: string; links: { label: string; url: string }[]; documentIds: string[];
  // Prompt 210 §A.4 — resolvido pelo servidor (nome + acesso). Opcional para
  // nao partir um cliente antigo em cache a meio de um deploy; nesse caso
  // cai-se na contagem de sempre.
  documents?: MessageDoc[]; createdAt: string;
}
export interface AttachableDoc { id: string; name: string }

// Prompt 182 — mirrors SupportTicketsPanel.tsx's SUPPORT_TICKET_READ_EVENT/
// useSupportUnreadCount exactly (Prompt 176 §B.4). shell.tsx's Messages nav
// badge used to fetch /api/founder/messages once on mount and never again:
// opening and reading a thread DOES mark it read server-side (GET
// /api/founder/messages/[threadId] -> markThreadRead, see that route) but
// nothing ever told the badge to re-check, so it stayed stuck at whatever
// it was on first load until a full page reload. Dispatched from load()
// below, right after a successful GET — the same moment the founder route
// marks the thread read — so every independently-mounted badge instance
// (today, just shell.tsx's sidebar) re-fetches in response.
//
// Founder-only: the investor side (InvestorWorkspaceShell.tsx) has no
// Messages badge to refresh (only Support, already correct) — this
// component is shared by both viewerSide values, so the dispatch itself is
// gated to avoid firing a pointless event on the investor side.
const MESSAGE_THREAD_READ_EVENT = 'sherlock-message-thread-read';

export function useUnreadMessagesCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch('/api/founder/messages').then((r) => r.json()).then((d) => {
        if (cancelled) return;
        setCount((d.threads ?? []).filter((t: { unread: boolean }) => t.unread).length);
      }).catch(() => {});
    }
    load();
    window.addEventListener(MESSAGE_THREAD_READ_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(MESSAGE_THREAD_READ_EVENT, load); };
  }, []);
  return count;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function DealThreadView({
  viewerSide, fetchUrl, postUrl, extraPostBody, attachableDocuments, disabled, disabledReason,
}: {
  viewerSide: 'investor' | 'founder';
  fetchUrl: string;
  postUrl: string;
  // Merged into the POST body — the investor route needs {orgId} since it's
  // a single shared endpoint (not one per startup); the founder's per-thread
  // route needs nothing extra (the thread id is already in its URL).
  extraPostBody?: Record<string, unknown>;
  // Only ever documents the caller has independently verified this viewer
  // may attach (investor: their own firm's data-room grants; founder:
  // their own org's documents) — this component trusts whatever list it's
  // given, the server route re-validates on submit regardless.
  attachableDocuments?: AttachableDoc[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [messages, setMessages] = useState<DealMessage[] | null>(null);
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [draftLinks, setDraftLinks] = useState<{ label: string; url: string }[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [showAttach, setShowAttach] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  function load() {
    fetch(fetchUrl).then((r) => r.json()).then((d) => {
      setMessages(d.messages ?? []);
      // Investor route returns founderLastReadAt; founder route (per-thread)
      // has no equivalent field yet — undefined just means no "Seen" shown.
      if ('founderLastReadAt' in d) setOtherLastReadAt(d.founderLastReadAt ?? null);
      // This GET is also what marks the thread read server-side on the
      // founder route (markThreadRead) — telling every mounted
      // useUnreadMessagesCount() to re-check is what makes the badge drop
      // immediately instead of only after a full page reload.
      if (viewerSide === 'founder') window.dispatchEvent(new Event(MESSAGE_THREAD_READ_EVENT));
    });
  }
  useEffect(load, [fetchUrl]);
  useEffect(() => { listEndRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages]);

  function addLink() {
    const url = linkUrl.trim();
    if (!/^https?:\/\//i.test(url)) return;
    setDraftLinks((ls) => [...ls, { label: linkLabel.trim() || url, url }]);
    setLinkLabel(''); setLinkUrl('');
  }
  function toggleDoc(id: string) {
    setSelectedDocIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function send() {
    if (!body.trim() || sending) return;
    setSending(true); setError(null);
    try {
      const res = await fetch(postUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...extraPostBody, body, links: draftLinks, documentIds: selectedDocIds }),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok || resBody.ok === false) {
        setError(resBody.error ?? 'Something went wrong — please try again.');
      } else {
        setBody(''); setDraftLinks([]); setSelectedDocIds([]); setShowAttach(false);
        load();
      }
    } finally { setSending(false); }
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  if (disabled) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        {disabledReason ?? 'Messaging isn\'t available here yet.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="max-h-[28rem] min-h-[10rem] space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3">
        {messages == null ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-400">No messages yet — say hello.</p>
        ) : (
          messages.map((m, i) => {
            const mine = m.senderSide === viewerSide;
            const isLast = i === messages.length - 1;
            const seen = mine && otherLastReadAt != null && otherLastReadAt >= m.createdAt;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-[#0E7490] text-white' : 'bg-gray-100 text-gray-800'}`}>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  {m.links.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {m.links.map((l, j) => (
                        <li key={j}>
                          <a href={l.url} target="_blank" rel="noreferrer" className={`text-xs hover:underline ${mine ? 'text-cyan-100' : 'text-[#0E7490]'}`}>{l.label} →</a>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Prompt 210 §A.4 — anexar NAO cria acesso: um documento a
                      que este leitor nao tenha direito mostra "request
                      access" em vez de um link que ia falhar. */}
                  {m.documents && m.documents.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {m.documents.map((d) => (
                        <li key={d.id} className={`text-xs ${mine ? 'text-cyan-100' : 'text-gray-600'}`}>
                          📎{' '}
                          {d.accessible ? (
                            <a href={`/documents?doc=${d.id}`} className={`hover:underline ${mine ? 'text-white' : 'text-[#0E7490]'}`}>{d.name}</a>
                          ) : (
                            <span>{d.name} <span className={mine ? 'text-cyan-200' : 'text-amber-700'}>— request access</span></span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : m.documentIds.length > 0 ? (
                    <p className={`mt-1 text-xs ${mine ? 'text-cyan-100' : 'text-gray-500'}`}>📎 {m.documentIds.length} document{m.documentIds.length === 1 ? '' : 's'} attached</p>
                  ) : null}
                  <div className={`mt-1 text-[10px] ${mine ? 'text-cyan-100' : 'text-gray-400'}`}>
                    {fmtDateTime(m.createdAt)}{isLast && seen && ' · Seen'}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={listEndRef} />
      </div>

      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]">{error}</p>}

      <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onComposerKeyDown} rows={2}
          placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
          className="w-full resize-none rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm" />
        {draftLinks.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {draftLinks.map((l, i) => (
              <li key={i} className="flex items-center justify-between text-[11px] text-gray-500">
                <span className="truncate">{l.label}</span>
                <button onClick={() => setDraftLinks((ls) => ls.filter((_, idx) => idx !== i))} className="text-gray-400 hover:underline">Remove</button>
              </li>
            ))}
          </ul>
        )}
        {selectedDocIds.length > 0 && (
          <p className="mt-1 text-[11px] text-gray-500">📎 {selectedDocIds.length} document{selectedDocIds.length === 1 ? '' : 's'} selected</p>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <button onClick={() => setShowAttach((v) => !v)} className="text-xs text-gray-400 hover:underline">
            {showAttach ? 'Hide attach' : '+ Attach'}
          </button>
          <button onClick={send} disabled={sending || !body.trim()} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        {showAttach && (
          <div className="mt-2 space-y-2 border-t border-gray-200 pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Link label (optional)"
                className="w-32 rounded-lg border border-gray-300 px-2 py-1 text-[11px]" />
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…"
                className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-[11px]" />
              <button onClick={addLink} className="rounded-lg border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-white">+ Link</button>
            </div>
            {attachableDocuments && attachableDocuments.length > 0 && (
              <div>
                <p className="text-[11px] text-gray-400">Attach a document from the data room:</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {attachableDocuments.map((d) => (
                    <button key={d.id} onClick={() => toggleDoc(d.id)}
                      className={`rounded-full border px-2 py-1 text-[11px] ${selectedDocIds.includes(d.id) ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-200 text-gray-600'}`}>
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
