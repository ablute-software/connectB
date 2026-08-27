'use client';
// Prompt 126 B / Prompt 119 §4.3 D2 — offered right after an investor's
// first magic-link login (never forced, never a wall): "Set a password so
// you can sign in faster next time", skippable. Skipping just continues to
// `next` — user_metadata.password_set stays false, so the SAME prompt
// resurfaces next time they sign in by link, without ever blocking them
// (D1: the magic link itself never goes away as an option).
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { browserClient } from '@/lib/supabase';
import { LogoLockup } from '@/components/Logo';
import { AuthShell } from '@/components/auth/AuthShell';
import { PasswordRequirementsIndicator } from '@/components/auth/PasswordRequirementsIndicator';
import { checkPassword } from '@/lib/password-policy';
import { useTermsGateStatus } from '@/lib/terms-status';

function SetPasswordInner() {
  const sp = useSearchParams();
  const next = sp.get('next') ?? '/portal';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Prompt 404 §C.1 — this is the universal first-access screen for
  // magic-link/invited accounts (auth/callback/route.ts sends anyone
  // without password_set here), so it's where an investor (who has no
  // signup screen of their own — §B.4) accepts the Terms for the first
  // time. Reuses the exact same check TermsGateModal used to (now removed,
  // §D) — null while loading, so the checkbox doesn't flash in/out.
  const needsTerms = useTermsGateStatus();
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const requirementsMet = checkPassword(password).valid;
  // needsTerms === null (still loading) blocks both buttons too, same as
  // "true" — there's no honest default to show before the check resolves.
  const termsOk = needsTerms === false || (needsTerms === true && agreedToTerms);
  const canSubmit = requirementsMet && password === confirm && termsOk;
  const canSkip = needsTerms !== null && termsOk;

  async function acceptTermsIfNeeded() {
    if (needsTerms) await fetch('/api/terms/accept', { method: 'POST' }).catch(() => {});
  }

  async function submit() {
    setErr('');
    if (!requirementsMet) { setErr('Password does not meet the requirements above.'); return; }
    if (password !== confirm) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const sb = browserClient();
      // §4.4 — the real policy is enforced server-side (Supabase Auth
      // project config); if the server rejects this for a reason the
      // client-side indicator above didn't catch, that error is shown
      // verbatim, not replaced with our own wording.
      const { error } = await sb.auth.updateUser({ password, data: { password_set: true } });
      if (error) { setErr(error.message); return; }
      await acceptTermsIfNeeded();
      window.location.href = next;
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (!canSkip) return;
    setBusy(true);
    try {
      await acceptTermsIfNeeded();
      window.location.href = next;
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-7 shadow-2xl">
        <div className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          <LogoLockup size={28} accentClassName="text-[#2a7f8e]" />
        </div>
        <h1 className="mb-1 text-base font-semibold text-gray-900">Set a password so you can sign in faster next time</h1>
        <p className="mb-4 text-sm text-gray-500">You can always still sign in with an emailed link instead — this is optional.</p>

        <label className="mb-1 block text-xs font-medium text-gray-500">New password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••••"
          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        <PasswordRequirementsIndicator password={password} />

        <label className="mb-1 mt-3 block text-xs font-medium text-gray-500">Confirm password</label>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" placeholder="••••••••••"
          onKeyDown={(e) => e.key === 'Enter' && canSubmit && void submit()}
          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />

        {/* Prompt 404 §C.1 — only when this user hasn't accepted the
            current Terms version yet; same required block/visual as
            signup's own 2nd checkbox (§B.1), no newsletter checkbox here
            (that one's signup-only). Nothing renders while needsTerms is
            still loading (null) — the screen looks exactly like it does
            today until the check resolves either way. */}
        {needsTerms === true && (
          <label className="mt-3 flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2.5 text-sm text-gray-700">
            <input type="checkbox" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)}
              className="mt-0.5 accent-[#0E7490]" />
            I have read and accept the{' '}
            <Link href="/terms" target="_blank" className="font-semibold text-[#0E7490] hover:underline">Terms &amp; Conditions</Link>.
          </label>
        )}

        {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}

        <button disabled={busy || !canSubmit} onClick={() => void submit()}
          className="mt-4 w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
          {busy ? 'Saving…' : 'Set password'}
        </button>
        <button onClick={() => void skip()} disabled={busy || !canSkip} className="mt-2 block w-full text-center text-xs text-gray-400 hover:underline disabled:opacity-40">
          Skip for now
        </button>
      </div>
    </AuthShell>
  );
}

export default function SetPasswordPage() {
  return <Suspense fallback={null}><SetPasswordInner /></Suspense>;
}
