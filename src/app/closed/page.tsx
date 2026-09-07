'use client';
// Prompt 602 §C — where a member of an account the OWNER closed lands: the
// middleware sends a signed-in member here (account_access_state() =
// 'closed'), and the owner arrives right after closing (their session is
// ended with everyone else's, so this page is public and reads only the
// non-sensitive name/date it was given). Says who closed it and what is
// kept — never "your account expired".
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { ACCOUNT_RETENTION_DAYS } from '@/lib/account-security';
import { browserClient } from '@/lib/supabase';

function ClosedInner() {
  const sp = useSearchParams();
  const name = sp.get('name');
  const until = sp.get('until');
  const untilText = until && !Number.isNaN(new Date(until).getTime()) ? new Date(until).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

  async function signOut() {
    try { await browserClient().auth.signOut(); } catch { /* ignore */ }
    window.location.href = '/login';
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm rounded-2xl bg-white/95 p-6 text-center shadow-xl backdrop-blur">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-2xl">⏻</div>
        <h1 className="text-lg font-semibold text-gray-900">{name ? `${name} was closed by its owner` : 'This account was closed by its owner'}</h1>
        <p className="mt-2 text-sm text-gray-500">
          Access has ended for every member. Nothing has been deleted: the data is kept {untilText ? <>until <b>{untilText}</b></> : <>for {ACCOUNT_RETENTION_DAYS} days</>} in case this was a mistake, and within that window the owner can ask support to reopen the account.
        </p>
        <p className="mt-2 text-xs text-gray-500">
          To request the effective deletion of your data (GDPR, Article 17), use the <a href="/privacy-request" className="text-[#0E7490] underline">data-rights request</a>.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <a href="/contact" className="rounded-xl bg-[#0E7490] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0c637b]">Contact support</a>
          <button onClick={signOut} className="text-xs text-gray-400 hover:underline">Sign out</button>
        </div>
      </div>
    </AuthShell>
  );
}

export default function ClosedPage() {
  return <Suspense fallback={null}><ClosedInner /></Suspense>;
}
