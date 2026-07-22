'use client';
// connectB sign-in — founders & developers use email+password; investors use a magic link.
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { browserClient, authEnabled } from '@/lib/supabase';

function LoginInner() {
  const sp = useSearchParams();
  const next = sp.get('next') ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

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
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      setMsg(error ? error.message : 'Check your email for the sign-in link.');
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-7 shadow-sm">
        <div className="mb-1 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          connect<span className="text-[#22D3EE]">B</span>
        </div>
        <p className="mb-5 text-sm text-gray-500">Sign in to your investor CRM.</p>

        {!authEnabled && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Demo mode — authentication is not configured. <Link href="/" className="underline">Enter the app</Link>.
          </div>
        )}

        <label className="mb-1 block text-xs font-medium text-gray-500">Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com"
          className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />

        {mode === 'password' && (
          <>
            <label className="mb-1 block text-xs font-medium text-gray-500">Password</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••"
              onKeyDown={(e) => e.key === 'Enter' && passwordLogin()}
              className="mb-4 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            <button disabled={busy || !email || !password} onClick={passwordLogin}
              className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button onClick={() => setMode('magic')} className="mt-3 w-full text-center text-xs text-gray-500 hover:underline">
              Investor? Sign in with a magic link
            </button>
          </>
        )}

        {mode === 'magic' && (
          <>
            <button disabled={busy || !email} onClick={magicLink}
              className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            <button onClick={() => setMode('password')} className="mt-3 w-full text-center text-xs text-gray-500 hover:underline">
              Back to password sign-in
            </button>
          </>
        )}

        {msg && <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">{msg}</div>}

        <div className="mt-5 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
          New founder? <Link href="/signup" className="font-medium text-[#0E7490] hover:underline">Create an account</Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginInner /></Suspense>;
}
