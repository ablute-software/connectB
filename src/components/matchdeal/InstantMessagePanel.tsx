'use client';
// Prompt 97 §3 — Instant Message tab. Confirmed live (both from the RLS
// policy and from matchdeal_decide_dataroom_consent's own definition):
// matchdeal_messages only allows INSERT once matchdeal_matches.status =
// 'active' — i.e. after the startup has approved data-room access, not
// merely from the moment a match exists. That's the DB's own enforced rule,
// so this tab only lists active matches rather than every match — a
// pending_consent match has nothing to open here yet, it lives on the
// Matches tab until decided. kind='user' is already an allowed value on
// matchdeal_messages (no schema change needed — kind='system' stays
// reserved for the automated rows the consent RPC already writes).
import { useCallback, useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase';

interface ProfileStub { entity_name: string | null; photo_url: string | null; entity_logo_url: string | null; representative_name?: string | null }
interface ActiveMatch {
  id: string;
  startup: ProfileStub | null;
  investor: ProfileStub | null;
}
interface MessageRow {
  id: string; match_id: string; sender_profile_id: string | null; kind: string; body: string; created_at: string;
}

function initialsOf(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function Avatar({ p, name }: { p: ProfileStub | null; name: string }) {
  const image = p?.photo_url ?? p?.entity_logo_url;
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-[13px] font-bold text-white/70">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : initialsOf(name)}
    </div>
  );
}

function Thread({ match, name, counterpart, viewerProfileId, onBack }: {
  match: ActiveMatch; name: string; counterpart: ProfileStub | null; viewerProfileId: string; onBack: () => void;
}) {
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await browserClient()
      .from('matchdeal_messages').select('id, match_id, sender_profile_id, kind, body, created_at')
      .eq('match_id', match.id).order('created_at', { ascending: true });
    if (error) { setMessages([]); return; }
    setMessages((data ?? []) as MessageRow[]);
  }, [match.id]);

  useEffect(() => { void load(); }, [load]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft('');
    const { error } = await browserClient().from('matchdeal_messages').insert({
      match_id: match.id, sender_profile_id: viewerProfileId, kind: 'user', body,
    });
    setSending(false);
    if (error) { setDraft(body); return; }
    await load();
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <button type="button" onClick={onBack} aria-label="Back to conversations" className="p-1 text-[18px] text-white/70">←</button>
        <Avatar p={counterpart} name={name} />
        <p className="truncate text-[14px] font-semibold text-white">{name}</p>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages === null && <p className="text-center text-[13px] text-white/50">Loading…</p>}
        {messages?.length === 0 && <p className="text-center text-[13px] text-white/50">No messages yet — say hello.</p>}
        {messages?.map((m) => {
          if (m.kind === 'system') {
            return (
              <p key={m.id} className="mx-auto max-w-[85%] rounded-xl bg-white/5 px-3 py-2 text-center text-[11.5px] leading-snug text-white/55">
                {m.body}
              </p>
            );
          }
          const mine = m.sender_profile_id === viewerProfileId;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <p className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
                mine ? 'bg-gradient-to-br from-emerald-500 to-green-600 text-white' : 'bg-white/10 text-white/90'
              }`}>
                {m.body}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-white/10 px-3 py-2.5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}>
        <input
          value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
          placeholder="Message…" maxLength={2000}
          className="flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-[13px] text-white placeholder:text-white/40"
        />
        <button
          type="button" onClick={() => void send()} disabled={!draft.trim() || sending}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-green-600 text-white disabled:opacity-40"
          aria-label="Send message"
        >
          ➤
        </button>
      </div>
    </div>
  );
}

export function InstantMessagePanel({ viewerProfileId, viewerKind }: { viewerProfileId: string; viewerKind: 'startup' | 'investor' }) {
  const [rows, setRows] = useState<ActiveMatch[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await browserClient()
        .from('matchdeal_matches')
        .select(`
          id,
          startup:matchdeal_profiles!matchdeal_matches_startup_profile_id_fkey(entity_name,photo_url,entity_logo_url),
          investor:matchdeal_profiles!matchdeal_matches_active_investor_profile_id_fkey(entity_name,photo_url,entity_logo_url,representative_name)
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (error) { setRows([]); return; }
      setRows((data ?? []) as unknown as ActiveMatch[]);
    })();
  }, []);

  if (rows === null) {
    return <div className="flex flex-1 items-center justify-center"><p className="text-sm text-white/60">Loading conversations…</p></div>;
  }

  const open = rows.find((r) => r.id === openId) ?? null;
  if (open) {
    const counterpart = viewerKind === 'startup' ? open.investor : open.startup;
    const name = counterpart?.entity_name || counterpart?.representative_name || (viewerKind === 'startup' ? 'An investor' : 'A startup');
    return <Thread match={open} name={name} counterpart={counterpart} viewerProfileId={viewerProfileId} onBack={() => setOpenId(null)} />;
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="text-4xl">💬</div>
        <p className="mt-3 text-[15px] font-semibold text-white">No conversations yet</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
          Messaging unlocks once a match approves data room access on the Matches tab.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      <div className="space-y-2">
        {rows.map((m) => {
          const counterpart = viewerKind === 'startup' ? m.investor : m.startup;
          const name = counterpart?.entity_name || counterpart?.representative_name || (viewerKind === 'startup' ? 'An investor' : 'A startup');
          return (
            <button
              key={m.id} type="button" onClick={() => setOpenId(m.id)}
              className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3.5 text-left"
            >
              <Avatar p={counterpart} name={name} />
              <p className="truncate text-[14px] font-semibold text-white">{name}</p>
              <span className="ml-auto text-[13px] text-white/40">›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
