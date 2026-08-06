'use client';
// Investor identity verification, Fase B (prompt 64), Bloco 3 — Network.
// "Ask a verified contact to vouch for you." Shown to anyone not yet
// Verified (pending_verification or self_declared_individual).
import { useEffect, useState } from 'react';
import { VOUCH_THRESHOLD } from '@/lib/investor-identity';

interface Vouch { id: string; target_email: string; status: string; requested_at: string; confirmed_at: string | null }

export function VouchingCard() {
  const [vouches, setVouches] = useState<Vouch[] | null>(null);
  const [distinctCount, setDistinctCount] = useState(0);
  const [targetEmail, setTargetEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState('');

  function load() {
    fetch('/api/portal/vouch').then((r) => r.json()).then((d) => {
      setVouches(d.vouches ?? []);
      setDistinctCount(d.distinctVoucherEntityCount ?? 0);
    });
  }
  useEffect(load, []);

  async function request() {
    if (!targetEmail.trim()) return;
    setBusy(true); setErr(''); setLink(null);
    try {
      const res = await fetch('/api/portal/vouch', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetEmail: targetEmail.trim() }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not create request.'); return; }
      if (body.link) setLink(`${window.location.origin}${body.link}`);
      setTargetEmail('');
      load();
    } finally { setBusy(false); }
  }

  if (!vouches) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Ask a verified contact to vouch for you</h2>
      <p className="mt-1 text-xs text-gray-500">
        {distinctCount}/{VOUCH_THRESHOLD} references from distinct firms — {VOUCH_THRESHOLD} upgrades your badge to
        Verified. This doesn&apos;t replace an official document if one&apos;s ever needed, and it never changes soft commits
        you&apos;ve already had confirmed.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={targetEmail} onChange={(e) => setTargetEmail(e.target.value)} placeholder="Their email"
          className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <button onClick={request} disabled={busy || !targetEmail.trim()} className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {busy ? 'Requesting…' : 'Request reference'}
        </button>
      </div>
      {link && (
        <p className="mt-2 text-xs text-gray-600">
          Share this link with them: <a href={link} className="text-[#0E7490] hover:underline">{link}</a>
        </p>
      )}
      {err && <p className="mt-1.5 text-xs text-[#B00000]">{err}</p>}

      {vouches.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-gray-100 pt-2">
          {vouches.map((v) => (
            <li key={v.id} className="flex items-center justify-between text-xs">
              <span className="text-gray-600">{v.target_email}</span>
              <span className={v.status === 'confirmed' ? 'text-green-700' : 'text-gray-400'}>{v.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
