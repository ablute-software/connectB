'use client';
// Post-Lote-1 addenda — the scanner-safe magic-link landing page. Approved
// as a MITIGATION, not a root-cause fix: we can't prove from this app's
// side that an email security scanner prefetches the raw Supabase
// /auth/v1/verify link and burns the single-use PKCE token before the
// human clicks (auth.audit_log_entries is empty in this project — no
// trail to confirm it), but it's a well-documented failure mode for this
// exact auth pattern, and the standard fix is exactly this: never let an
// automated GET consume the real token. A prefetcher issues a GET and
// nothing else — it never clicks a button — so the token stays alive
// until a real human does.
//
// This only works once Supabase's own Magic Link EMAIL TEMPLATE is
// changed (in the Supabase dashboard, not this repo — no tool here can
// edit Auth email templates) to link here instead of straight at
// /auth/v1/verify. Replace its body with something equivalent to:
//   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=%2Fportal">
//     Sign in to Sherlock Deal
//   </a>
// (swap %2Fportal for whichever default landing makes sense, or template
// it per audience if the project sends different templates for founders
// vs investors). /auth/callback and the code-entry fallback are UNCHANGED
// — this is a new, additional entry point, not a replacement.
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { browserClient, authEnabled } from '@/lib/supabase';
import { LogoLockup } from '@/components/Logo';
import { AuthShell } from '@/components/auth/AuthShell';
import type { EmailOtpType } from '@supabase/supabase-js';

function ConfirmInner() {
  const sp = useSearchParams();
  const tokenHash = sp.get('token_hash');
  const type = sp.get('type') as EmailOtpType | null;
  const next = sp.get('next') ?? '/pipeline';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function confirm() {
    if (!tokenHash || !type) return;
    setBusy(true); setErr('');
    try {
      const sb = browserClient();
      const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) {
        // Same fallback contract /auth/callback already uses: bounce back
        // to wherever `next` says with `linkFailed=1`, so that page's own
        // existing code-entry fallback takes over — not a second UX to
        // build and keep in sync.
        const url = new URL(next, window.location.origin);
        url.searchParams.set('linkFailed', '1');
        window.location.href = url.toString();
        return;
      }
      window.location.href = next;
    } finally {
      setBusy(false);
    }
  }

  if (!authEnabled) {
    return <p className="text-sm text-white/70">Sign-in isn&apos;t configured in this environment.</p>;
  }

  if (!tokenHash || !type) {
    return (
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        <p className="text-sm text-gray-600">This sign-in link is missing or malformed.</p>
        <a href="/login" className="mt-3 inline-block text-sm font-medium text-[#0E7490] hover:underline">Back to sign in</a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
      <h1 className="text-lg font-semibold text-gray-900">Confirm it&apos;s you</h1>
      <p className="mt-2 text-sm text-gray-500">
        One click to finish signing in to Sherlock Deal.
      </p>
      {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
      <button onClick={confirm} disabled={busy}
        className="mt-4 w-full rounded-lg bg-[#0E7490] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </div>
  );
}

export default function AuthConfirmPage() {
  return (
    <AuthShell>
      <LogoLockup />
      <Suspense fallback={null}>
        <ConfirmInner />
      </Suspense>
    </AuthShell>
  );
}
