'use client';
// Item 1 (Lote E) — the guest preview: no session, no password, no
// "create an account first" wall before seeing anything. Resolves via
// /api/guest/[token] (public, service-role, never a signed URL — see that
// route's own header). "Create your free account" sends a passwordless
// OTP to the exact email this invite was addressed to (the same mechanism
// documents/page.tsx's resendInvite already uses for founder-triggered
// invites) — clicking that email link lands the guest on /portal, where
// the existing "Is this you?" gate (Prompt 33/47) confirms the grant for
// real. Nothing new needed there; this page only has to get them that far.
import { useEffect, useState } from 'react';
import { BRAND_NAME } from '@/lib/brand';
import { browserClient, authEnabled } from '@/lib/supabase';

type GuestPreview = {
  ok: true; orgName: string; orgDescription: string | null; orgLogoUrl: string | null;
  invitedEmail: string; documentNames: string[]; documentCount: number;
};
type GuestError = { ok: false; reason: 'expired' | 'invalid' };
type GuestResponse = GuestPreview | GuestError;

export default function GuestPreviewPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [data, setData] = useState<GuestResponse | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendErr, setSendErr] = useState('');

  useEffect(() => {
    fetch(`/api/guest/${token}`).then((r) => r.json()).then(setData).catch(() => setLoadErr(true));
  }, [token]);

  async function createAccount() {
    if (!data?.ok) return;
    setSending(true); setSendErr('');
    try {
      const sb = browserClient();
      const { error } = await sb.auth.signInWithOtp({
        email: data.invitedEmail,
        options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback?next=/portal` },
      });
      if (error) { setSendErr(error.message); return; }
      setSent(true);
    } finally { setSending(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-7 shadow-sm">
        <div className="mb-5 text-xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          {BRAND_NAME}
        </div>

        {!authEnabled || loadErr ? (
          <p className="text-sm text-gray-500">This preview isn&apos;t available right now.</p>
        ) : !data ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : !data.ok ? (
          data.reason === 'expired' ? (
            <>
              <p className="text-sm font-medium text-gray-900">This link expired.</p>
              <p className="mt-1.5 text-sm text-gray-500">Ask the founder who invited you for a new one.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-900">This link doesn&apos;t work.</p>
              <p className="mt-1.5 text-sm text-gray-500">It may have already been used, or the invite was revoked. Ask the founder who invited you for a new link.</p>
            </>
          )
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              {data.orgLogoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.orgLogoUrl} alt="" className="h-10 w-10 rounded-lg border border-gray-100 object-cover" />
              )}
              <div>
                <p className="text-base font-semibold text-gray-900">{data.orgName}</p>
                {data.orgDescription && <p className="text-xs text-gray-500">{data.orgDescription}</p>}
              </div>
            </div>
            <p className="mb-4 text-xs text-gray-400">This preview was shared with {data.invitedEmail}.</p>

            {sent ? (
              <div className="rounded-xl border border-cyan-100 bg-[#E8F4F8] px-3 py-3 text-sm text-gray-700">
                Check your email — click the link we just sent to {data.invitedEmail} to open the data room.
              </div>
            ) : (
              <div className="mb-5 rounded-xl border border-cyan-100 bg-[#E8F4F8]/70 px-4 py-3.5 text-center backdrop-blur-sm">
                <p className="mb-2 text-sm font-medium text-gray-800">Create your free account to open these documents</p>
                <button disabled={sending} onClick={createAccount}
                  className="w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
                  {sending ? 'Sending…' : 'Create your free account'}
                </button>
                {sendErr && <p className="mt-2 text-xs text-[#B00000]">{sendErr}</p>}
              </div>
            )}

            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              {data.documentCount} document{data.documentCount === 1 ? '' : 's'} shared with you
            </p>
            {data.documentCount === 0 ? (
              <p className="text-sm text-gray-400">No documents shared yet — check back later.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.documentNames.map((name) => (
                  <li key={name} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm text-gray-700">
                    📄 <span className="truncate">{name}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
