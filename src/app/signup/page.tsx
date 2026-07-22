'use client';
// Founder sign-up: creates the auth user, then an org + owner membership via an API route.
import { useState } from 'react';
import Link from 'next/link';
import { browserClient, authEnabled } from '@/lib/supabase';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setMsg('');
    try {
      const sb = browserClient();
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { full_name: name, org_name: org } },
      });
      if (error) { setMsg(error.message); return; }
      // Provision org + membership (server route uses service role).
      await fetch('/api/provision-org', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: data.user?.id, org_name: org, email }),
      });
      if (data.session) { window.location.href = '/'; }
      else setMsg('Account created. Check your email to confirm, then sign in.');
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-7 shadow-sm">
        <div className="mb-1 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          connect<span className="text-[#22D3EE]">B</span>
        </div>
        <p className="mb-5 text-sm text-gray-500">Create your founder account and start managing your raise.</p>
        {!authEnabled && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Demo mode — sign-up is disabled. <Link href="/" className="underline">Enter the app</Link>.
          </div>
        )}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
          className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Company / startup name"
          className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com"
          className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password (min 8 chars)"
          className="mb-4 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        <button disabled={busy || !email || !password || !org} onClick={submit}
          className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
          {busy ? 'Creating…' : 'Create account'}
        </button>
        {msg && <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">{msg}</div>}
        <div className="mt-5 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
          Already have an account? <Link href="/login" className="font-medium text-[#0E7490] hover:underline">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
