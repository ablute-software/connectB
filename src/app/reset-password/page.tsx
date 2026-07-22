'use client';
// Reached after /auth/callback exchanges the recovery-link code for a
// session — by the time this renders, the user already has a valid (if
// short-lived) session, so this just sets a new password via updateUser.
import { useState } from 'react';
import { browserClient, authEnabled } from '@/lib/supabase';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    setMsg('');
    if (password.length < 8) { setMsg('Use at least 8 characters.'); return; }
    if (password !== confirm) { setMsg("Passwords don't match."); return; }
    setBusy(true);
    try {
      const sb = browserClient();
      const { error } = await sb.auth.updateUser({ password });
      if (error) { setMsg(error.message); return; }
      setDone(true);
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-7 shadow-sm">
        <div className="mb-1 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          connect<span className="text-[#22D3EE]">B</span>
        </div>
        <p className="mb-5 text-sm text-gray-500">Set a new password.</p>

        {!authEnabled ? (
          <p className="text-xs text-amber-800">Demo mode — authentication is not configured.</p>
        ) : done ? (
          <>
            <p className="mb-4 text-sm text-green-700">Password updated.</p>
            <a href="/" className="block w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-center text-sm font-semibold text-white hover:bg-[#0c637b]">
              Continue
            </a>
          </>
        ) : (
          <>
            <label className="mb-1 block text-xs font-medium text-gray-500">New password</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••"
              className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            <label className="mb-1 block text-xs font-medium text-gray-500">Confirm password</label>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" placeholder="••••••••"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="mb-4 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            <button disabled={busy || !password || !confirm} onClick={submit}
              className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
              {busy ? 'Saving…' : 'Update password'}
            </button>
            {msg && <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">{msg}</div>}
          </>
        )}
      </div>
    </div>
  );
}
