'use client';
// MatchDeal QR pairing modal — one shared component for both workspaces
// (spec: "o mesmo componente e o mesmo comportamento" for founder and
// investor), replacing the old "membership_id exists = connected" text
// modal on both sides. "Connected" now means an active row in
// matchdeal_pairings, not a matchdeal_profiles row existing.
//
// Live confirmation is POLLING (spec Section 6 explicitly allows this as
// equal to Realtime) — this codebase has never used Supabase Realtime
// anywhere before; polling every 3s is the simpler, provably-reliable
// choice for a first version, not a shortcut hiding a harder problem.
//
// Scanning the QR today has nowhere real to land on a phone: MatchDeal
// isn't on the App Store or Play Store yet (confirmed in the prior
// modal's own comment), and no Universal Link / App Link registration
// exists on either side. The web half below is fully real and testable;
// the phone half stays inert until the app team wires up
// matchdeal-qr-pair and the app is store-published. See /matchdeal/pair
// for the honest holding page a phone lands on today.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

type PairingKind = 'startup' | 'investor';
type ModalState = 'loading' | 'not_paired' | 'waiting' | 'expired' | 'paired' | 'error';
interface Pairing { id: string; device_id: string; paired_at: string; last_seen_at: string }

const POLL_INTERVAL_MS = 3000;

export function MatchDealPairingModal({ kind, onClose }: { kind: PairingKind; onClose: () => void }) {
  const [state, setState] = useState<ModalState>('loading');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pairUrl, setPairUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmingDisconnect, setConfirmingDisconnect] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function checkStatus(): Promise<{ linked: boolean; pairings: Pairing[] } | null> {
    const res = await fetch(`/api/matchdeal/pairing/status?kind=${kind}`);
    const body = await res.json();
    if (!body.ok) return null;
    return { linked: body.linked, pairings: body.pairings ?? [] };
  }

  async function generate() {
    setBusy(true); setErrorMsg('');
    try {
      const res = await fetch('/api/matchdeal/pairing/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }),
      });
      const body = await res.json();
      if (!body.ok) { setErrorMsg(body.error ?? 'Could not generate a code.'); setState('error'); return; }
      setPairUrl(body.pairUrl); setExpiresAt(body.expiresAt);
      const dataUrl = await QRCode.toDataURL(body.pairUrl, { width: 240, margin: 1 });
      setQrDataUrl(dataUrl);
      setState('waiting');
      startPolling();
    } catch {
      setErrorMsg('Network error — try again.'); setState('error');
    } finally {
      setBusy(false);
    }
  }

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      if (expiresAt && new Date(expiresAt) <= new Date()) {
        stopPolling(); setState('expired'); return;
      }
      const status = await checkStatus();
      if (status?.linked && status.pairings.length > 0) {
        stopPolling(); setPairings(status.pairings); setState('paired');
      }
    }, POLL_INTERVAL_MS);
  }

  useEffect(() => {
    (async () => {
      const status = await checkStatus();
      if (!status) { setErrorMsg('Could not check MatchDeal status.'); setState('error'); return; }
      if (!status.linked) { setErrorMsg('No linked organization for this account.'); setState('error'); return; }
      if (status.pairings.length > 0) { setPairings(status.pairings); setState('paired'); return; }
      await generate();
    })();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function disconnect(pairingId: string) {
    setBusy(true);
    try {
      const res = await fetch('/api/matchdeal/pairing/disconnect', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pairingId, kind }),
      });
      const body = await res.json();
      if (!body.ok) { setErrorMsg(body.error ?? 'Could not disconnect.'); return; }
      setConfirmingDisconnect(null);
      const status = await checkStatus();
      if (status && status.pairings.length > 0) { setPairings(status.pairings); setState('paired'); }
      else { setPairings([]); await generate(); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-800">🤝 MatchDeal</h2>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
        </div>

        {state === 'loading' && <p className="mt-3 text-sm text-gray-400">Checking status…</p>}

        {state === 'waiting' && qrDataUrl && (
          <div className="mt-3 text-center">
            <p className="text-sm font-medium text-gray-800">Connect MatchDeal</p>
            <img src={qrDataUrl} alt="MatchDeal pairing QR code" className="mx-auto mt-3 h-[240px] w-[240px] rounded-lg border border-gray-100" />
            <p className="mt-3 text-xs text-gray-600">
              Point your phone camera at the code. If you already have the MatchDeal app, it will open and pair
              automatically. If not, you&apos;ll be taken to a page to get it.
            </p>
            <p className="mt-2 text-xs text-amber-700">Waiting for your phone…</p>
            {pairUrl && (
              <p className="mt-3 text-[11px] text-gray-400">
                On your phone already?{' '}
                <a href={pairUrl} className="text-[#0E7490] hover:underline">Open this link</a>
              </p>
            )}
          </div>
        )}

        {state === 'expired' && (
          <div className="mt-3 text-center">
            <p className="text-sm text-gray-600">This code has expired.</p>
            <button onClick={generate} disabled={busy} className="mt-3 rounded-lg bg-[#0E7490] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Generate a new code
            </button>
          </div>
        )}

        {state === 'paired' && (
          <div className="mt-3">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
              <span>✓</span>
              <span>MatchDeal is connected.</span>
            </div>
            <ul className="mt-3 space-y-2">
              {pairings.map((p) => (
                <li key={p.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-xs text-gray-600">
                  <span>Paired on {new Date(p.paired_at).toLocaleDateString()}</span>
                  {confirmingDisconnect === p.id ? (
                    <span className="flex items-center gap-1.5">
                      <button onClick={() => disconnect(p.id)} disabled={busy} className="font-semibold text-[#B00000] hover:underline disabled:opacity-40">Confirm</button>
                      <button onClick={() => setConfirmingDisconnect(null)} className="text-gray-400 hover:underline">Cancel</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmingDisconnect(p.id)} className="text-gray-400 hover:underline">Disconnect</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {state === 'error' && (
          <div className="mt-3 text-center">
            <p className="text-sm text-gray-600">{errorMsg || 'Something went wrong.'}</p>
            <button onClick={generate} disabled={busy} className="mt-3 rounded-lg bg-[#0E7490] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
