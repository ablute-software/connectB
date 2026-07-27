'use client';
// MatchDeal entry point — the one agreed exception to "zero commits in
// connectB" during the MatchDeal build phase (see the integration adenda).
// This modal is intentionally thin: it only checks link status and pairs a
// device via the Edge Function. It does not touch entities/Pipeline at
// all — showing MatchDeal provenance there is deliberately deferred until
// after a first real pairing exists to design against (see the connectB
// entry-point prompt this was built from).
//
// Modal pattern matches AddInvestorModal.tsx (backdrop + stopPropagation
// card) — the existing convention elsewhere in this app.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { browserClient, SUPABASE_URL } from '@/lib/supabase';

type LinkState = 'loading' | 'not_linked' | 'linked' | 'error';

export function MatchDealModal({ onClose }: { onClose: () => void }) {
  const { db } = useStore();
  const [state, setState] = useState<LinkState>('loading');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [linkedOrgName, setLinkedOrgName] = useState<string | null>(null);

  useEffect(() => {
    checkLinked();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkLinked() {
    setState('loading');
    if (!db.org.id) { setState('not_linked'); return; }
    const sb = browserClient();
    // RLS (matchdeal_profiles_select_visible) already scopes this to rows
    // this session's own org can see — the .eq()s are belt-and-braces, not
    // the actual security boundary.
    const { data, error } = await sb
      .from('matchdeal_profiles')
      .select('id')
      .eq('membership_id', db.org.id)
      .eq('kind', 'startup')
      .maybeSingle();
    if (error) { setState('error'); setErr('Could not check MatchDeal status — try again.'); return; }
    setState(data ? 'linked' : 'not_linked');
  }

  async function pair() {
    const pairingToken = token.trim();
    if (!pairingToken || !SUPABASE_URL) return;
    setBusy(true); setErr('');
    try {
      const sb = browserClient();
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { setErr('Your session expired — sign in again.'); return; }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/matchdeal-pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ pairing_token: pairingToken }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 410 || body.error === 'MATCHDEAL_TOKEN_INVALID') {
        setErr('That code is expired or invalid — generate a new one in the MatchDeal app and try again.');
        return;
      }
      if (!body.ok) { setErr(body.error ?? 'Could not connect MatchDeal.'); return; }

      setLinkedOrgName(typeof body.org_name === 'string' ? body.org_name : null);
      setState('linked');
    } catch {
      setErr('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-800">MatchDeal</h2>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
        </div>

        {state === 'loading' && <p className="mt-3 text-sm text-gray-400">Checking status…</p>}

        {state === 'linked' && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <span>✓</span>
            <span>MatchDeal is connected{linkedOrgName ? ` to ${linkedOrgName}` : ''}.</span>
          </div>
        )}

        {(state === 'not_linked' || state === 'error') && (
          <>
            <p className="mt-3 text-sm text-gray-600">
              MatchDeal is a swipe-based matching app for startups and investors — a companion to
              the pipeline you already use here. A mutual match moves straight to sharing your
              data room with the investor who matched.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              MatchDeal is in private beta — it isn&apos;t on the App Store or Play Store yet. Open
              the MatchDeal app on your phone, go to <b>Pair</b>, and enter the code it shows you
              below.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') pair(); }}
                placeholder="Pairing code"
                autoCapitalize="none"
                autoCorrect="off"
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
              <button onClick={pair} disabled={busy || !token.trim()}
                className="shrink-0 rounded-lg bg-[#0E7490] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#0c637b] disabled:opacity-40">
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
          </>
        )}
      </div>
    </div>
  );
}
