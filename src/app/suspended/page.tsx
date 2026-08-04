'use client';
// Prompt 123 Block C.2 — where middleware.ts sends a signed-in user whose
// org (or investor firm) has moderation_status <> 'active'. Deliberately
// bare of any account-specific detail (no "you were suspended because…") —
// that reasoning lives in the backoffice's justification text, not surfaced
// to the affected user here; they're told to contact support instead.
import { AuthShell } from '@/components/auth/AuthShell';
import { browserClient } from '@/lib/supabase';

async function signOut() {
  try { await browserClient().auth.signOut(); } catch { /* ignore */ }
  window.location.href = '/login';
}

export default function SuspendedPage() {
  return (
    <AuthShell>
      <div className="w-full max-w-sm rounded-2xl bg-white/95 p-6 text-center shadow-xl backdrop-blur">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-2xl">⚑</div>
        <h1 className="text-lg font-semibold text-gray-900">This account is suspended</h1>
        <p className="mt-2 text-sm text-gray-500">
          Access has been paused by the Sherlock Deal team. If you believe this is a mistake, contact us.
        </p>
        <a href="mailto:ablutecompany@gmail.com" className="mt-4 inline-block rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b]">
          Contact Sherlock Deal
        </a>
        <button onClick={() => void signOut()} className="mt-3 block w-full text-xs text-gray-400 hover:underline">
          Sign out
        </button>
      </div>
    </AuthShell>
  );
}
