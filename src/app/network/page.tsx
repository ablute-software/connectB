'use client';
// My Network — Prompt 316 §C / Prompt 317 §D. Real page, replacing the
// Prompt 314 placeholder. Rede interna entre founders e investidores com
// UMA finalidade: entreajuda no levantamento de capital — vendas/parcerias/
// prospecção comercial são proibidas (aplicado por produto nos prompts
// seguintes desta série). Regra estrutural anti-spam: nenhuma ligação sem
// contexto verificável — não existe pesquisa livre de pessoas, por isso não
// há nenhuma caixa "procurar pessoas" nesta página, propositadamente.
// Regra anti-ranking: nada aqui compara founders entre si.
//
// Every overlay here goes through createPortal(..., document.body) with the
// SSR guard, per the CLAUDE.md rule — never a plain `fixed inset-0` inline
// in the tree (an ancestor with transform/filter/backdrop-filter silently
// collapses it with no error, the exact WorkspaceHeader incident this rule
// exists for).
//
// Sem feed, sem posts, sem referências ainda — chegam nos prompts
// seguintes (318-324).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { Card, Toggle } from '@/components/ui';

interface ConnectionView { id: string; otherActorId: string; otherName: string; otherKind: 'founder' | 'investor'; originContext: string | null; createdAt: string }
interface InviteReceivedView { id: string; fromName: string; fromKind: 'founder' | 'investor'; contextRef: string | null; message: string; expiresAt: string }
interface InviteSentView { id: string; toName: string; toKind: 'founder' | 'investor'; status: 'pending' | 'accepted' | 'declined' | 'expired'; expiresAt: string }
interface SuggestionReason { kind: 'shared_investor' | 'shared_group'; label: string }
interface SuggestionView { actorId: string; name: string; reasons: SuggestionReason[] }
interface GroupListView { id: string; name: string; description: string | null; kind: 'accelerator_batch' | 'investor_portfolio' | 'topic'; memberCount: number; isOwner: boolean }
interface GroupMemberDetailView { actorId: string; status: 'invited' | 'active' | 'left'; name: string; kind: 'founder' | 'investor' }
interface GroupDetailView { id: string; name: string; description: string | null; kind: GroupListView['kind']; isOwner: boolean; ownerActorId: string; members: GroupMemberDetailView[] }

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

const GROUP_KIND_LABEL: Record<GroupListView['kind'], string> = {
  accelerator_batch: 'Accelerator batch', investor_portfolio: 'Investor portfolio', topic: 'Topic',
};
const GROUP_KIND_STYLE: Record<GroupListView['kind'], string> = {
  accelerator_batch: 'bg-teal-100 text-teal-800', investor_portfolio: 'bg-cyan-100 text-cyan-900', topic: 'bg-gray-100 text-gray-600',
};

function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
}

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export default function NetworkPage() {
  const { updateOrg } = useStore();
  const [state, setState] = useState<NetworkBootstrap | null>(null);
  const [groups, setGroups] = useState<GroupListView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerFor, setComposerFor] = useState<SuggestionView | null>(null);
  const [composerMessage, setComposerMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ id: string; action: 'remove' | 'block' } | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState<{ name: string; description: string; kind: GroupListView['kind']; memberIds: Set<string> }>({
    name: '', description: '', kind: 'topic', memberIds: new Set(),
  });
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] = useState<GroupDetailView | null>(null);
  const [addMemberActorId, setAddMemberActorId] = useState('');

  function load() {
    fetch('/api/network').then((r) => r.json()).then(setState).catch(() => setState(null));
    fetch('/api/network/group').then((r) => r.json()).then((b) => setGroups(b.groups ?? [])).catch(() => setGroups([]));
  }
  useEffect(load, []);

  useEffect(() => {
    if (!openGroupId) { setGroupDetail(null); return; }
    fetch(`/api/network/group?groupId=${openGroupId}`).then((r) => r.json()).then((b) => setGroupDetail(b.group ?? null));
  }, [openGroupId]);

  function respondToInvite(id: string, action: 'accept' | 'decline') {
    setBusy(true); setError(null);
    fetch('/api/network/invite/respond', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inviteId: id, action }),
    }).then((r) => r.json()).then((b) => { if (!b.ok) setError(b.error); load(); }).finally(() => setBusy(false));
  }

  function sendInvite() {
    if (!composerFor || !composerMessage.trim()) return;
    const contextKind = composerFor.reasons[0]?.kind ?? 'shared_investor';
    const contextRef = composerFor.reasons.map((r) => r.label).join(' · ');
    setBusy(true); setError(null);
    fetch('/api/network/invite', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toActorId: composerFor.actorId, message: composerMessage.trim(), contextRef, contextKind }),
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

  function submitGroup() {
    if (!groupDraft.name.trim()) return;
    setBusy(true); setError(null);
    fetch('/api/network/group', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: groupDraft.name.trim(), description: groupDraft.description.trim() || undefined, kind: groupDraft.kind,
        initialMemberActorIds: [...groupDraft.memberIds],
      }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error); return; }
      setCreatingGroup(false); setGroupDraft({ name: '', description: '', kind: 'topic', memberIds: new Set() }); load();
    }).finally(() => setBusy(false));
  }

  function groupMemberAction(action: 'add' | 'remove' | 'leave', candidateActorId?: string) {
    if (!openGroupId) return;
    setBusy(true); setError(null);
    fetch('/api/network/group/member', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId: openGroupId, action, candidateActorId }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error); return; }
      if (action === 'leave') { setOpenGroupId(null); }
      else fetch(`/api/network/group?groupId=${openGroupId}`).then((r) => r.json()).then((d) => setGroupDetail(d.group ?? null));
      setAddMemberActorId('');
      load();
    }).finally(() => setBusy(false));
  }

  if (!state || !groups) return <p className="text-sm text-gray-400">Loading…</p>;

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
        <Modal onClose={() => setComposerFor(null)}>
          <h2 className="text-sm font-bold text-gray-800">Connect with {composerFor.name}</h2>
          {composerFor.reasons.map((r) => <p key={r.kind} className="mt-1 text-xs text-gray-500">{r.label}</p>)}
          <textarea value={composerMessage} onChange={(e) => setComposerMessage(e.target.value)} rows={3} autoFocus
            placeholder="Why do you want to connect? (required)"
            className="mt-2 w-full rounded-lg border border-gray-300 p-2 text-sm" />
          <p className="mt-1 text-[11px] text-gray-400">{(state.pendingSentCount ?? 0)}/5 pending invites used.</p>
          <div className="mt-2 flex gap-1.5">
            <button onClick={sendInvite} disabled={busy || !composerMessage.trim() || (state.pendingSentCount ?? 0) >= 5}
              className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
              Send invite
            </button>
            <button onClick={() => setComposerFor(null)} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
          </div>
        </Modal>
      )}

      {creatingGroup && (
        <Modal onClose={() => setCreatingGroup(false)}>
          <h2 className="text-sm font-bold text-gray-800">New group</h2>
          <div className="mt-2 space-y-2">
            <input value={groupDraft.name} onChange={(e) => setGroupDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Group name" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
            <textarea value={groupDraft.description} onChange={(e) => setGroupDraft((d) => ({ ...d, description: e.target.value }))}
              rows={2} placeholder="Short description (optional)" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
            <select value={groupDraft.kind} onChange={(e) => setGroupDraft((d) => ({ ...d, kind: e.target.value as GroupListView['kind'] }))}
              className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm">
              <option value="topic">Topic</option>
              <option value="accelerator_batch">Accelerator batch</option>
              {state.myActorKind === 'investor' && <option value="investor_portfolio">Investor portfolio</option>}
            </select>
            {connections.length === 0 ? (
              <p className="text-xs text-gray-400">You need at least one connection to create a group — see Suggestions below.</p>
            ) : (
              <div>
                <p className="text-[11px] font-medium text-gray-500">Initial members (from your connections)</p>
                <div className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                  {connections.map((c) => (
                    <label key={c.otherActorId} className="flex items-center gap-1.5 text-xs text-gray-700">
                      <input type="checkbox" checked={groupDraft.memberIds.has(c.otherActorId)}
                        onChange={(e) => setGroupDraft((d) => {
                          const next = new Set(d.memberIds);
                          if (e.target.checked) next.add(c.otherActorId); else next.delete(c.otherActorId);
                          return { ...d, memberIds: next };
                        })} />
                      {c.otherName}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button onClick={submitGroup} disabled={busy || !groupDraft.name.trim()}
              className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
              Create group
            </button>
            <button onClick={() => setCreatingGroup(false)} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
          </div>
        </Modal>
      )}

      {openGroupId && groupDetail && (
        <Modal onClose={() => setOpenGroupId(null)}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-gray-800">{groupDetail.name}</h2>
              <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${GROUP_KIND_STYLE[groupDetail.kind]}`}>
                {GROUP_KIND_LABEL[groupDetail.kind]}
              </span>
            </div>
          </div>
          {groupDetail.description && <p className="mt-1.5 text-xs text-gray-500">{groupDetail.description}</p>}
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {groupDetail.members.map((m) => (
              <li key={m.actorId} className="flex items-center justify-between text-xs">
                <span className="text-gray-700">{m.name} <span className="text-gray-400">· {m.kind}{m.status === 'invited' ? ' · invited' : ''}</span></span>
                {groupDetail.isOwner && m.actorId !== groupDetail.ownerActorId && (
                  <button onClick={() => groupMemberAction('remove', m.actorId)} className="text-gray-300 hover:text-[#B00000]">Remove</button>
                )}
              </li>
            ))}
          </ul>
          {groupDetail.isOwner && (
            <div className="mt-2 flex gap-1.5">
              <select value={addMemberActorId} onChange={(e) => setAddMemberActorId(e.target.value)} className="flex-1 rounded-lg border border-gray-300 bg-white p-1.5 text-xs">
                <option value="">Add a connection…</option>
                {connections.filter((c) => !groupDetail.members.some((m) => m.actorId === c.otherActorId)).map((c) => (
                  <option key={c.otherActorId} value={c.otherActorId}>{c.otherName}</option>
                ))}
              </select>
              <button onClick={() => groupMemberAction('add', addMemberActorId)} disabled={!addMemberActorId || busy}
                className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
                Invite
              </button>
            </div>
          )}
          <div className="mt-2 flex gap-1.5">
            <button onClick={() => groupMemberAction('leave')} disabled={busy} className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600">Leave group</button>
            <button onClick={() => setOpenGroupId(null)} className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600">Close</button>
          </div>
        </Modal>
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
                {i.contextRef && <p className="text-[11px] text-gray-400">{i.contextRef}</p>}
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

      <Card title={`Groups (${groups.length})`} right={
        <button onClick={() => setCreatingGroup(true)} className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">
          + New group
        </button>
      }>
        {groups.length === 0 ? (
          <p className="text-sm text-gray-400">No groups yet.</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-gray-100 p-2.5 hover:bg-gray-50"
                onClick={() => setOpenGroupId(g.id)}>
                <div>
                  <p className="text-sm font-medium text-gray-800">{g.name}</p>
                  <span className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${GROUP_KIND_STYLE[g.kind]}`}>
                    {GROUP_KIND_LABEL[g.kind]}
                  </span>
                </div>
                <span className="shrink-0 text-[11px] text-gray-400">{g.memberCount} member{g.memberCount === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Suggestions">
        {state.myActorKind === 'founder' && !state.discoverable && (
          <div className="mb-3 space-y-2 border-b border-gray-100 pb-3">
            <p className="text-sm text-gray-600">
              Turn this on to see founders who share an investor with you, and let them discover you the same way.
            </p>
            <p className="text-[11px] text-gray-400">
              Only the fact that you share an investor is ever shown — never pipeline stages, counts, or anything else about your fundraise.
            </p>
            <Toggle checked={false} onChange={(v) => { updateOrg({ network_discoverable: v }); window.setTimeout(load, 400); }}
              label={<span className="text-xs text-gray-600">Let founders who share an investor with me discover me</span>} />
          </div>
        )}
        {suggestions.length === 0 ? (
          <p className="text-sm text-gray-400">No suggestions right now — none of your invested investors or groups overlap with another connectable actor yet.</p>
        ) : (
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={s.actorId} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2.5">
                <div>
                  <p className="text-sm font-medium text-gray-800">{s.name}</p>
                  {s.reasons.map((r) => <p key={r.kind} className="text-[11px] text-gray-400">{r.label}</p>)}
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
    </div>
  );
}
