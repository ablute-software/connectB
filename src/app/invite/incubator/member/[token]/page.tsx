'use client';
// Prompt I-01 §C.1 — accept an invitation to an ecosystem organisation's TEAM.
// There is no founder signup here: a team member is never an org_members row.
//
// I-01c §A (Nuno's production test, 30/09): the account created here used to
// get no redirect back from the confirmation e-mail, came in through the
// normal sign-in, was shown "finish your startup account" and became a
// founder. Now:
//  - the preview carries the invited address MASKED only; the person types the
//    address, and the server confirms it (check-email) BEFORE the account is
//    created;
//  - signUp records signup_intent = 'incubator_member' and sends the
//    confirmation link back to /invite/incubator/member/pending — a fixed path,
//    never the token — which accepts every pending team invite for the
//    confirmed address (incubator_accept_pending_member_invites);
//  - "I already have an account" signs in with next = that same pending page.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { browserClient, authEnabled } from '@/lib/supabase';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { incubatorErrorText, inviteEmailMismatchText } from '@/lib/incubators';
import { PENDING_MEMBER_INVITE_PATH } from '@/lib/landing-redirect';

interface Preview { ok: boolean; demo?: boolean; error?: string; status?: string; invitedEmailMasked?: string | null; role?: string; incubator?: { name: string; logoUrl: string | null } }

export default function IncubatorMemberInvitePage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  const [p, setP] = useState<Preview | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch(`/api/invite/incubator/member/${encodeURIComponent(token)}`).then((r) => r.json()).then(setP).catch(() => setP({ ok: false }));
    if (authEnabled) browserClient().auth.getUser().then(({ data }) => setSessionEmail(data.user?.email ?? null));
    else setSessionEmail(null);
  }, [token]);

  const orgName = p?.incubator?.name ?? 'the organisation';

  async function accept() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`/api/invite/incubator/member/${encodeURIComponent(token)}/accept`, { method: 'POST' }).then((x) => x.json());
      if (!r.ok) {
        setMsg(r.error === 'email_mismatch' ? inviteEmailMismatchText(p?.invitedEmailMasked ?? null, orgName) : (r.message ?? incubatorErrorText(r.error)));
        return;
      }
      window.location.href = '/ecosystem';
    } finally { setBusy(false); }
  }

  async function createAndAccept() {
    setBusy(true); setMsg('');
    try {
      const check = await fetch(`/api/invite/incubator/member/${encodeURIComponent(token)}/check-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      }).then((x) => x.json()).catch(() => null);
      if (!check?.ok) { setMsg(check?.error === 'rate_limited' ? 'Too many attempts — wait a minute and try again.' : 'We could not check the invite right now. Try again.'); return; }
      if (!check.matches) { setMsg(inviteEmailMismatchText(check.invitedEmailMasked ?? p?.invitedEmailMasked ?? null, orgName)); return; }

      const sb = browserClient();
      const { data, error } = await sb.auth.signUp({
        email: email.trim(), password,
        options: {
          data: { password_set: true, signup_intent: 'incubator_member' },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(PENDING_MEMBER_INVITE_PATH)}`,
        },
      });
      if (error) { setMsg(error.message); return; }
      if (!data.session) {
        setMsg('Account created. Confirm your email — the link brings you straight into the Ecosystem workspace.');
        return;
      }
      await accept();
    } finally { setBusy(false); }
  }

  async function signOut() {
    await browserClient().auth.signOut().catch(() => {});
    window.location.reload();
  }

  const box = (c: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-xl" data-testid="member-invite">{c}</div>
    </div>
  );
  if (!p || sessionEmail === undefined) return box(<p className="text-sm text-gray-400">Loading…</p>);
  if (p.demo) return box(<p className="text-sm text-amber-800">Demo mode — team invites need a connected database.</p>);
  if (!p.ok || !p.incubator) return box(<p className="text-sm text-gray-700">{incubatorErrorText(p.error ?? 'invite_not_found')}</p>);
  if (p.status !== 'invited') return box(<p className="text-sm text-gray-700">{incubatorErrorText(p.status === 'closed' ? 'incubator_closed' : `invite_${p.status}`)}</p>);

  return box(
    <div>
      <h1 className="text-lg font-bold text-gray-900">Join {orgName}&apos;s team</h1>
      <p className="mt-2 text-sm text-gray-600">
        Invite for {p.invitedEmailMasked ?? 'your address'}, as {p.role === 'owner' ? 'an owner' : 'a programme manager'} of the Ecosystem workspace.
      </p>
      {sessionEmail ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-gray-500">Signed in as {sessionEmail}.</p>
          <div className="flex gap-2">
            <button className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={accept}>Accept</button>
            <button className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700" onClick={signOut}>Sign out</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <Link href={`/login?next=${encodeURIComponent(PENDING_MEMBER_INVITE_PATH)}`} className="text-sm text-[#0E7490] hover:underline">
            I already have an account with this email — sign in
          </Link>
          <div className="space-y-2 border-t border-gray-100 pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Create an account</div>
            <input type="email" className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" placeholder="Your email *"
              value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <p className="text-[11px] text-gray-500">Use the address the invite was sent to{p.invitedEmailMasked ? ` (${p.invitedEmailMasked})` : ''}.</p>
            <PasswordInput className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" placeholder="Password (8+ characters) *"
              value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <button className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              disabled={busy || !email.trim() || password.length < 8} onClick={createAndAccept}>Create and accept</button>
          </div>
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}
    </div>,
  );
}
