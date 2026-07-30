'use client';
// MatchDeal QR pairing v2 — app.sherlockdeal.com/pair. This is the real
// PWA destination the QR code always points to now (spec: "o URL abre
// sempre a PWA... que faz o emparelhamento", never a store redirect that
// has nowhere real to send anyone — MatchDeal isn't published yet). Once
// a native app exists with Universal Links registered on this same
// domain, the OS intercepts the URL before it ever reaches this page —
// no code change needed here when that happens.
//
// Reachable today at sherlockdeal.com/pair (same deployment); becomes
// reachable at app.sherlockdeal.com/pair the moment that domain is added
// in Vercel (see the chat report for exactly what that requires) — no
// different code path, this page doesn't care which host served it.
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase';
import { MatchDealDeck } from '@/components/matchdeal/MatchDealDeck';

type Stage = 'checking' | 'need_login' | 'consuming' | 'paired' | 'error';

const DEVICE_ID_KEY = 'sherlockdeal_pwa_device_id';

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_ID_KEY, id); }
  return id;
}

export default function PairPage() {
  const [stage, setStage] = useState<Stage>('checking');
  const [token, setToken] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [kind, setKind] = useState<'startup' | 'investor' | null>(null);
  const [ownProfileId, setOwnProfileId] = useState<string | null>(null);
  const [pairedAt, setPairedAt] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    setToken(t);
    if (!t) { setErrorMsg('Missing pairing code.'); setStage('error'); return; }

    (async () => {
      const { data: { user } } = await browserClient().auth.getUser();
      if (!user) { setStage('need_login'); return; }
      setStage('consuming');
      try {
        const res = await fetch('/api/matchdeal/pairing/consume', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: t, deviceId: getOrCreateDeviceId() }),
        });
        const body = await res.json();
        if (!body.ok) { setErrorMsg(body.error ?? 'Could not pair.'); setStage('error'); return; }
        setKind(body.kind); setOwnProfileId(body.ownProfileId ?? null); setPairedAt(body.pairedAt);
        setStage('paired');
      } catch {
        setErrorMsg('Network error — try again.'); setStage('error');
      }
    })();
  }, []);

  const loginUrl = token ? `/login?next=${encodeURIComponent(`/pair?token=${token}`)}` : '/login';

  return (
    <div className="min-h-screen bg-[#F7F9FA]">
      {stage !== 'paired' && (
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
            <div className="text-2xl">🤝</div>
            <h1 className="mt-2 text-lg font-bold text-gray-900">MatchDeal</h1>

            {stage === 'checking' && <p className="mt-3 text-sm text-gray-400">Checking your session…</p>}

            {stage === 'need_login' && (
              <>
                <p className="mt-2 text-sm text-gray-600">Sign in with the same account you use on sherlockdeal.com to pair this device.</p>
                <a href={loginUrl} className="mt-4 block rounded-lg bg-[#0E7490] px-3.5 py-2 text-sm font-semibold text-white">Sign in</a>
              </>
            )}

            {stage === 'consuming' && <p className="mt-3 text-sm text-gray-400">Pairing…</p>}

            {stage === 'error' && (
              <>
                <p className="mt-2 text-sm text-gray-600">{errorMsg}</p>
                <p className="mt-2 text-xs text-gray-400">Go back to sherlockdeal.com and generate a new code from the MatchDeal button.</p>
              </>
            )}
          </div>
        </div>
      )}

      {stage === 'paired' && kind && (
        <div className="mx-auto max-w-md p-4">
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <span>✓</span>
            <span>Connected to Sherlock Deal{pairedAt ? ` on ${new Date(pairedAt).toLocaleDateString()}` : ''}.</span>
          </div>
          {ownProfileId ? (
            <MatchDealDeck viewerProfileId={ownProfileId} viewerKind={kind} />
          ) : (
            <p className="text-sm text-gray-500">
              Your MatchDeal profile isn&apos;t set up yet — finish it in the app to start seeing matches here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
