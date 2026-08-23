'use client';
// My Network — Prompt 316 §C. Real page, replacing the Prompt 314
// placeholder. Rede interna entre founders e investidores com UMA
// finalidade: entreajuda no levantamento de capital — vendas/parcerias/
// prospecção comercial são proibidas (aplicado por produto nos prompts
// seguintes desta série). Regra estrutural anti-spam: nenhuma ligação sem
// contexto verificável — não existe pesquisa livre de pessoas, por isso não
// há nenhuma caixa "procurar pessoas" nesta página, propositadamente.
// Regra anti-ranking: nada aqui compara founders entre si.
//
// Sem feed, sem posts, sem referências ainda — chegam nos prompts
// seguintes (317-324).
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, Toggle } from '@/components/ui';

interface ConnectionView { id: string; otherActorId: string; otherName: string; otherKind: 'founder' | 'investor'; originContext: string | null; createdAt: string }
interface InviteReceivedView { id: string; fromName: string; fromKind: 'founder' | 'investor'; contextRef: string | null; message: string; expiresAt: string }
interface InviteSentView { id: string; toName: string; toKind: 'founder' | 'investor'; status: 'pending' | 'accepted' | 'declined' | 'expired'; expiresAt: string }
interface SuggestionView { actorId: string; name: string; investorName: string }

interface NetworkBootstrap {
  available: boolean;
  myActorKind?: 'founder' | 'investor';
  discoverable?: boolean;
  connections?: ConnectionView[];
  invitesReceived?: InviteReceivedView[];
  invitesSent?: InviteSentView[];
  pendingSentCount?: number;
  suggestions?: SuggestionView[];
}

function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
}

export default function NetworkPage() {
  const { updateOrg } = useStore();
  const [state, setState] = useState<NetworkBootstrap | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerFor, setComposerFor] = useState<SuggestionView | null>(null);
  const [composerMessage, setComposerMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ id: string; action: 'remove' | 'block' } | null>(null);

  function load() {
    fetch('/api/network').then((r) => r.json()).then(setState).catch(() => setState(null));
  }
  useEffect(load, []);

  function respondToInvite(id: string, action: 'accept' | 'decline') {
    setBusy(true); setError(null);
    fetch('/api/network/invite/respond', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inviteId: id, action }),
    }).then((r) => r.json()).then((b) => { if (!b.ok) setError(b.error); load(); }).finally(() => setBusy(false));
  }

  function sendInvite() {
    if (!composerFor || !composerMessage.trim()) return;
    setBusy(true); setError(null);
    fetch('/api/network/invite', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toActorId: composerFor.actorId, message: composerMessage.trim(), contextRef: composerFor.investorName }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error); return; }
      setComposerFor(null); setComposerMessage(''); load();
    }).finally(() => setBusy(false));
  }

  function actOnConnection(id: string, action: 'remove' | 'block') {
    setBusy(true); setError(null);
    fetch('/api/network/connection', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connectionId: id, action }),
    }).then((r) => r.json()).then((b) => { if (!b.ok) setError(b.error); setConfirmAction(null); load(); }).finally(() => setBusy(false));
  }

  if (!state) return <p className="text-sm text-gray-400">Loading…</p>;

  if (!state.available) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">My Network</h1>
        <Card title="Not available yet">
          <p className="text-sm text-gray-500">This workspace doesn&apos;t have My Network enabled yet.</p>
        </Card>
      </div>
    );
  }

  const connections = state.connections ?? [];
  const invitesReceived = state.invitesReceived ?? [];
  const invitesSent = state.invitesSent ?? [];
  const suggestions = state.suggestions ?? [];

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-bold">My Network</h1>
        <p className="text-xs text-gray-400">
          Founders and investors helping each other raise — never sales, partnerships, or prospecting. No open people search:
          every connection starts from verified, shared context.
        </p>
      </div>

      {error && <p className="text-xs text-[#B00000]">{error}</p>}

      {composerFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setComposerFor(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold text-gray-800">Connect with {composerFor.name}</h2>
            <p className="mt-1 text-xs text-gray-500">Shared investor: {composerFor.investorName}</p>
            <textarea value={composerMessage} onChange={(e) => setComposerMessage(e.target.value)} rows={3} autoFocus
              placeholder="Why do you want to connect? (required)"
              className="mt-2 w-full rounded-lg border border-gray-300 p-2 text-sm" />
            <p className="mt-1 text-[11px] text-gray-400">
              {(state.pendingSentCount ?? 0)}/5 pending invites used.
            </p>
            <div className="mt-2 flex gap-1.5">
              <button onClick={sendInvite} disabled={busy || !composerMessage.trim() || (state.pendingSentCount ?? 0) >= 5}
                className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
                Send invite
              </button>
              <button onClick={() => setComposerFor(null)} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <Card title={`Your connections (${connections.length})`}>
        {connections.length === 0 ? (
          <p className="text-sm text-gray-400">No connections yet — accept an invite, or invite someone from a suggestion below.</p>
        ) : (
          <ul className="space-y-2">
            {connections.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2.5">
                <div>
                  <p className="text-sm font-medium text-gray-800">{c.otherName} <span className="text-[11px] font-normal text-gray-400">· {c.otherKind}</span></p>
                  {c.originContext && <p className="text-[11px] text-gray-400">{c.originContext}</p>}
                </div>
                {confirmAction?.id === c.id ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[11px] text-gray-500">Sure?</span>
                    <button onClick={() => actOnConnection(c.id, confirmAction.action)} disabled={busy}
                      className="rounded-full bg-[#B00000] px-2 py-1 text-[11px] font-semibold text-white">Yes</button>
                    <button onClick={() => setConfirmAction(null)} className="rounded-full border border-gray-300 px-2 py-1 text-[11px] text-gray-600">No</button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => setConfirmAction({ id: c.id, action: 'remove' })} className="text-[11px] text-gray-400 hover:text-[#B00000]">Remove</button>
                    <button onClick={() => setConfirmAction({ id: c.id, action: 'block' })} className="text-[11px] text-gray-400 hover:text-[#B00000]">Block</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Invites received (${invitesReceived.length})`}>
        {invitesReceived.length === 0 ? (
          <p className="text-sm text-gray-400">No pending invites.</p>
        ) : (
          <ul className="space-y-2">
            {invitesReceived.map((i) => (
              <li key={i.id} className="rounded-lg border border-gray-100 p-2.5">
                <p className="text-sm text-gray-800">{i.fromName} <span className="text-[11px] font-normal text-gray-400">· {i.fromKind}</span></p>
                {i.contextRef && <p className="text-[11px] text-gray-400">Shared investor: {i.contextRef}</p>}
                <p className="mt-1 text-xs italic text-gray-600">&ldquo;{i.message}&rdquo;</p>
                <p className="mt-1 text-[11px] text-gray-400">{daysLeft(i.expiresAt)}d left to respond</p>
                <div className="mt-1.5 flex gap-1.5">
                  <button onClick={() => respondToInvite(i.id, 'accept')} disabled={busy}
                    className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">Accept</button>
                  <button onClick={() => respondToInvite(i.id, 'decline')} disabled={busy}
                    className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600">Decline</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Invites sent (${invitesSent.length})`}>
        {invitesSent.length === 0 ? (
          <p className="text-sm text-gray-400">You haven&apos;t sent any invites yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {invitesSent.map((i) => (
              <li key={i.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{i.toName} <span className="text-[11px] text-gray-400">· {i.toKind}</span></span>
                <span className="text-[11px] text-gray-400">
                  {i.status === 'pending' ? `${daysLeft(i.expiresAt)}d left` : i.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {state.myActorKind === 'founder' && (
        <Card title="Suggestions">
          {!state.discoverable ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                Turn this on to see founders who share an investor with you, and let them discover you the same way.
              </p>
              <p className="text-[11px] text-gray-400">
                Only the fact that you share an investor is ever shown — never pipeline stages, counts, or anything else about your fundraise.
              </p>
              <Toggle checked={false} onChange={(v) => { updateOrg({ network_discoverable: v }); window.setTimeout(load, 400); }}
                label={<span className="text-xs text-gray-600">Let founders who share an investor with me discover me</span>} />
            </div>
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-gray-400">No suggestions yet — none of your invested investors overlap with another discoverable founder right now.</p>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li key={s.actorId} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2.5">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{s.name}</p>
                    <p className="text-[11px] text-gray-400">Shares the investor {s.investorName}</p>
                  </div>
                  <button onClick={() => { setComposerFor(s); setComposerMessage(''); }}
                    className="shrink-0 rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">
                    Connect
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
