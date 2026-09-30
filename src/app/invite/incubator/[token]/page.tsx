'use client';
// Prompt I-01 §C.2 — /invite/incubator/[token], public. Shows the incubator
// (name, logo, kind), the cohort, the voucher if any, the default-level text
// (literal) and — before the buttons — the D3 notice when the house also
// invests. Accept / Decline.
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
  defaultLevelNotice, incubatorErrorText, incubatorKindLabel, type StoredIncubatorInvite,
} from '@/lib/incubators';
import { planLabelForSlug } from '@/lib/plans';
import { DEMO_INVITE_PREVIEW } from '@/lib/incubator-demo';

interface Preview {
  ok: boolean; error?: string; demo?: boolean; status?: string; invitedEmail?: string;
  incubator?: { name: string; logoUrl: string | null; kind: string; alsoInvests: boolean };
  cohortName?: string | null;
  voucher?: { plans: string[]; months: number | null; kind: string; discountPct: number } | null;
  stub?: { startupName: string | null; sector: string | null; website: string | null };
}

export default function IncubatorInvitePage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  const [p, setP] = useState<Preview | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { kind: 'accepted' | 'declined'; voucherMsg?: string }>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`/api/invite/incubator/${encodeURIComponent(token)}`).then((r) => r.json()).then((d: Preview) => {
      setP(d.demo ? (DEMO_INVITE_PREVIEW as Preview) : d);
    }).catch(() => setP({ ok: false, error: 'network' }));
    if (authEnabled) browserClient().auth.getUser().then(({ data }) => setSignedIn(!!data.user));
    else setSignedIn(false);
  }, [token]);

  function remember() {
    const stored: StoredIncubatorInvite = {
      token, startupName: p?.stub?.startupName ?? null, sector: p?.stub?.sector ?? null, website: p?.stub?.website ?? null, savedAt: Date.now(),
    };
    try { window.localStorage.setItem(INCUBATOR_INVITE_STORAGE_KEY, JSON.stringify(stored)); } catch { /* storage blocked — the link still works */ }
  }

  async function accept() {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/invite/incubator/${encodeURIComponent(token)}/accept`, { method: 'POST' }).then((x) => x.json());
      if (!r.ok) { setErr(r.message ?? incubatorErrorText(r.error)); return; }
      try { window.localStorage.removeItem(INCUBATOR_INVITE_STORAGE_KEY); } catch { /* ignore */ }
      setDone({ kind: 'accepted', voucherMsg: r.voucher && !r.voucher.applied ? r.voucher.message : undefined });
    } finally { setBusy(false); }
  }

  async function decline() {
    if (!window.confirm('Recusar este convite? A incubadora fica a saber que recusaste.')) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/invite/incubator/${encodeURIComponent(token)}/decline`, { method: 'POST' }).then((x) => x.json());
      if (!r.ok) { setErr(r.message ?? incubatorErrorText(r.error)); return; }
      try { window.localStorage.removeItem(INCUBATOR_INVITE_STORAGE_KEY); } catch { /* ignore */ }
      setDone({ kind: 'declined' });
    } finally { setBusy(false); }
  }

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] p-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-100 bg-white p-6 shadow-xl" data-testid="incubator-invite">{children}</div>
    </div>
  );

  if (!p || signedIn === null) return shell(<p className="text-sm text-gray-400">A carregar…</p>);
  if (!p.ok || !p.incubator) return shell(<p className="text-sm text-gray-700">{incubatorErrorText(p.error ?? 'invite_not_found')}</p>);

  const inc = p.incubator;
  if (done) {
    return shell(done.kind === 'accepted' ? (
      <div>
        <h1 className="text-lg font-bold text-gray-900">Estás ligado à {inc.name}</h1>
        <p className="mt-2 text-sm text-gray-600">Nível de partilha: 1 · Perfil. Podes mudar isto, ou terminar a relação, em Definições › Programas.</p>
        {done.voucherMsg && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{done.voucherMsg}</p>}
        <Link href="/settings?tab=programs" className="mt-4 inline-block rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white">Ver os meus programas</Link>
      </div>
    ) : <p className="text-sm text-gray-700">Convite recusado. Nada foi partilhado com a {inc.name}.</p>);
  }

  const closedStatus = p.status && p.status !== 'invited';
  const voucherPlan = p.voucher?.plans?.[0];

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
      <p className="mt-4 text-sm text-gray-700">A {inc.name} convidou {p.stub?.startupName ? <strong>{p.stub.startupName}</strong> : 'a tua startup'} para acompanhar o programa no Sherlock Deal.</p>
      {p.voucher && voucherPlan && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Voucher incluído: plano {planLabelForSlug(voucherPlan)}{p.voucher.months ? ` durante ${p.voucher.months} meses` : ''}.
        </p>
      )}
      <p className="mt-3 text-sm text-gray-700" data-testid="default-level-notice">{defaultLevelNotice(inc.name)}</p>
      {inc.alsoInvests && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="also-invests-notice">{ALSO_INVESTS_NOTICE}</p>
      )}

      {closedStatus ? (
        <p className="mt-5 text-sm text-gray-700">{incubatorErrorText(p.status === 'closed' ? 'incubator_closed' : `invite_${p.status}`)}</p>
      ) : !authEnabled ? (
        <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Modo demo — aceitar e recusar precisam de uma base de dados ligada.</p>
      ) : signedIn ? (
        <div className="mt-5 flex gap-2">
          <button className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={accept} data-testid="accept-invite">Aceitar</button>
          <button className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 disabled:opacity-50" disabled={busy} onClick={decline}>Recusar</button>
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          <p className="text-xs text-gray-500">Para aceitar, entra na conta da tua startup — ou cria-a (os dados do convite ficam pré-preenchidos).</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/signup?invite=incubator&next=${encodeURIComponent(INCUBATOR_INVITE_CONTINUE_PATH)}`} onClick={remember}
              className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white">Criar conta</Link>
            <Link href={`/login?next=${encodeURIComponent(INCUBATOR_INVITE_CONTINUE_PATH)}`} onClick={remember}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700">Já tenho conta</Link>
            <button className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:underline disabled:opacity-50" disabled={busy} onClick={decline}>Recusar</button>
          </div>
        </div>
      )}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </div>,
  );
}
