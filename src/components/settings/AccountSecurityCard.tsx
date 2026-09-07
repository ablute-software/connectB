'use client';
// Prompt 602 §A/§B — in App access: change my own password (current one
// required, other sessions end, email without the password); the owner's
// switch "allow an admin to start a reset of my password" (off by default);
// and, for an admin, the owners who allowed it, with a "Send reset link"
// that shows the admin nothing — the owner chooses the password.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { PasswordRequirementsIndicator } from '@/components/auth/PasswordRequirementsIndicator';
import { checkPassword } from '@/lib/password-policy';

interface SecurityInfo {
  available: boolean; myRole?: string; allowAdminPasswordReset?: boolean;
  resettableOwners?: { userId: string; email: string }[];
  events?: { id: string; kind: string; label: string; ip: string | null; at: string; byMe: boolean }[];
}

export function AccountSecurityCard() {
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [toggleBusy, setToggleBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState('');

  function load() {
    fetch('/api/account/security', { cache: 'no-store' }).then((r) => r.json()).then((b) => setInfo(b.ok ? b : { available: false })).catch(() => setInfo({ available: false }));
  }
  useEffect(load, []);

  async function changePassword() {
    setErr(''); setMsg('');
    if (!checkPassword(next).valid) { setErr('The new password does not meet the requirements.'); return; }
    if (next !== confirm) { setErr('The new passwords do not match.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/account/change-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not change the password.'); return; }
      setCurrent(''); setNext(''); setConfirm('');
      setMsg(`Password changed. ${body.otherSessionsEnded} other session${body.otherSessionsEnded === 1 ? '' : 's'} ended${body.emailSent ? '; a confirmation email is on its way' : ''}.`);
      load();
    } finally { setBusy(false); }
  }

  async function setToggle(value: boolean) {
    setToggleBusy(true);
    try {
      const res = await fetch('/api/account/security', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowAdminPasswordReset: value }) });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not save.'); return; }
      load();
    } finally { setToggleBusy(false); }
  }

  async function startOwnerReset(userId: string, email: string) {
    setResetBusy(userId); setResetMsg('');
    try {
      const res = await fetch('/api/account/owner-password-reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetUserId: userId }) });
      const body = await res.json();
      setResetMsg(body.ok ? `A one-time reset link was sent to ${email}, with your name, the time and the origin. You will not see the password.` : (body.error ?? 'Could not start the reset.'));
    } finally { setResetBusy(null); }
  }

  if (!info) return <Card title="Password &amp; security"><p className="text-sm text-gray-400">Loading…</p></Card>;
  if (!info.available) return <Card title="Password &amp; security"><p className="text-sm text-gray-400">Not available in this workspace yet.</p></Card>;

  return (
    <Card title="Password &amp; security">
      <div className="space-y-5 text-sm">
        <section>
          <h4 className="font-semibold text-gray-800">Change your password</h4>
          <p className="mt-0.5 text-xs text-gray-500">Your current password is required. Every other session on your account ends, and you get an email saying it happened — never the password itself.</p>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
          </div>
          {next && <PasswordRequirementsIndicator password={next} />}
          <div className="mt-2 flex items-center gap-2">
            <button disabled={busy || !current || !next || !confirm} onClick={changePassword}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{busy ? 'Changing…' : 'Change password'}</button>
            {msg && <span className="text-xs text-emerald-700">{msg}</span>}
            {err && <span className="text-xs text-[#B00000]">{err}</span>}
          </div>
        </section>

        {info.myRole === 'owner' && (
          <section className="border-t border-gray-100 pt-4">
            <h4 className="font-semibold text-gray-800">Let an admin start a password reset for me</h4>
            <p className="mt-0.5 text-xs text-gray-500">
              Off by default. When on, an admin of your company can trigger a reset: <b>you</b> receive a one-time link and choose the password yourself; the admin never sees it. The email tells you who started it, when and from where, with a button to end every session if it was not you.
            </p>
            <label className="mt-2 inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!info.allowAdminPasswordReset} disabled={toggleBusy} onChange={(e) => setToggle(e.target.checked)} />
              Allow an admin to start a reset of my password
            </label>
          </section>
        )}

        {info.myRole === 'admin' && (
          <section className="border-t border-gray-100 pt-4">
            <h4 className="font-semibold text-gray-800">Owner password reset</h4>
            {(info.resettableOwners ?? []).length === 0 ? (
              <p className="mt-0.5 text-xs text-gray-500">No owner has allowed admins to start a reset. An owner switches it on in their own App access settings.</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {info.resettableOwners!.map((o) => (
                  <li key={o.userId} className="flex flex-wrap items-center gap-2">
                    <span>{o.email}</span>
                    <button disabled={resetBusy === o.userId} onClick={() => startOwnerReset(o.userId, o.email)}
                      className="rounded-lg border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:border-[#0E7490] disabled:opacity-40">{resetBusy === o.userId ? 'Sending…' : 'Send reset link'}</button>
                  </li>
                ))}
              </ul>
            )}
            {resetMsg && <p className="mt-1.5 text-xs text-gray-600">{resetMsg}</p>}
          </section>
        )}

        {(info.events ?? []).length > 0 && (
          <section className="border-t border-gray-100 pt-4">
            <h4 className="font-semibold text-gray-800">Recent security events on your account</h4>
            <ul className="mt-1.5 space-y-1 text-xs text-gray-600">
              {info.events!.map((e) => (
                <li key={e.id}>{new Date(e.at).toLocaleString()} — {e.label}{e.ip ? ` · IP ${e.ip}` : ''}{e.byMe ? '' : ' · by someone else'}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Card>
  );
}
