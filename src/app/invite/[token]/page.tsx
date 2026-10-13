'use client';
// NEXT_STEPS Phase 3 — accept a team invitation. Handles both "brand new
// user" (sets a password inline) and "already have an account" (log in,
// land back here via ?next=, then just confirm) in one page.
//
// Prompt 911: a brand-new user confirms the email with a 6-digit code typed on this same page (EmailCodeConfirm, the 904
// mechanism), with the link in the email as the alternative; the right code signs the browser in and the invite is then
// accepted exactly as before. A reload comes back to the code box (without the password). AUTH_CODE_MODE=off falls back to
// the link-only flow this page had.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import { browserClient } from '@/lib/supabase';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { PasswordRequirementsIndicator } from '@/components/auth/PasswordRequirementsIndicator';
import { EmailCodeConfirm } from '@/components/auth/EmailCodeConfirm';
import { checkPassword } from '@/lib/password-policy';
import { registerWithCode, reportAuthEmailFailure } from '@/lib/auth-code/client';
import { clearPending, readPending, writePending } from '@/lib/auth-code/pending-storage';
import { authErrorText } from '@/lib/auth-errors';
import { AuthMessage } from '@/components/auth/AuthMessage';

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
  // Prompt 911 — the code step (and its resend clock after a reload).
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [sentAt, setSentAt] = useState(0);
  const [codeEmail, setCodeEmail] = useState('');

  useEffect(() => {
    const p = readPending('invite', token);
    if (p) { setCodeEmail(p.email); setSentAt(p.sentAt); setStep('code'); }
  }, [token]);

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
      const sent = await registerWithCode({ email: invite.email, password, redirectPath: `/invite/${token}` });
      if (sent.kind === 'sent') {
        const at = Date.now();
        writePending({ flow: 'invite', scope: token, email: invite.email, sentAt: at, fields: {} });
        setCodeEmail(invite.email); setSentAt(at); setStep('code');
        return;
      }
      if (sent.kind === 'error') { setMsg(sent.text); return; }
      // kind === 'off': AUTH_CODE_MODE=off — the link-only flow this page always had.
      const sb = browserClient();
      const { error } = await sb.auth.signUp({ email: invite.email, password, options: { emailRedirectTo: `${window.location.origin}/invite/${token}` } });
      if (error) { reportAuthEmailFailure({ email: invite.email, action: 'invite_signup', error }); setMsg(authErrorText(error)); return; }
      const res = await fetch(`/api/invite/${token}/accept`, { method: 'POST' });
      const body = await res.json();
      if (body.ok === false) { setMsg(body.error); return; }
      window.location.href = '/';
    } finally { setBusy(false); }
  }

  // The code was right: the browser is signed in as the new account — accept the invite, as the link flow did.
  async function acceptAfterCode(): Promise<string | void> {
    clearPending('invite');
    try {
      const res = await fetch(`/api/invite/${token}/accept`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (body?.ok === false) return typeof body.error === 'string' && body.error ? body.error : 'We could not add you to the team. Please try again.';
    } catch {
      return 'We could not reach the server. Check your connection and try again.';
    }
    window.location.href = '/';
  }

  if (step === 'code') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-7 shadow-sm" data-testid="invite-code-step">
          <div className="mb-4 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>{BRAND_NAME}</div>
          <EmailCodeConfirm
            email={codeEmail} password={password} sentAt={sentAt} redirectPath={`/invite/${token}`}
            onVerified={() => acceptAfterCode()}
            onResent={(at) => { setSentAt(at); writePending({ flow: 'invite', scope: token, email: codeEmail, sentAt: at, fields: {} }); }}
            onChangeEmail={() => { clearPending('invite'); setStep('form'); setMsg(''); }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-7 shadow-sm">
        <div className="mb-4 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          {BRAND_NAME}
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
                You&apos;re signed in as {me.user.email}, but this invite is for {invite.email}. Log out and try again with that account.
              </p>
            )
          ) : (
            <>
              <p className="mb-4 text-sm text-gray-600">
                You&apos;ve been invited to join <span className="font-semibold">{invite.org_name}</span> as{' '}
                <span className="font-medium">{invite.role}</span>. Set a password to finish.
              </p>
              <input value={invite.email} disabled className="mb-3 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500" />
              <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Choose a password"
                wrapperClassName="mb-2" className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              <div className="mb-3"><PasswordRequirementsIndicator password={password} /></div>
              <button disabled={busy || !checkPassword(password).valid} onClick={createAccountAndAccept}
                className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
                {busy ? 'Joining…' : 'Create account & join'}
              </button>
              <div className="mt-4 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
                Already have a {BRAND_NAME} account?{' '}
                <Link href={`/login?next=/invite/${token}`} className="font-medium text-[#0E7490] hover:underline">Log in</Link>
              </div>
            </>
          )
        )}

        {msg && <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700"><AuthMessage text={msg} /></div>}
      </div>
    </div>
  );
}
