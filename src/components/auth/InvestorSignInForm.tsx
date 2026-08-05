'use client';
// Bug fix (2026-08-05) — password sign-in for investors existed ONLY on
// /login?as=investor (Prompt 126 B / 119). /portal has its own, entirely
// separate pre-auth sign-in card that was never touched by that work, and
// every real path (the magic-link redirect, /login's own default `next`)
// lands the investor on /portal — so in practice every investor bookmarks
// /portal, never sees /login again, and never sees password sign-in at all,
// no matter how many times they set one. This is the root cause, not
// something wrong with the password feature itself.
//
// Extracted so there is exactly ONE investor sign-in form, consumed by both
// /login?as=investor and /portal — the whole bug was two copies of this
// logic drifting apart. Do not add a third copy; import this instead.
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase';
import { getMagicLinkSent, setMagicLinkSent, clearMagicLinkSent } from '@/lib/magic-link-storage';

export function InvestorSignInForm({ next, linkFailed }: { next: string; linkFailed: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [code, setCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeErr, setCodeErr] = useState('');
  // D1 (Prompt 119 §4.1) — magic link is always the default and never
  // disappears; this only switches which form is showing, never removes
  // the other option.
  const [passwordMode, setPasswordMode] = useState(false);

  useEffect(() => {
    const stored = getMagicLinkSent();
    if (linkFailed) {
      if (stored) setEmail(stored.email);
      setShowCodeEntry(true);
      setMsg('That sign-in link didn’t complete — enter the code from the same email instead.');
      return;
    }
    if (stored) { setEmail(stored.email); setLinkSent(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkFailed]);

  async function passwordLogin() {
    setBusy(true); setMsg('');
    try {
      const sb = browserClient();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { setMsg(error.message); return; }
      window.location.href = next;
    } finally { setBusy(false); }
  }

  async function magicLink() {
    setBusy(true); setMsg('');
    try {
      const sb = browserClient();
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          // Explicit, not the implicit default: a self-created account here
          // is harmless — RLS blocks every org-scoped table for anyone who
          // isn't an org_member (confirmed live: entities/people/orgs/
          // interactions/documents all return 0 rows), and
          // /api/portal/access only ever looks up grants for the session's
          // OWN email. Blocking account creation would instead break the
          // common case: a founder grants an email access before that
          // person has ever signed up here. Deliberate — do not "harden"
          // this without re-reading the reasoning above.
          shouldCreateUser: true,
        },
      });
      if (error) { setMsg(error.message); return; }
      setMagicLinkSent(email);
      setLinkSent(true);
    } finally { setBusy(false); }
  }

  async function verifyCode() {
    setCodeErr(''); setCodeBusy(true);
    try {
      const sb = browserClient();
      const { data, error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) { setCodeErr(error.message); return; }
      clearMagicLinkSent();
      // D2 — same first-time-password offer for the manual-code path as the
      // link-click path (auth/callback/route.ts). This is the fix for item
      // B: /portal's own verifyCode used to discard `data` and just reload,
      // so this offer never reached anyone who signed in this way.
      if (!data.user?.user_metadata?.password_set) {
        window.location.href = `/set-password?next=${encodeURIComponent(next)}`;
        return;
      }
      window.location.href = next;
    } finally { setCodeBusy(false); }
  }

  function startOver() {
    clearMagicLinkSent();
    setLinkSent(false); setEmail(''); setMsg(''); setCode(''); setCodeErr(''); setShowCodeEntry(false);
  }

  return (
    <>
      <label className="mb-1 block text-xs font-medium text-gray-500">Email</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com"
        className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />

      {passwordMode ? (
        <>
          <label className="mb-1 block text-xs font-medium text-gray-500">Password</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••"
            onKeyDown={(e) => e.key === 'Enter' && passwordLogin()}
            className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          <button disabled={busy || !email || !password} onClick={passwordLogin}
            className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button onClick={() => { setPasswordMode(false); setMsg(''); }} className="mt-2 block w-full text-center text-xs text-gray-400 hover:underline">
            Use a sign-in link instead
          </button>
        </>
      ) : (
        <>
          {linkSent ? (
            <div className="mb-3 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">
              <p>We sent one sign-in email to {email} with a link and a sign-in code.</p>
              <p className="mt-1 text-gray-500">
                <strong>Use only one of the two.</strong> The link and the code are the same one-time pass — some email apps
                &quot;preview&quot; links automatically, which can silently use up the link before you click it. If that
                happens, the code below will say it expired even though you never used it. If it does, just send yourself
                a new one.
              </p>
              <p className="mt-1 text-gray-500">On this device: click the link. Checking email on your phone: type the code below.</p>
              <button onClick={startOver} className="mt-1 text-gray-400 hover:underline">Not you? Start over</button>
            </div>
          ) : (
            <button disabled={busy || !email} onClick={magicLink}
              className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          )}
          {showCodeEntry ? (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <label className="mb-1 block text-xs font-medium text-gray-500">Code from the email</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code from the email" inputMode="numeric"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              <button onClick={verifyCode} disabled={!email || !code || codeBusy}
                className="mt-2 w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                {codeBusy ? 'Checking…' : 'Use code'}
              </button>
              {codeErr && (
                <div className="mt-2 rounded-lg bg-red-50 border border-red-100 px-2.5 py-2">
                  <p className="text-xs text-[#B00000]">{codeErr}</p>
                  <button onClick={() => { setCode(''); setCodeErr(''); magicLink(); }} disabled={busy}
                    className="mt-1.5 text-xs font-medium text-[#0E7490] hover:underline disabled:opacity-40">
                    {busy ? 'Sending…' : 'Send me a new code'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button onClick={() => setShowCodeEntry(true)} className="mt-2 block w-full text-center text-xs text-gray-400 hover:underline">
              Have a sign-in code instead?
            </button>
          )}
          {/* Item D — used to be a third indistinguishable 12px gray link
              stacked under the main button; now reads as a real secondary
              path (teal, bordered), not one more afterthought link. */}
          <button onClick={() => { setPasswordMode(true); setMsg(''); }}
            className="mt-2.5 block w-full rounded-lg border border-gray-200 py-1.5 text-center text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8]">
            Sign in with a password instead
          </button>
        </>
      )}

      {msg && <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">{msg}</div>}
    </>
  );
}
