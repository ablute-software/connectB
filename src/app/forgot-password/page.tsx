'use client';
import { useState } from 'react';
import Link from 'next/link';
import { browserClient, authEnabled } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function send() {
    setBusy(true); setMsg('');
    try {
      const sb = browserClient();
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/reset-password')}`,
      });
      setMsg(error ? error.message : "If that email has an account, we've sent a reset link.");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-7 shadow-sm">
        <div className="mb-1 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          connect<span className="text-[#22D3EE]">B</span>
        </div>
        <p className="mb-5 text-sm text-gray-500">Reset your password.</p>

        {!authEnabled ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Demo mode — authentication is not configured. <Link href="/" className="underline">Enter the app</Link>.
          </div>
        ) : (
          <>
            <label className="mb-1 block text-xs font-medium text-gray-500">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com"
              onKeyDown={(e) => e.key === 'Enter' && send()}
              className="mb-4 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            <button disabled={busy || !email} onClick={send}
              className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        )}

        {msg && <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">{msg}</div>}

        <div className="mt-5 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
          <Link href="/login" className="font-medium text-[#0E7490] hover:underline">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
