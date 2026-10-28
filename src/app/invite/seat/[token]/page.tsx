'use client';
// Prompt 923 (B) — the page a SEAT INVITATION opens. An investor registration tied to the invitation, never the founder registration (28/10/2026: the invitation of +aval1 to "ablute_ — Internal QA" opened "create a
// startup"): the invited email, filled in and locked, a 6-digit code to confirm it, your name and your role at the firm — nothing else. No startup, no "Claim this profile". When it is done the person is a member of the
// firm and lands in the firm's workspace (/go?as=investor). Somebody who already has an account gets the same page: the code signs them in, and if they cannot join (an account that already belongs elsewhere, a firm
// with no free seat…) the page says why and what to do, and the invitation stays open and unspent.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { browserClient } from '@/lib/supabase';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthMessage } from '@/components/auth/AuthMessage';
import { useCountdown } from '@/components/auth/useCountdown';
import { LogoLockup } from '@/components/Logo';
import { describeAuthError, newReference, NEW_CODE_NOTE, rateLimitedText } from '@/lib/auth-errors';
import { sanitizeCodeInput, CODE_LENGTH, RESEND_MIN_INTERVAL_SECONDS } from '@/lib/auth-code/policy';
import { lastAreaCookie } from '@/lib/areas';
import { maskEmail } from '@/lib/seat-invite-accept';

type Step = 'loading' | 'invalid' | 'closed' | 'intro' | 'code' | 'mismatch' | 'profile' | 'joining' | 'done' | 'refused';
interface Invite { firmName: string; email: string; status: 'open' | 'accepted' | 'cancelled' }

const INPUT = 'block w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm disabled:bg-gray-50 disabled:text-gray-500';
const PRIMARY = 'min-h-[44px] w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40';

export default function SeatInvitePage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [step, setStep] = useState<Step>('loading');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [rateLimited, setRateLimited] = useState(false);
  const wait = useCountdown();

  const accept = useCallback(async (profile?: { name: string; role: string }) => {
    setStep('joining'); setMsg('');
    const res = await fetch(`/api/invite/seat/${token}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile ?? {}) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) as { ok?: boolean; error?: string; code?: string; next?: string } : null;
    if (!body) { setMsg('We could not reach the server. Check your connection and try again.'); setStep('refused'); return; }
    if (res?.ok && body.ok) {
      try { document.cookie = lastAreaCookie('investor'); } catch { /* the sign-in simply falls back to the first area */ }
      setStep('done');
      setTimeout(() => { window.location.href = body.next ?? '/go?as=investor'; }, 1400);
      return;
    }
    if (body.code === 'profile_required') { setStep('profile'); setMsg(body.error ?? ''); return; }
    setMsg(body.error ?? 'Something went wrong. Try again in a minute.');
    setStep(body.code === 'wrong_account' ? 'mismatch' : 'refused');
  }, [token]);

  // After a session exists (the code worked, or the person was already signed in): ask the server what is left to do.
  const afterSession = useCallback(async () => {
    const res = await fetch(`/api/invite/seat/${token}/accept`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) as { ok?: boolean; matches?: boolean; needsProfile?: boolean; signedInAs?: string | null } : null;
    if (!body?.ok) { setMsg('We could not check your account just now. Try again in a minute.'); setStep('intro'); return; }
    setSignedInAs(body.signedInAs ?? null);
    if (!body.matches) { setStep('mismatch'); return; }
    if (body.needsProfile) { setStep('profile'); return; }
    await accept();
  }, [token, accept]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/invite/seat/${token}`).catch(() => null);
      if (!alive) return;
      if (!res || res.status === 404) { setStep('invalid'); return; }
      const body = await res.json().catch(() => ({})) as { ok?: boolean; firmName?: string; email?: string; status?: Invite['status'] };
      if (!body.ok || !body.email) { setStep('invalid'); return; }
      const inv = { firmName: body.firmName ?? 'the firm', email: body.email, status: body.status ?? 'open' } as Invite;
      setInvite(inv);
      if (inv.status !== 'open') { setStep('closed'); return; }
      const { data } = await browserClient().auth.getUser();
      if (!alive) return;
      if (data.user) { await afterSession(); return; }
      setStep('intro');
    })();
    return () => { alive = false; };
  }, [token, afterSession]);

  async function sendCode() {
    setBusy(true); setMsg(''); setRateLimited(false);
    try {
      const res = await fetch(`/api/invite/seat/${token}/code`, { method: 'POST' }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) as { ok?: boolean; error?: string; code?: string; retryAfterSeconds?: number | null } : null;
      if (!body) { setMsg('We could not reach the server. Check your connection and try again.'); return; }
      if (res?.ok && body.ok) { setStep('code'); setCode(''); wait.start(RESEND_MIN_INTERVAL_SECONDS); return; }
      if (res?.status === 429 && body.retryAfterSeconds) { wait.start(body.retryAfterSeconds); setRateLimited(true); }
      if (res?.status === 404 || res?.status === 410) { setMsg(body.error ?? ''); setStep(res.status === 404 ? 'invalid' : 'closed'); return; }
      setMsg(body.error ?? 'Something went wrong. Try again in a minute.');
    } finally { setBusy(false); }
  }

  async function verify() {
    if (!invite) return;
    setBusy(true); setMsg('');
    try {
      const sb = browserClient();
      const digits = sanitizeCodeInput(code);
      let { error } = await sb.auth.verifyOtp({ email: invite.email, token: digits, type: 'email' });
      // A person with no account yet is created by the provider with a SIGN-UP code, which some configurations only accept as type "signup": try it before saying the code is wrong. The first answer is the one shown.
      if (error) { const again = await sb.auth.verifyOtp({ email: invite.email, token: digits, type: 'signup' }); if (!again.error) error = null; }
      if (error) { setMsg(describeAuthError(error, { ref: newReference() }).text); return; }
      await afterSession();
    } finally { setBusy(false); }
  }

  async function signOut() { await browserClient().auth.signOut(); window.location.reload(); }

  const message = rateLimited && wait.left > 0 ? rateLimitedText(wait.left) : msg;
  const firm = invite?.firmName ?? 'the firm';

  return (
    <AuthShell>
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-7 shadow-2xl" data-testid="seat-invite-page">
        <div className="mb-3 flex items-center gap-2 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'var(--font-comfortaa), var(--font-inter), sans-serif' }}>
          <LogoLockup size={28} accentClassName="text-[#2a7f8e]" />
        </div>

        {step === 'loading' && <p className="text-sm text-gray-500" data-testid="seat-invite-loading">Opening your invitation…</p>}

        {step === 'invalid' && (
          <div data-testid="seat-invite-invalid">
            <h1 className="text-lg font-semibold text-gray-900">This invitation is not valid</h1>
            <p className="mt-1 text-sm text-gray-600">The link may be incomplete, or the invitation was cancelled. Ask the person who invited you to send it again.</p>
            <Link href="/" className="mt-4 block text-center text-xs text-[#0E7490] hover:underline">Go to Sherlock Deal</Link>
          </div>
        )}

        {step === 'closed' && (
          <div data-testid="seat-invite-closed">
            <h1 className="text-lg font-semibold text-gray-900">{invite?.status === 'accepted' ? 'This invitation was already used' : 'This invitation was cancelled'}</h1>
            <p className="mt-1 text-sm text-gray-600">{invite?.status === 'accepted' ? 'If it was you, sign in to go to your firm’s workspace.' : `Ask ${firm} to send you a new one.`}</p>
            {invite?.status === 'accepted' && <Link href="/login?as=investor" className={`${PRIMARY} mt-4 flex items-center justify-center`}>Sign in</Link>}
          </div>
        )}

        {(step === 'intro' || step === 'code') && invite && (
          <div>
            <h1 className="text-lg font-semibold text-gray-900" data-testid="seat-invite-title">Join {firm}</h1>
            <p className="mt-1 text-sm text-gray-600">{firm} invited you to its investor workspace on Sherlock Deal. Confirm your email with a code and tell us who you are: that is all.</p>
            <label className="mb-1 mt-4 block text-xs font-medium text-gray-500" htmlFor="seat-email">Your email (from the invitation)</label>
            <input id="seat-email" value={invite.email} readOnly aria-readonly="true" className={INPUT} data-testid="seat-invite-email" />
            {step === 'intro' ? (
              <button type="button" className={`${PRIMARY} mt-3`} disabled={busy || wait.left > 0} onClick={() => void sendCode()} data-testid="seat-invite-send">
                {busy ? 'Sending…' : wait.left > 0 ? `Wait ${wait.left}s` : 'Send me a code'}
              </button>
            ) : (
              <>
                <label className="mb-1 mt-3 block text-xs font-medium text-gray-500" htmlFor="seat-code">6-digit code</label>
                <input id="seat-code" value={code} onChange={(e) => setCode(sanitizeCodeInput(e.target.value))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
                  className={`${INPUT} tracking-widest`} data-testid="seat-invite-code" onKeyDown={(e) => { if (e.key === 'Enter' && code.length === CODE_LENGTH) void verify(); }} />
                <button type="button" className={`${PRIMARY} mt-2`} disabled={busy || code.length !== CODE_LENGTH} onClick={() => void verify()} data-testid="seat-invite-verify">{busy ? 'Checking…' : 'Continue'}</button>
                <p className="mt-2 text-[11px] text-gray-500" data-testid="seat-invite-new-code-note">{NEW_CODE_NOTE}</p>
                <button type="button" className="mt-1 text-xs font-medium text-[#0E7490] hover:underline disabled:opacity-40" disabled={busy || wait.left > 0} onClick={() => void sendCode()} data-testid="seat-invite-resend">
                  {wait.left > 0 ? `Send me a new code (wait ${wait.left}s)` : 'Send me a new code'}
                </button>
              </>
            )}
          </div>
        )}

        {step === 'profile' && invite && (
          <form onSubmit={(e) => { e.preventDefault(); void accept({ name, role }); }} data-testid="seat-invite-profile">
            <h1 className="text-lg font-semibold text-gray-900">One last thing</h1>
            <p className="mt-1 text-sm text-gray-600">Tell {firm} who you are.</p>
            <label className="mb-1 mt-3 block text-xs font-medium text-gray-500" htmlFor="seat-name">Your name</label>
            <input id="seat-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} className={INPUT} data-testid="seat-invite-name" />
            <label className="mb-1 mt-3 block text-xs font-medium text-gray-500" htmlFor="seat-role">Your role at {firm}</label>
            <input id="seat-role" value={role} onChange={(e) => setRole(e.target.value)} autoComplete="organization-title" maxLength={120} placeholder="e.g. Analyst" className={INPUT} data-testid="seat-invite-role" />
            <button type="submit" className={`${PRIMARY} mt-4`} disabled={!name.trim() || !role.trim()} data-testid="seat-invite-join">Join {firm}</button>
          </form>
        )}

        {step === 'joining' && <p className="text-sm text-gray-500" data-testid="seat-invite-joining">Adding you to {firm}…</p>}

        {step === 'done' && (
          <div role="status" data-testid="seat-invite-done">
            <h1 className="text-lg font-semibold text-emerald-800">You are now part of {firm}</h1>
            <p className="mt-1 text-sm text-gray-600">Taking you to your investor workspace…</p>
          </div>
        )}

        {step === 'mismatch' && invite && (
          <div data-testid="seat-invite-mismatch">
            <h1 className="text-lg font-semibold text-gray-900">This invitation is for another address</h1>
            <p className="mt-1 text-sm text-gray-600">{signedInAs ? `You are signed in as ${signedInAs}. ` : ''}This invitation is for {maskEmail(invite.email)}. Sign out and open the link again with that address.</p>
            <button type="button" className={`${PRIMARY} mt-4`} onClick={() => void signOut()} data-testid="seat-invite-signout">Sign out</button>
          </div>
        )}

        {step === 'refused' && invite && (
          <div data-testid="seat-invite-refused">
            <h1 className="text-lg font-semibold text-gray-900">We could not add you to {firm}</h1>
            <p className="mt-1 text-sm text-gray-700" role="alert" data-testid="seat-invite-refusal">{msg}</p>
            <p className="mt-2 text-xs text-gray-500">The invitation is still open: nothing was used up.</p>
            <Link href="/go?as=investor" className="mt-4 block text-center text-xs text-[#0E7490] hover:underline">Go to my account</Link>
          </div>
        )}

        {message && (step === 'intro' || step === 'code' || step === 'profile') && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700" role="alert" data-testid="seat-invite-message"><AuthMessage text={message} /></div>
        )}
      </div>
    </AuthShell>
  );
}
