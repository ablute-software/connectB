'use client';
// Prompt 905 — the page behind a published call's link. PLACEHOLDER: it shows the call's header and one
// sentence ("Applications open on [date]"). The real applicant screen — registration, the form, submission — is
// Prompt 906, which replaces this page. With CALLS_MODE off (or a token that does not exist) it says the link is
// not available, like any other dead link.
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LogoLockup } from '@/components/Logo';
import { formatInZone } from '@/lib/calls/tz';

interface PublicCall {
  name: string; description: string | null; promoter: string; opensAt: string | null; closesAt: string | null;
  timezone: string; status: string; message: string;
}

export default function CallLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [call, setCall] = useState<PublicCall | null | undefined>(undefined);

  useEffect(() => {
    fetch(`/api/calls/public/${encodeURIComponent(token)}`).then(async (r) => {
      const d = await r.json().catch(() => null);
      setCall(r.ok && d?.ok ? (d as PublicCall) : null);
    }).catch(() => setCall(null));
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 text-[#0E7490]"><LogoLockup size={26} accentClassName="text-[#2a7f8e]" /></div>
        {call === undefined ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : call === null ? (
          <>
            <h1 className="text-lg font-semibold text-gray-900">This link is not available</h1>
            <p className="mt-2 text-sm text-gray-500">The call may not be open yet, or the link may be wrong. Please check it with whoever sent it to you.</p>
          </>
        ) : (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{call.promoter}</p>
            <h1 className="mt-1 text-xl font-bold text-gray-900" data-testid="call-name">{call.name}</h1>
            {call.description && <p className="mt-3 whitespace-pre-line text-sm text-gray-600">{call.description}</p>}
            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-gray-400">Opens</dt><dd className="text-gray-800">{formatInZone(call.opensAt, call.timezone)}</dd>
              <dt className="text-gray-400">Closes</dt><dd className="text-gray-800">{formatInZone(call.closesAt, call.timezone)}</dd>
            </dl>
            <p className="mt-6 rounded-lg bg-[#E8F4F8] px-4 py-3 text-sm font-medium text-[#0E7490]" data-testid="call-message">{call.message}</p>
          </>
        )}
      </div>
    </main>
  );
}
