'use client';
// NEXT_STEPS Phase 3 — accept a team invitation. Handles both "brand new
// user" (sets a password inline) and "already have an account" (log in,
// land back here via ?next=, then just confirm) in one page.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { browserClient } from '@/lib/supabase';

type Invite = { org_name: string; role: string; email: string; status: string };
type Me = { user: { id: string; email?: string } | null };

export default function InvitePage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [invite, setInvite] = useState<Invite | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    Promise.all([
      fetch(`/api/invite/${token}`).then((r) => r.json()),
      fetch('/api/me').then((r) => r.json()),
    ]).then(([inv, meRes]) => {
      if (inv.ok === false) setLoadErr(inv.error ?? 'Invitation not found.');
      else setInvite(inv);
      setMe(meRes);
    }).catch(() => setLoadErr('Could not load this invitation.'));
  }, [token]);

  async function acceptExisting() {
    setBusy(true); setMsg('');
    try {
      const res = await fetch(`/api/invite/${token}/accept`, { method: 'POST' });
      const body = await res.json();
      if (body.ok === false) { setMsg(body.error); return; }
      window.location.href = '/';
    } finally { setBusy(false); }
  }

  async function createAccountAndAccept() {
    if (!invite) return;
    setBusy(true); setMsg('');
    try {
      const sb = browserClient();
      const { error } = await sb.auth.signUp({ email: invite.email, password });
      if (error) { setMsg(error.message); return; }
      const res = await fetch(`/api/invite/${token}/accept`, { method: 'POST' });
      const body = await res.json();
      if (body.ok === false) { setMsg(body.error); return; }
      window.location.href = '/';
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-7 shadow-sm">
        <div className="mb-4 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          connect<span className="text-[#22D3EE]">B</span>
        </div>

        {loadErr && <p className="text-sm text-[#B00000]">{loadErr}</p>}

        {invite && invite.status !== 'pending' && (
          <p className="text-sm text-gray-600">
            This invitation is {invite.status}. {invite.status === 'expired' && 'Ask your team to send a new one.'}
          </p>
        )}

        {invite && invite.status === 'pending' && me && (
          me.user ? (
            me.user.email?.trim().toLowerCase() === invite.email.trim().toLowerCase() ? (
              <>
                <p className="mb-4 text-sm text-gray-600">
                  Join <span className="font-semibold">{invite.org_name}</span> as <span className="font-medium">{invite.role}</span>?
                </p>
                <button disabled={busy} onClick={acceptExisting}
                  className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
                  {busy ? 'Joining…' : 'Accept & join'}
                </button>
              </>
            ) : (
              <p className="text-sm text-gray-600">
                You're signed in as {me.user.email}, but this invite is for {invite.email}. Log out and try again with that account.
              </p>
            )
          ) : (
            <>
              <p className="mb-4 text-sm text-gray-600">
                You've been invited to join <span className="font-semibold">{invite.org_name}</span> as{' '}
                <span className="font-medium">{invite.role}</span>. Set a password to finish.
              </p>
              <input value={invite.email} disabled className="mb-3 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500" />
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Choose a password (min 8 chars)"
                className="mb-4 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              <button disabled={busy || password.length < 8} onClick={createAccountAndAccept}
                className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
                {busy ? 'Joining…' : 'Create account & join'}
              </button>
              <div className="mt-4 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
                Already have a connectB account?{' '}
                <Link href={`/login?next=/invite/${token}`} className="font-medium text-[#0E7490] hover:underline">Log in</Link>
              </div>
            </>
          )
        )}

        {msg && <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">{msg}</div>}
      </div>
    </div>
  );
}
