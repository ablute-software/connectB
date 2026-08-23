'use client';
// Prompt 335 §D1 — the landing page a copied invite-link opens to. No auth
// required to view it (the recipient hasn't signed up yet) — this is pure
// information plus a path to /signup. Materializing the real network_invites
// connection request happens automatically when they sign up with the
// matching email (provision-org's own hook) — this page never has to do
// that itself, it's purely explanatory.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

export default function InviteLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<{ ok: boolean; inviterName?: string; message?: string; error?: string } | null>(null);

  useEffect(() => {
    fetch(`/api/network/invite-link/${token}`).then((r) => r.json()).then(setData).catch(() => setData({ ok: false, error: 'Something went wrong.' }));
  }, [token]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-6 text-center">
      <h1 className="text-lg font-bold text-gray-900">Sherlock Deal</h1>
      {!data ? (
        <p className="mt-4 text-sm text-gray-400">Loading…</p>
      ) : !data.ok ? (
        <p className="mt-4 text-sm text-gray-500">{data.error}</p>
      ) : (
        <>
          <p className="mt-4 text-sm text-gray-700">
            <span className="font-semibold">{data.inviterName}</span> invited you to connect on Sherlock Deal.
          </p>
          <p className="mt-2 max-w-prose rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm italic text-gray-600">&ldquo;{data.message}&rdquo;</p>
          <Link href="/signup" className="mt-4 rounded-lg bg-[#0E7490] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0c637b]">
            Create your account
          </Link>
          <p className="mt-2 text-[11px] text-gray-400">Already have an account? <Link href="/login" className="text-[#0E7490] hover:underline">Sign in</Link> — you&apos;ll see the invite waiting for you.</p>
        </>
      )}
    </div>
  );
}
