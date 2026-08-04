'use client';
// connectB sign-in — founders & developers use email+password; investors use
// a magic link. Which form renders is decided by ?as=investor on the URL
// (set by the Startup/Investor toggle on the landing page), not by an
// in-page switch — each audience only ever sees its own flow.
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { browserClient, authEnabled } from '@/lib/supabase';
import { LogoLockup } from '@/components/Logo';
import { AuthShell } from '@/components/auth/AuthShell';
import { getMagicLinkSent, setMagicLinkSent, clearMagicLinkSent } from '@/lib/magic-link-storage';

function LoginInner() {
  const sp = useSearchParams();
  const investorMode = sp.get('as') === 'investor';
  const next = sp.get('next') ?? (investorMode ? '/portal' : '/pipeline');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // Prompt 44 — same fix as /portal, see src/lib/magic-link-storage.ts for
  // why: only relevant to the investor magic-link path, not the
  // founder/developer password form below.
  const [linkSent, setLinkSent] = useState(false);
  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [code, setCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeErr, setCodeErr] = useState('');
  // Prompt 126 B / 119 §4.1-D1 — investors keep the magic link as the
  // default (it never goes away), but can switch to password sign-in once
  // they've set one via /set-password. Founders/developers are unaffected —
  // this toggle only renders inside the investorMode branch below.
  const [investorPasswordMode, setInvestorPasswordMode] = useState(false);

  useEffect(() => {
    if (!investorMode) return;
    const stored = getMagicLinkSent();
    // Prompt 50 — see the matching comment in /portal/page.tsx: a failed
    // code exchange must land on the code field, pre-filled if possible,
    // never a blank "type your email again" form.
    if (sp.get('linkFailed') === '1') {
      if (stored) setEmail(stored.email);
      setShowCodeEntry(true);
      setMsg('That sign-in link didn’t complete — enter the code from the same email instead.');
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete('linkFailed');
      const qs = cleanParams.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
      return;
    }
    if (stored) { setEmail(stored.email); setLinkSent(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investorMode]);

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
          // Explicit, not the implicit default — same reasoning as
          // portal/page.tsx: harmless to self-create here since RLS blocks
          // org data for non-members and /api/portal/access is now
          // session-scoped, and blocking it would break first-time login
          // for a legitimately granted investor.
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
      // Prompt 126 B / 119 §4.3 D2 — same first-time-password offer as the
      // link-click path in auth/callback/route.ts, for the manual-code path.
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
    <AuthShell>
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-7 shadow-2xl">
        <div className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          <LogoLockup size={28} accentClassName="text-[#2a7f8e]" />
        </div>
        <p className="mb-5 text-sm text-gray-500">
          {investorMode ? 'Sign in to your investor data room.' : 'Sign in to your investor relations workspace.'}
        </p>

        {!authEnabled && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Demo mode — authentication is not configured. <Link href="/pipeline" className="underline">Enter the app</Link>.
          </div>
        )}

        <label className="mb-1 block text-xs font-medium text-gray-500">Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com"
          className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />

        {investorMode ? (
          investorPasswordMode ? (
            <>
              <label className="mb-1 block text-xs font-medium text-gray-500">Password</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••"
                onKeyDown={(e) => e.key === 'Enter' && passwordLogin()}
                className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              <button disabled={busy || !email || !password} onClick={passwordLogin}
                className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <button onClick={() => { setInvestorPasswordMode(false); setMsg(''); }} className="mt-2 block w-full text-center text-xs text-gray-400 hover:underline">
                Use a sign-in link instead
              </button>
            </>
          ) : (
          <>
            {linkSent ? (
              <div className="mb-3 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">
                <p>We sent one sign-in email to {email} with a link and a 6-digit code.</p>
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
                <label className="mb-1 block text-xs font-medium text-gray-500">6-digit code from the email</label>
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric"
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
            <button onClick={() => { setInvestorPasswordMode(true); setMsg(''); }} className="mt-2 block w-full text-center text-xs text-gray-400 hover:underline">
              Sign in with a password instead
            </button>
          </>
          )
        ) : (
          <>
            <label className="mb-1 block text-xs font-medium text-gray-500">Password</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••"
              onKeyDown={(e) => e.key === 'Enter' && passwordLogin()}
              className="mb-4 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            <button disabled={busy || !email || !password} onClick={passwordLogin}
              className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </>
        )}

        <Link href="/forgot-password" className="mt-3 block w-full text-center text-xs text-gray-400 hover:underline">
          Forgot your password?
        </Link>

        {msg && <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">{msg}</div>}

        <div className="mt-5 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
          {investorMode ? (
            <>New investor on Sherlock Deal? <Link href="/signup?as=investor" className="font-medium text-[#0E7490] hover:underline">Create an account</Link>.</>
          ) : (
            <>New founder? <Link href="/signup" className="font-medium text-[#0E7490] hover:underline">Create an account for free!</Link></>
          )}
        </div>
      </div>
    </AuthShell>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginInner /></Suspense>;
}
