'use client';
// connectB sign-in — founders & developers use email+password; investors use
// a magic link. Which form renders is decided by ?as=investor on the URL
// (set by the Startup/Investor toggle on the landing page), not by an
// in-page switch — each audience only ever sees its own flow.
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authEnabled, browserClient } from '@/lib/supabase';
import { LogoLockup } from '@/components/Logo';
import { AuthShell } from '@/components/auth/AuthShell';
import { InvestorSignInForm } from '@/components/auth/InvestorSignInForm';

function LoginInner() {
  const sp = useSearchParams();
  const investorMode = sp.get('as') === 'investor';
  const next = sp.get('next') ?? (investorMode ? '/portal' : '/pipeline');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // Bug fix (2026-08-05) — the investor sign-in form itself (magic link,
  // code, password) now lives entirely in InvestorSignInForm, shared with
  // /portal (same root cause: two copies of this form drifted apart, see
  // that component's own header). This page only still needs `linkFailed`
  // itself, to pass down — clearing it from the URL is page-specific (other
  // query params like `as`/`next` must survive the cleanup) so it stays here.
  const [linkFailed, setLinkFailed] = useState(false);

  useEffect(() => {
    if (!investorMode) return;
    if (sp.get('linkFailed') === '1') {
      setLinkFailed(true);
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete('linkFailed');
      const qs = cleanParams.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
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

        {investorMode ? (
          <InvestorSignInForm next={next} linkFailed={linkFailed} />
        ) : (
          <>
            <label className="mb-1 block text-xs font-medium text-gray-500">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com"
              className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
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
        {/* Prompt 341 — availability BEFORE contracting is a legal
            requirement, not cosmetic (DL 7/2004). */}
        <p className="mt-3 text-center text-[11px] text-gray-400">
          By signing in you agree to the <Link href="/terms" target="_blank" className="hover:underline">Terms &amp; Conditions</Link>.
        </p>
      </div>
    </AuthShell>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginInner /></Suspense>;
}
