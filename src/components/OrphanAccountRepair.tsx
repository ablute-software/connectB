'use client';
// Prompt 152 — safety net for the "signed up, has a session, but
// /api/provision-org never finished" state (confirmed live: a real founder
// account with zero org_members rows and no matching orgs row at all).
// Shell.tsx renders this instead of the normal app chrome whenever an
// authenticated user resolves to role==='none' — which, per resolveRole(),
// can only mean no org_members row, no platform_admins row, no matching
// access_grants, and not an @ablute.pt address: i.e. genuinely orphaned,
// never a normal in-progress state (Supabase issues no session at all
// until email confirmation completes, when that's required, so there's no
// legitimate authenticated-but-still-mid-signup case this could wrongly
// catch).
//
// Re-submits to the same /api/provision-org the signup form uses — that
// route is already idempotent (returns the existing org unchanged if one
// is found) and safe to call again. Only asks for the 3 fields the route
// actually requires (org_name, full_name, title); everything else on the
// original signup form was optional and can be filled in later from
// Settings.
import { useState } from 'react';
import { AuthShell } from './auth/AuthShell';

export function OrphanAccountRepair({ userId, email }: { userId: string; email: string | null }) {
  const [orgName, setOrgName] = useState('');
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = !busy && !!orgName.trim() && !!fullName.trim() && !!title.trim();

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/provision-org', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          user_id: userId, org_name: orgName.trim(), full_name: fullName.trim(), title: title.trim(),
          email: email ?? undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!body || body.ok === false) {
        setError(body?.error ?? 'Could not finish setting up your workspace — please try again.');
        return;
      }
      window.location.href = '/pipeline';
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-7 shadow-2xl">
        <h1 className="text-lg font-bold text-gray-900">Finish setting up your account</h1>
        <p className="mt-1.5 text-sm text-gray-500">
          You&apos;re signed in, but the last step of creating your workspace didn&apos;t finish. Fill these in to
          complete it — nothing else is lost, and you can fill in the rest of your company profile afterwards.
        </p>
        <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Company / startup name *"
          className="mt-4 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name *"
          className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Your title / role *"
          className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        {error && <p className="mt-2 text-xs text-[#B00000]">{error}</p>}
        <button onClick={() => void submit()} disabled={!canSubmit}
          className="mt-4 w-full rounded-xl bg-[#0E7490] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">
          {busy ? 'Setting up…' : 'Finish setup'}
        </button>
      </div>
    </AuthShell>
  );
}
