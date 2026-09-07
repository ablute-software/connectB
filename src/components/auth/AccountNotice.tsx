'use client';
// Prompt 602 — the login page's one-line notices after an account event:
// ?account=secured (the owner clicked "this wasn't me": sessions ended, a
// fresh reset link sent) and ?account=invalid (the link was used or expired).
import { useEffect, useState } from 'react';

export function AccountNotice() {
  const [state, setState] = useState<string | null>(null);
  useEffect(() => {
    setState(new URLSearchParams(window.location.search).get('account'));
  }, []);
  if (state === 'secured') {
    return (
      <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        Your account was secured: every session was ended and the previous password no longer works. A one-time link to choose a new password was sent to your email.
      </div>
    );
  }
  if (state === 'invalid') {
    return (
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        That security link is no longer valid — it was already used or has expired. If you are worried about your account, reset your password from the link below.
      </div>
    );
  }
  return null;
}
