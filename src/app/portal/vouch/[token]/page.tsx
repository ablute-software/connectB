'use client';
// Investor identity verification, Fase B (prompt 64), Bloco 3 — the page a
// verified contact lands on to confirm a reference request. Public route
// (middleware treats /portal/* as public), but confirming requires being
// signed in as the exact target — never an anonymous/open form.
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { browserClient, authEnabled } from '@/lib/supabase';

interface Info { status: string; targetEmail: string; requesterEntityName: string; expired: boolean }

export default function VouchConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`/api/portal/vouch/confirm?token=${encodeURIComponent(token)}`).then((r) => r.json()).then(setInfo);
    if (!authEnabled) { setSessionEmail(null); return; }
    browserClient().auth.getUser().then(({ data }) => setSessionEmail(data.user?.email ?? null));
  }, [token]);

  async function confirm() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/portal/vouch/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not confirm.'); return; }
      setDone(true);
    } finally { setBusy(false); }
  }

  if (!info || sessionEmail === undefined) return <div className="mx-auto max-w-sm p-8 text-sm text-gray-400">Loading…</div>;

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-2xl border border-gray-100 bg-white p-6 shadow-lg">
      <h1 className="text-lg font-bold text-[#0E7490]">Confirm a reference</h1>
      {info.status !== 'pending' ? (
        <p className="mt-3 text-sm text-gray-600">This link has already been used or is no longer valid.</p>
      ) : info.expired ? (
        <p className="mt-3 text-sm text-gray-600">This link has expired.</p>
      ) : done ? (
        <p className="mt-3 text-sm font-medium text-green-700">Thanks — your reference has been recorded.</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-gray-700">
            Someone from <b>{info.requesterEntityName}</b> is asking you to confirm you know them and that they invest
            as described. This only counts if you're signed in as <b>{info.targetEmail}</b>.
          </p>
          {sessionEmail !== info.targetEmail ? (
            <p className="mt-3 text-xs text-amber-700">
              You're signed in as {sessionEmail ?? 'no one'} — sign in as {info.targetEmail} to confirm this.
            </p>
          ) : (
            <button onClick={confirm} disabled={busy} className="mt-4 w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? 'Confirming…' : 'Yes, I confirm this reference'}
            </button>
          )}
          {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
        </>
      )}
    </div>
  );
}
