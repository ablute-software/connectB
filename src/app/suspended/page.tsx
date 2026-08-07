'use client';
// Prompt 123 Block C.2 — where middleware.ts sends a signed-in user whose
// org (or investor firm) has moderation_status <> 'active'. Deliberately
// bare of any account-specific detail (no "you were suspended because…") —
// that reasoning lives in the backoffice's justification text, not surfaced
// to the affected user here; they're told to contact support instead.
//
// Item 6 (2026-08-06) — this used to be a mailto: link. Replaced with the
// same ContactForm every other support entry point uses, embedded directly
// on the page rather than linked out: a suspended user with a session gets
// redirected BACK to /suspended from any page that isn't /suspended or
// /api/* (src/middleware.ts:57-61) — a link to /contact would just bounce
// them right back here. Submitting to /api/support/submit works
// unconditionally because /api/* is exactly the one path class the
// middleware doesn't intercept for a suspended session.
import { useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';
import { browserClient } from '@/lib/supabase';
import { ContactForm } from '@/components/ContactForm';

async function signOut() {
  try { await browserClient().auth.signOut(); } catch { /* ignore */ }
  window.location.href = '/login';
}

export default function SuspendedPage() {
  const [defaultEmail, setDefaultEmail] = useState('');

  useEffect(() => {
    browserClient().auth.getUser().then(({ data }) => {
      if (data.user?.email) setDefaultEmail(data.user.email);
    });
  }, []);

  return (
    <AuthShell>
      <div className="w-full max-w-sm rounded-2xl bg-white/95 p-6 text-center shadow-xl backdrop-blur">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-2xl">⚑</div>
        <h1 className="text-lg font-semibold text-gray-900">This account is suspended</h1>
        <p className="mt-2 text-sm text-gray-500">
          Access has been paused by the Sherlock Deal team. If you believe this is a mistake, contact us below.
        </p>
        <div className="mt-4 text-left">
          <ContactForm source="suspended" defaultEmail={defaultEmail} defaultCategory="other" hideCategory />
        </div>
        <button onClick={() => void signOut()} className="mt-3 block w-full text-xs text-gray-400 hover:underline">
          Sign out
        </button>
      </div>
    </AuthShell>
  );
}
