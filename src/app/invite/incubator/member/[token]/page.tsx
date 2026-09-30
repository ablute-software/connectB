'use client';
// Prompt I-01 §C.1 — accept an invitation to an incubator's TEAM. The person
// signs in (or creates an account) with the invited address; there is no
// founder signup here — a manager is never an org_members row.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { browserClient, authEnabled } from '@/lib/supabase';
import { INCUBATOR_MEMBER_INVITE_STORAGE_KEY, incubatorErrorText } from '@/lib/incubators';

interface Preview { ok: boolean; demo?: boolean; error?: string; status?: string; invitedEmail?: string; role?: string; incubator?: { name: string; logoUrl: string | null } }

export default function IncubatorMemberInvitePage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  const [p, setP] = useState<Preview | null>(null);
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch(`/api/invite/incubator/member/${encodeURIComponent(token)}`).then((r) => r.json()).then(setP).catch(() => setP({ ok: false }));
    if (authEnabled) browserClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    else setEmail(null);
  }, [token]);

  async function accept() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`/api/invite/incubator/member/${encodeURIComponent(token)}/accept`, { method: 'POST' }).then((x) => x.json());
      if (!r.ok) { setMsg(r.message ?? incubatorErrorText(r.error)); return; }
      try { window.localStorage.removeItem(INCUBATOR_MEMBER_INVITE_STORAGE_KEY); } catch { /* ignore */ }
      window.location.href = '/incubator';
    } finally { setBusy(false); }
  }

  async function createAndAccept() {
    if (!p?.invitedEmail) return;
    setBusy(true); setMsg('');
    try {
      const sb = browserClient();
      const { data, error } = await sb.auth.signUp({ email: p.invitedEmail, password, options: { data: { password_set: true } } });
      if (error) { setMsg(error.message); return; }
      if (!data.session) {
        try { window.localStorage.setItem(INCUBATOR_MEMBER_INVITE_STORAGE_KEY, token); } catch { /* ignore */ }
        setMsg('Account created. Confirm your email, sign in, and you will be brought back to this invite.');
        return;
      }
      await accept();
    } finally { setBusy(false); }
  }

  const box = (c: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-xl">{c}</div>
    </div>
  );
  if (!p || email === undefined) return box(<p className="text-sm text-gray-400">Loading…</p>);
  if (p.demo) return box(<p className="text-sm text-amber-800">Demo mode — team invites need a connected database.</p>);
  if (!p.ok || !p.incubator) return box(<p className="text-sm text-gray-700">{incubatorErrorText(p.error ?? 'invite_not_found')}</p>);
  if (p.status !== 'invited') return box(<p className="text-sm text-gray-700">{incubatorErrorText(p.status === 'closed' ? 'incubator_closed' : `invite_${p.status}`)}</p>);

  const matches = !!email && email.toLowerCase() === p.invitedEmail?.toLowerCase();
  return box(
    <div>
      <h1 className="text-lg font-bold text-gray-900">{p.incubator.name} team</h1>
      <p className="mt-2 text-sm text-gray-600">Invite for {p.invitedEmail}, as {p.role === 'owner' ? 'an owner' : 'a programme manager'} of the incubator workspace.</p>
      {email && matches ? (
        <button className="mt-4 rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={accept}>Accept</button>
      ) : email ? (
        <p className="mt-4 text-sm text-amber-800">You are signed in as {email}. Sign out and sign in with {p.invitedEmail} to accept.</p>
      ) : (
        <div className="mt-4 space-y-2">
          <Link href={`/login?next=${encodeURIComponent('/incubator')}`} className="text-sm text-[#0E7490] hover:underline"
            onClick={() => { try { window.localStorage.setItem(INCUBATOR_MEMBER_INVITE_STORAGE_KEY, token); } catch { /* ignore */ } }}>
            I already have an account with this email — sign in
          </Link>
          <div className="flex items-end gap-2 pt-2">
            <label className="flex-1 text-xs text-gray-600">Create an account — password
              <input type="password" className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
            <button className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || password.length < 8} onClick={createAndAccept}>Create and accept</button>
          </div>
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}
    </div>,
  );
}
