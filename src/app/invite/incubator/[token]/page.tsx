'use client';
// Prompt I-01 §C.2 — /invite/incubator/[token], public. Shows the incubator
// (name, logo, type), the cohort, the voucher if any, the default-level text
// (literal, English since I-01b §C) and — before the buttons — the D3 notice
// when the house also invests. Accept / Decline.
//
// I-01b §A — only the invited address can accept or decline. A signed-in
// account with another address gets the masked invited address, a sign-out
// button, and never a write. The page itself only ever has the MASKED
// address, so the mismatch is known from the server's answer to the click.
//
// The token lives in this PATH only. The login/signup detour never carries
// it in a query string: it waits in this browser's localStorage and the
// detour's `next` is the fixed /invite/incubator/continue, which puts the
// token back into a path.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { browserClient, authEnabled } from '@/lib/supabase';
import {
  ALSO_INVESTS_NOTICE, INCUBATOR_INVITE_CONTINUE_PATH, INCUBATOR_INVITE_STORAGE_KEY,
  defaultLevelNotice, incubatorErrorText, incubatorKindLabel, inviteEmailMismatchText,
  type StoredIncubatorInvite,
} from '@/lib/incubators';
import { planLabelForSlug } from '@/lib/plans';
import { DEMO_INVITE_PREVIEW } from '@/lib/incubator-demo';

interface Preview {
  ok: boolean; error?: string; demo?: boolean; status?: string; invitedEmailMasked?: string | null;
  incubator?: { name: string; logoUrl: string | null; kind: string; alsoInvests: boolean };
  cohortName?: string | null;
  voucher?: { plans: string[]; months: number | null; kind: string; discountPct: number } | null;
  stub?: { startupName: string | null; sector: string | null; website: string | null };
}

export default function IncubatorInvitePage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  const [p, setP] = useState<Preview | null>(null);
  // undefined = still loading; null = signed out; string = signed-in address.
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { kind: 'accepted' | 'declined'; voucherMsg?: string }>(null);
  const [err, setErr] = useState('');
  const [mismatch, setMismatch] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/invite/incubator/${encodeURIComponent(token)}`).then((r) => r.json()).then((d: Preview) => {
      setP(d.demo ? (DEMO_INVITE_PREVIEW as Preview) : d);
    }).catch(() => setP({ ok: false, error: 'network' }));
    if (authEnabled) browserClient().auth.getUser().then(({ data }) => setSessionEmail(data.user?.email ?? null));
    else setSessionEmail(null);
  }, [token]);

  function remember() {
    const stored: StoredIncubatorInvite = {
      token, invitedEmailMasked: p?.invitedEmailMasked ?? null, incubatorName: p?.incubator?.name ?? null,
      startupName: p?.stub?.startupName ?? null, sector: p?.stub?.sector ?? null, website: p?.stub?.website ?? null, savedAt: Date.now(),
    };
    try { window.localStorage.setItem(INCUBATOR_INVITE_STORAGE_KEY, JSON.stringify(stored)); } catch { /* storage blocked — the link still works */ }
  }

  async function act(kind: 'accept' | 'decline') {
    if (kind === 'decline' && !window.confirm('Decline this invite? The organisation will see that you declined.')) return;
    setBusy(true); setErr(''); setMismatch(null);
    try {
      const r = await fetch(`/api/invite/incubator/${encodeURIComponent(token)}/${kind}`, { method: 'POST' }).then((x) => x.json());
      if (!r.ok) {
        if (r.error === 'invite_email_mismatch') { setMismatch(r.invitedEmailMasked ?? null); return; }
        setErr(r.message ?? incubatorErrorText(r.error)); return;
      }
      try { window.localStorage.removeItem(INCUBATOR_INVITE_STORAGE_KEY); } catch { /* ignore */ }
      setDone(kind === 'accept'
        ? { kind: 'accepted', voucherMsg: r.voucher && !r.voucher.applied ? r.voucher.message : undefined }
        : { kind: 'declined' });
    } finally { setBusy(false); }
  }

  async function signOut() {
    remember();
    await browserClient().auth.signOut().catch(() => {});
    window.location.href = `/login?next=${encodeURIComponent(INCUBATOR_INVITE_CONTINUE_PATH)}`;
  }

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] p-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-100 bg-white p-6 shadow-xl" data-testid="incubator-invite">{children}</div>
    </div>
  );

  if (!p || sessionEmail === undefined) return shell(<p className="text-sm text-gray-400">Loading…</p>);
  if (!p.ok || !p.incubator) return shell(<p className="text-sm text-gray-700">{incubatorErrorText(p.error ?? 'invite_not_found')}</p>);

  const inc = p.incubator;
  if (done) {
    return shell(done.kind === 'accepted' ? (
      <div>
        <h1 className="text-lg font-bold text-gray-900">You are linked to {inc.name}</h1>
        <p className="mt-2 text-sm text-gray-600">Sharing level: 1 · Profile. You can change it, or end the relationship, in Settings › Programmes.</p>
        {done.voucherMsg && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{done.voucherMsg}</p>}
        <Link href="/settings?tab=programs" className="mt-4 inline-block rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white">See my programmes</Link>
      </div>
    ) : <p className="text-sm text-gray-700">Invite declined. Nothing was shared with {inc.name}.</p>);
  }

  const closedStatus = p.status && p.status !== 'invited';
  const voucherPlan = p.voucher?.plans?.[0];
  const wrongAccount = mismatch !== null;
  const maskedInvited = mismatch ?? p.invitedEmailMasked ?? null;

  return shell(
    <div>
      <div className="flex items-center gap-3">
        {inc.logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={inc.logoUrl} alt="" className="h-12 w-12 rounded-xl object-contain" />
          : <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E8F4F8] text-lg font-bold text-[#0E7490]">{inc.name.slice(0, 1).toUpperCase()}</div>}
        <div>
          <h1 className="text-lg font-bold text-gray-900">{inc.name}</h1>
          <p className="text-xs text-gray-500">{incubatorKindLabel(inc.kind)}{p.cohortName ? ` · ${p.cohortName}` : ''}</p>
        </div>
      </div>
      <p className="mt-4 text-sm text-gray-700">{inc.name} has invited {p.stub?.startupName ? <strong>{p.stub.startupName}</strong> : 'your startup'} to follow the programme on Sherlock Deal.</p>
      {p.voucher && voucherPlan && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Voucher included: the {planLabelForSlug(voucherPlan)} plan{p.voucher.months ? ` for ${p.voucher.months} months` : ''}.
        </p>
      )}
      <p className="mt-3 text-sm text-gray-700" data-testid="default-level-notice">{defaultLevelNotice(inc.name)}</p>
      {inc.alsoInvests && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="also-invests-notice">{ALSO_INVESTS_NOTICE}</p>
      )}

      {closedStatus ? (
        <p className="mt-5 text-sm text-gray-700">{incubatorErrorText(p.status === 'closed' ? 'incubator_closed' : `invite_${p.status}`)}</p>
      ) : !authEnabled ? (
        <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Demo mode — accepting and declining need a connected database.</p>
      ) : sessionEmail && wrongAccount ? (
        <div className="mt-5 space-y-2" data-testid="invite-email-mismatch">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{inviteEmailMismatchText(maskedInvited, inc.name)}</p>
          <p className="text-xs text-gray-500">You are signed in as {sessionEmail}.</p>
          <button className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700" onClick={signOut}>Sign out</button>
        </div>
      ) : sessionEmail ? (
        <div className="mt-5 flex gap-2">
          <button className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => act('accept')} data-testid="accept-invite">Accept</button>
          <button className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 disabled:opacity-50" disabled={busy} onClick={() => act('decline')}>Decline</button>
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          <p className="text-xs text-gray-500">To accept or decline, sign in to your startup account — or create it (the invite details are pre-filled). Use the address the invite was sent to{maskedInvited ? ` (${maskedInvited})` : ''}.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/signup?invite=incubator&next=${encodeURIComponent(INCUBATOR_INVITE_CONTINUE_PATH)}`} onClick={remember}
              className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white">Create account</Link>
            <Link href={`/login?next=${encodeURIComponent(INCUBATOR_INVITE_CONTINUE_PATH)}`} onClick={remember}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700">I already have an account</Link>
          </div>
        </div>
      )}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </div>,
  );
}
