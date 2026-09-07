'use client';
// Prompt 602 §C/§D — owner only. The word is CLOSE, not delete: the screen
// says what is kept, for how long and why, and offers the separate path for
// effective deletion (GDPR, Article 17), which goes into the existing
// privacy-request queue. Re-authentication and the typed company name.
import { useState } from 'react';
import { Card } from '@/components/ui';
import { ACCOUNT_RETENTION_DAYS } from '@/lib/account-security';

export function CloseAccountCard({ orgName, myRole }: { orgName: string; myRole: string | null }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (myRole !== 'owner') return null;

  async function close() {
    setErr(''); setBusy(true);
    try {
      const res = await fetch('/api/account/close-org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword: password, confirmName: typed }) });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not close the account.'); return; }
      const until = body.purgeAfter ? `&until=${encodeURIComponent(body.purgeAfter)}` : '';
      window.location.href = `/closed?name=${encodeURIComponent(orgName)}${until}`;
    } finally { setBusy(false); }
  }

  return (
    <Card title="Close this account" tint="red">
      <div className="space-y-3 text-sm text-gray-700">
        <p>Closing <b>{orgName}</b> ends access for every member at once: the company leaves the market and every investor view, and the subscription is cancelled.</p>
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600">
          <p className="font-semibold text-gray-800">What stays, for how long, and why</p>
          <p className="mt-1">Nothing is deleted when you close. Your data is kept for <b>{ACCOUNT_RETENTION_DAYS} days</b> so a mistake, a dispute, an invoice or a malicious act can still be undone or examined; within that window you can ask support to reopen the account. After it, the account can no longer be reopened from the app.</p>
          <p className="mt-1">Closing is not the same as erasing. To ask for the <b>effective deletion of your data</b> (GDPR, Article 17), use the separate <a href="/privacy-request" className="text-[#0E7490] underline">data-rights request</a> — it has its own legal deadline and is handled as such.</p>
        </div>
        {!open ? (
          <button onClick={() => setOpen(true)} className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50">Close this account…</button>
        ) : (
          <div className="space-y-2 rounded-lg border border-red-200 bg-white p-3">
            <p className="text-xs text-gray-600">To confirm, enter your password and type the company name exactly: <b>{orgName}</b></p>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Company name" autoComplete="off" className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            <div className="flex items-center gap-2">
              <button disabled={busy || !password || !typed} onClick={close}
                className="rounded-lg bg-[#B00000] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{busy ? 'Closing…' : 'Close the account now'}</button>
              <button onClick={() => { setOpen(false); setErr(''); }} className="text-xs text-gray-500">Cancel</button>
            </div>
            {err && <p className="text-xs text-[#B00000]">{err}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}
