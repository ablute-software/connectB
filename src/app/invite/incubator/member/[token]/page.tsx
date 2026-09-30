'use client';
// Prompt I-01 §C.1 — accept an invitation to an incubator's TEAM. The person
// signs in (or creates an account) with the invited address; there is no
// founder signup here — a manager is never an org_members row.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { browserClient, authEnabled } from '@/lib/supabase';
import { INCUBATOR_MEMBER_INVITE_STORAGE_KEY, incubatorErrorText } from '@/lib/incubators';

interface Preview { ok: boolean; demo?: boolean; error?: string; status?: string; invitedEmail?: string; role?: string; incubator?: { name: string; logoUrl: string | null } }

export default function IncubatorMemberInvitePage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  const [p, setP] = useState<Preview | null>(null);
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch(`/api/invite/incubator/member/${encodeURIComponent(token)}`).then((r) => r.json()).then(setP).catch(() => setP({ ok: false }));
    if (authEnabled) browserClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    else setEmail(null);
  }, [token]);

  async function accept() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`/api/invite/incubator/member/${encodeURIComponent(token)}/accept`, { method: 'POST' }).then((x) => x.json());
      if (!r.ok) { setMsg(r.message ?? incubatorErrorText(r.error)); return; }
      try { window.localStorage.removeItem(INCUBATOR_MEMBER_INVITE_STORAGE_KEY); } catch { /* ignore */ }
      window.location.href = '/incubator';
    } finally { setBusy(false); }
  }

  async function createAndAccept() {
    if (!p?.invitedEmail) return;
    setBusy(true); setMsg('');
    try {
      const sb = browserClient();
      const { data, error } = await sb.auth.signUp({ email: p.invitedEmail, password, options: { data: { password_set: true } } });
      if (error) { setMsg(error.message); return; }
      if (!data.session) { setMsg('Conta criada. Confirma o e-mail, entra, e volta a abrir este link.'); return; }
      await accept();
    } finally { setBusy(false); }
  }

  const box = (c: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-xl">{c}</div>
    </div>
  );
  if (!p || email === undefined) return box(<p className="text-sm text-gray-400">A carregar…</p>);
  if (p.demo) return box(<p className="text-sm text-amber-800">Modo demo — os convites de equipa precisam de uma base de dados ligada.</p>);
  if (!p.ok || !p.incubator) return box(<p className="text-sm text-gray-700">{incubatorErrorText(p.error ?? 'invite_not_found')}</p>);
  if (p.status !== 'invited') return box(<p className="text-sm text-gray-700">{incubatorErrorText(p.status === 'closed' ? 'incubator_closed' : `invite_${p.status}`)}</p>);

  const matches = !!email && email.toLowerCase() === p.invitedEmail?.toLowerCase();
  return box(
    <div>
      <h1 className="text-lg font-bold text-gray-900">Equipa da {p.incubator.name}</h1>
      <p className="mt-2 text-sm text-gray-600">Convite para {p.invitedEmail}, como {p.role === 'owner' ? 'owner' : 'gestor(a)'} do workspace da incubadora.</p>
      {email && matches ? (
        <button className="mt-4 rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={accept}>Aceitar</button>
      ) : email ? (
        <p className="mt-4 text-sm text-amber-800">Estás com a sessão de {email}. Sai e entra com {p.invitedEmail} para aceitar.</p>
      ) : (
        <div className="mt-4 space-y-2">
          <Link href={`/login?next=${encodeURIComponent('/incubator')}`} className="text-sm text-[#0E7490] hover:underline"
            onClick={() => { try { window.localStorage.setItem(INCUBATOR_MEMBER_INVITE_STORAGE_KEY, token); } catch { /* ignore */ } }}>
            Já tenho conta com este e-mail — entrar
          </Link>
          <div className="flex items-end gap-2 pt-2">
            <label className="flex-1 text-xs text-gray-600">Criar conta — palavra-passe
              <input type="password" className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
            <button className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || password.length < 8} onClick={createAndAccept}>Criar e aceitar</button>
          </div>
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}
    </div>,
  );
}
