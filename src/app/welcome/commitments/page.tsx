'use client';
// Prompt 603 §C — the page between signup and the first workspace access:
// our commitments, in plain language, with every feature-naming commitment
// linking to the feature. Shown once per version (terms_acceptances,
// version 'commitments-1.0'); no countdown, no forced scroll — the record of
// who accepted which version, when, is what has value.
//
// Reachable at any time (Settings and the footer can link here); the
// automatic redirect after signup is behind COMMITMENTS_GATE_ENABLED until
// the text passes legal review (lib/commitments.ts).
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { LogoLockup } from '@/components/Logo';
import { BRAND_NAME } from '@/lib/brand';
import { getCommitments, COMMITMENTS_VERSION } from '@/lib/commitments';
import { COMMITMENTS_FOOTNOTE, CONTROLLER_NAME } from '@/content/commitments/v1';

function CommitmentsInner() {
  const sp = useSearchParams();
  const next = sp.get('next') && sp.get('next')!.startsWith('/') ? sp.get('next')! : '/pipeline';
  const [status, setStatus] = useState<{ needsAcceptance: boolean; gateEnabled: boolean; acceptedVersion: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const commitments = getCommitments();

  useEffect(() => {
    fetch('/api/commitments/status', { cache: 'no-store' }).then((r) => r.json()).then(setStatus).catch(() => setStatus({ needsAcceptance: false, gateEnabled: false, acceptedVersion: null }));
  }, []);

  async function accept() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/commitments/accept', { method: 'POST' });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not record your acceptance.'); return; }
      window.location.href = next;
    } finally { setBusy(false); }
  }

  const alreadyAccepted = status?.acceptedVersion === COMMITMENTS_VERSION;

  return (
    <AuthShell>
      <div className="w-full max-w-2xl rounded-2xl border border-gray-100 bg-white p-7 shadow-2xl">
        <div className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          <LogoLockup size={28} accentClassName="text-[#2a7f8e]" />
        </div>
        {status && !status.gateEnabled && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Draft under legal review — this page is not yet shown automatically to new accounts.
          </div>
        )}
        <h1 className="text-lg font-bold text-gray-900">Our commitments to you</h1>
        <p className="mt-1 text-sm text-gray-500">Before you start: what {BRAND_NAME} promises about your documents and your data, in plain words. Each promise is one we can keep and show.</p>

        <ol className="mt-5 space-y-4">
          {commitments.map((c) => (
            <li key={c.n} className="text-sm">
              <p className="font-semibold text-gray-900">{c.n}. {c.title}</p>
              <p className="mt-0.5 text-gray-700">{c.body}</p>
              {c.link && <Link href={c.link.href} className="mt-0.5 inline-block text-xs text-[#0E7490] hover:underline">{c.link.label} →</Link>}
            </li>
          ))}
        </ol>

        <p className="mt-5 text-xs text-gray-500">{COMMITMENTS_FOOTNOTE} Data controller: {CONTROLLER_NAME}. Read the <Link href="/terms" className="underline">Terms</Link> and the <Link href="/legal/subprocessors" className="underline">list of suppliers</Link>.</p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {alreadyAccepted ? (
            <>
              <span className="text-xs text-emerald-700">You accepted this version on record.</span>
              <Link href={next} className="rounded-xl bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c637b]">Continue</Link>
            </>
          ) : (
            <button disabled={busy || !status} onClick={accept}
              className="rounded-xl bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">{busy ? 'Recording…' : 'I have read this — continue'}</button>
          )}
          {err && <span className="text-xs text-[#B00000]">{err}</span>}
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Version {COMMITMENTS_VERSION}. Your acceptance is recorded with the version, the date and the email on the account.</p>
      </div>
    </AuthShell>
  );
}

export default function CommitmentsPage() {
  return <Suspense fallback={null}><CommitmentsInner /></Suspense>;
}
