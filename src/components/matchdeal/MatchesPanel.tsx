'use client';
// Prompt 97 §2 — Matches tab. Reads directly via the browser client: RLS
// (matchdeal_matches_participants / matchdeal_profiles_select_visible)
// already scopes every row to the caller, the same trust boundary the deck
// itself relies on for its RPC calls. Only the consent decision goes
// through a server route (see api/matchdeal/matches/consent) — the
// underlying RPC has no ownership check of its own.
//
// The row of actions ("Undo — X — Approved — Send") comes from Prompt 97,
// explicitly flagged there as the doc author's own reading, not confirmed
// by Nuno word-for-word — build it, but say so if there's real doubt while
// building. There is real doubt about what "Undo" means once a decision is
// already submitted (the RPC has no clean path back to pending_consent),
// so this implementation keeps Undo strictly PRE-submission: tapping X or
// Approved stages a choice locally and shows a confirm strip; Undo there
// only clears the stage, no API call has happened yet. Once a decision is
// actually confirmed it becomes permanent here, same as it already is at
// the database layer — flagged in the delivery report for Nuno to correct
// if he meant something else.
import { useCallback, useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase';

interface ProfileStub { entity_name: string | null; photo_url: string | null; entity_logo_url: string | null; representative_name?: string | null }
interface MatchRow {
  id: string;
  status: 'pending_consent' | 'active' | 'declined_by_startup' | 'expired_no_followup' | 'closed_by_startup';
  dataroom_granted_at: string | null;
  created_at: string;
  startup: ProfileStub | null;
  investor: ProfileStub | null;
}

const STATUS_LABEL: Record<MatchRow['status'], string> = {
  pending_consent: 'Awaiting your decision',
  active: 'Data room open',
  declined_by_startup: 'Declined',
  expired_no_followup: 'Expired',
  closed_by_startup: 'Closed',
};
const STATUS_COLOR: Record<MatchRow['status'], string> = {
  pending_consent: 'text-amber-300 bg-amber-400/10',
  active: 'text-emerald-300 bg-emerald-400/10',
  declined_by_startup: 'text-white/50 bg-white/5',
  expired_no_followup: 'text-white/50 bg-white/5',
  closed_by_startup: 'text-white/50 bg-white/5',
};

const SEND_PLACEHOLDER = "Direct messaging isn't available yet — it unlocks once this profile has more information filled in. Coming soon.";

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

export function MatchesPanel({ viewerProfileId, viewerKind }: { viewerProfileId: string; viewerKind: 'startup' | 'investor' }) {
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [staged, setStaged] = useState<Record<string, 'approve' | 'decline'>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await browserClient()
      .from('matchdeal_matches')
      .select(`
        id, status, dataroom_granted_at, created_at,
        startup:matchdeal_profiles!matchdeal_matches_startup_profile_id_fkey(entity_name,photo_url,entity_logo_url),
        investor:matchdeal_profiles!matchdeal_matches_active_investor_profile_id_fkey(entity_name,photo_url,entity_logo_url,representative_name)
      `)
      .order('created_at', { ascending: false });
    if (error) { setRows([]); return; }
    setRows((data ?? []) as unknown as MatchRow[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  async function confirmDecision(matchId: string, granted: boolean) {
    setBusy(matchId);
    try {
      const res = await fetch('/api/matchdeal/matches/consent', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matchId, granted }),
      });
      const body = await res.json();
      if (!body.ok) { setToast(body.error ?? 'Could not record that decision.'); return; }
      setStaged((s) => { const n = { ...s }; delete n[matchId]; return n; });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (rows === null) {
    return <div className="flex flex-1 items-center justify-center"><p className="text-sm text-white/60">Loading matches…</p></div>;
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="text-4xl">🤝</div>
        <p className="mt-3 text-[15px] font-semibold text-white">No matches yet</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">Keep swiping on DealDigger — mutual likes show up here.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      {toast && (
        <div className="sticky top-0 z-10 mb-2 rounded-2xl bg-slate-800/95 px-4 py-2.5 text-center text-[13px] font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
      <div className="space-y-2.5">
        {rows.map((m) => {
          const counterpart = viewerKind === 'startup' ? m.investor : m.startup;
          const name = counterpart?.entity_name || counterpart?.representative_name || (viewerKind === 'startup' ? 'An investor' : 'A startup');
          const stage = staged[m.id];
          const canDecide = viewerKind === 'startup' && m.status === 'pending_consent';

          return (
            <div key={m.id} className="rounded-2xl border border-white/10 bg-white/[0.06] p-3.5">
              <div className="flex items-center gap-3">
                <Avatar p={counterpart} name={name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-white">{name}</p>
                  <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_COLOR[m.status]}`}>
                    {STATUS_LABEL[m.status]}
                  </span>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                {canDecide && !stage && (
                  <>
                    <button type="button" disabled className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/25">
                      Undo
                    </button>
                    <button
                      type="button" onClick={() => setStaged((s) => ({ ...s, [m.id]: 'decline' }))}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white text-[15px] font-bold text-rose-500"
                      aria-label="Decline"
                    >
                      ✕
                    </button>
                    <button
                      type="button" onClick={() => setStaged((s) => ({ ...s, [m.id]: 'approve' }))}
                      className="flex-1 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 px-3 py-1.5 text-[12px] font-bold text-white"
                    >
                      Approved
                    </button>
                    <button
                      type="button" onClick={() => setSendNotice(true)}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-[14px] text-white/70" aria-label="Send"
                    >
                      ➤
                    </button>
                  </>
                )}

                {canDecide && stage && (
                  <div className="flex w-full flex-col gap-2 rounded-xl bg-black/20 p-2.5">
                    <p className="text-[12px] leading-snug text-white/75">
                      {stage === 'approve'
                        ? `Approve data room access for ${name}? They'll be able to view your data room documents.`
                        : `Decline data room access for ${name}? This isn't easily reversed.`}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button" onClick={() => setStaged((s) => { const n = { ...s }; delete n[m.id]; return n; })}
                        className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/80"
                      >
                        Undo
                      </button>
                      <button
                        type="button" disabled={busy === m.id} onClick={() => void confirmDecision(m.id, stage === 'approve')}
                        className={`flex-1 rounded-full px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50 ${
                          stage === 'approve' ? 'bg-gradient-to-br from-emerald-400 to-green-600' : 'bg-rose-500'
                        }`}
                      >
                        {busy === m.id ? 'Saving…' : stage === 'approve' ? 'Confirm approve' : 'Confirm decline'}
                      </button>
                    </div>
                  </div>
                )}

                {!canDecide && (
                  <button
                    type="button" onClick={() => setSendNotice(true)}
                    className="ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-[14px] text-white/70" aria-label="Send"
                  >
                    ➤
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {sendNotice && (
        <div
          role="dialog" aria-label="Direct messaging"
          className="fixed inset-0 z-20 flex flex-col items-center justify-end bg-[#0B1220]/70 backdrop-blur-sm"
          onClick={() => setSendNotice(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl border-t border-white/10 bg-[#111a2e] p-6 text-center"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-3xl">💬</div>
            <h2 className="mt-2 text-[17px] font-bold text-white">Direct messaging</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-white/65">{SEND_PLACEHOLDER}</p>
            <button
              type="button" onClick={() => setSendNotice(false)}
              className="mt-5 w-full rounded-full bg-white/10 py-3 text-[14px] font-semibold text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
