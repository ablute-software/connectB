'use client';
// Prompt 531 §§19-25 — what the reported startup sees, and where it
// contests.
//
// The rule this component exists under: it renders ONLY what
// /api/network/moderation returns, and that route returns only
// toStartupStrikeView's output. There is no reporter name here, no report
// category, no reporter free text, and no count of how many people
// reported — not hidden with CSS, but absent from the payload, so nothing
// can be recovered from the network tab either.
//
// It renders nothing at all when there is nothing to say, which is the
// normal case for almost every account: a moderation panel permanently
// occupying space on My Network would be the opposite of the Sherlock rule
// about reducing perceived weight.
import { useCallback, useEffect, useState } from 'react';

interface ContentSnapshot {
  postId: string | null; body: string; kind: string; structured: Record<string, string> | null;
  target: string | null; groupName: string | null; createdAt: string | null;
  authorActorId: string | null; authorName: string | null;
}
interface StrikeView {
  strikeId: string; appliedAt: string; status: 'active' | 'reversed'; outcome: string;
  contentRemoved: boolean; content: ContentSnapshot | null;
  appeal: { status: 'pending' | 'upheld' | 'reversed'; submittedAt: string; decidedAt: string | null } | null;
  canAppeal: boolean;
}

const APPEAL_LABEL: Record<'pending' | 'upheld' | 'reversed', string> = {
  pending: 'Appeal under review', upheld: 'Appeal reviewed — strike stands', reversed: 'Appeal upheld — strike reversed',
};

export function NetworkModerationNotice() {
  const [strikes, setStrikes] = useState<StrikeView[] | null>(null);
  const [consequence, setConsequence] = useState('');
  const [banned, setBanned] = useState(false);
  const [appealFor, setAppealFor] = useState<string | null>(null);
  const [appealText, setAppealText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    fetch('/api/network/moderation').then((r) => r.json()).then((body) => {
      if (!body.available) { setStrikes([]); return; }
      setStrikes(body.strikes ?? []);
      setConsequence(body.consequence ?? '');
      setBanned(!!body.banned);
    }).catch(() => setStrikes([]));
  }, []);
  useEffect(load, [load]);

  async function submitAppeal(strikeId: string) {
    if (!appealText.trim()) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/network/moderation', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strikeId, body: appealText.trim() }),
      });
      const data = await res.json();
      if (!data.ok) { setErr(data.error ?? 'Could not submit.'); return; }
      setAppealFor(null); setAppealText('');
      load();
    } finally { setBusy(false); }
  }

  if (!strikes || strikes.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-bold text-amber-900">My Network moderation</h2>
      {consequence && <p className="mt-0.5 text-xs text-amber-800">{consequence}</p>}
      {banned && (
        <p className="mt-1 text-xs font-medium text-[#B00000]">
          You can still see and receive on My Network, but posting, inviting and requesting are paused.
        </p>
      )}
      {err && <p className="mt-1 text-xs text-[#B00000]">{err}</p>}

      <ul className="mt-3 space-y-2">
        {strikes.map((s) => (
          <li key={s.strikeId} className="rounded-xl border border-amber-100 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className={`rounded-full px-2 py-0.5 font-bold ${s.status === 'active' ? 'bg-red-100 text-[#B00000]' : 'bg-gray-100 text-gray-500'}`}>
                {s.status === 'active' ? 'Strike' : 'Reversed'}
              </span>
              <span className="text-gray-400">{s.appliedAt.slice(0, 10)}</span>
              {s.contentRemoved && <span className="rounded bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-600">Post removed</span>}
              {s.appeal && (
                <span className={`rounded-full px-2 py-0.5 font-bold ${s.appeal.status === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
                  {APPEAL_LABEL[s.appeal.status]}
                </span>
              )}
            </div>

            <p className="mt-1.5 text-xs text-gray-700">{s.outcome}</p>

            {/* The content that received the strike — from the snapshot, so
                it is still here to identify even when the post itself was
                removed. */}
            {s.content?.body && (
              <div className="mt-2 rounded-lg border-l-2 border-gray-200 bg-gray-50 p-2">
                {s.content.createdAt && <p className="text-[10px] text-gray-400">Posted {s.content.createdAt.slice(0, 10)}</p>}
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-gray-700">
                  {s.content.body.length > 500 ? `${s.content.body.slice(0, 500)}…` : s.content.body}
                </p>
              </div>
            )}

            {s.canAppeal && (appealFor === s.strikeId ? (
              <div className="mt-2">
                <textarea value={appealText} onChange={(e) => setAppealText(e.target.value)} rows={3} autoFocus
                  placeholder="Why do you believe this was a mistake?"
                  className="w-full rounded-lg border border-gray-300 p-2 text-xs" />
                <div className="mt-1.5 flex gap-1.5">
                  <button onClick={() => submitAppeal(s.strikeId)} disabled={busy || !appealText.trim()}
                    className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:bg-gray-300">
                    Send
                  </button>
                  <button onClick={() => { setAppealFor(null); setAppealText(''); }}
                    className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAppealFor(s.strikeId)}
                className="mt-2 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                Contest decision
              </button>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
