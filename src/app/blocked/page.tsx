'use client';
// Prompt 244/245 — where middleware.ts sends a signed-in user whose email
// is in blocked_emails (migration 0180). Deliberately the same shape and
// tone as /suspended/page.tsx (no "why", just a path to contact support) —
// see that file's own header for the reasoning on embedding ContactForm
// directly rather than a mailto:/link (the same "a suspended/blocked
// session bounces right back here" logic applies unchanged).
import { useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';
import { browserClient } from '@/lib/supabase';
import { ContactForm } from '@/components/ContactForm';

async function signOut() {
  try { await browserClient().auth.signOut(); } catch { /* ignore */ }
  window.location.href = '/login';
}

export default function BlockedPage() {
  const [defaultEmail, setDefaultEmail] = useState('');

  useEffect(() => {
    browserClient().auth.getUser().then(({ data }) => {
      if (data.user?.email) setDefaultEmail(data.user.email);
    });
  }, []);

  return (
    <AuthShell>
      <div className="w-full max-w-sm rounded-2xl bg-white/95 p-6 text-center shadow-xl backdrop-blur">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl">⛔</div>
        <h1 className="text-lg font-semibold text-gray-900">This email can&apos;t access the platform</h1>
        <p className="mt-2 text-sm text-gray-500">
          If you believe this is a mistake, contact us below.
        </p>
        <div className="mt-4 text-left">
          <ContactForm source="blocked" defaultEmail={defaultEmail} defaultCategory="other" hideCategory />
        </div>
        <button onClick={() => void signOut()} className="mt-3 block w-full text-xs text-gray-400 hover:underline">
          Sign out
        </button>
      </div>
    </AuthShell>
  );
}
