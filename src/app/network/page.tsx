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
import { FollowOnBadge } from '@/components/FollowOnBadge';
import type { FollowOnPayload } from '@/lib/network';
import { ALL_SECTOR_NAMES } from '@/lib/sector-taxonomy';

interface ConnectionView { id: string; otherActorId: string; otherName: string; otherKind: 'founder' | 'investor'; originContext: string | null; createdAt: string }
interface InviteReceivedView { id: string; fromName: string; fromKind: 'founder' | 'investor'; contextRef: string | null; message: string; expiresAt: string }
interface InviteSentView { id: string; toName: string; toKind: 'founder' | 'investor'; status: 'pending' | 'accepted' | 'declined' | 'expired'; expiresAt: string }
interface SuggestionReason { kind: 'shared_investor' | 'shared_group'; label: string }
interface SuggestionView { actorId: string; name: string; reasons: SuggestionReason[] }
interface GroupListView { id: string; name: string; description: string | null; kind: 'accelerator_batch' | 'investor_portfolio' | 'topic'; memberCount: number; isOwner: boolean }
interface GroupMemberDetailView { actorId: string; status: 'invited' | 'active' | 'left'; name: string; kind: 'founder' | 'investor' }
interface GroupDetailView { id: string; name: string; description: string | null; kind: GroupListView['kind']; isOwner: boolean; ownerActorId: string; members: GroupMemberDetailView[] }

// Prompt 318 — referrals.
type ReferralState = 'pending_referred_consent' | 'pending_target_decision' | 'accepted' | 'declined_by_referred' | 'declined_by_target' | 'expired';
interface ReferralView {
  id: string; referrerActorId: string; referredOrgId: string; targetActorId: string; message: string;
  effectiveState: ReferralState; referrerName: string; targetName: string;
  isMineAsReferrer: boolean; isMineAsTarget: boolean; isMineAsReferred: boolean;
  followOn: FollowOnPayload;
}

// Prompt 319 — follow-on signals.
interface FollowOnStatusView { investorCatalogEntityId: string; investorName: string; active: boolean; visibility: 'named' | 'anonymous' | null; signaledAt: string | null; expiresAt: string | null }
interface FollowOnRelationshipView { orgId: string; orgName: string; investorCatalogEntityId: string; hasActiveSignal: boolean; visibility: 'named' | 'anonymous' | null }
interface FollowOnRequestView { orgId: string; orgName: string; requestedAt: string }

// Prompt 320 — Pathfinder asks received (someone wants me to refer them).
interface PathfinderAskView { id: string; requesterOrgId: string; requesterName: string; targetActorId: string; targetName: string; requestedAt: string }

// Prompt 321 — posts.
interface UpdateStructuredView { productProgress?: string; customers?: string; team?: string; learnings?: string }
interface PostView {
  id: string; authorActorId: string; authorName: string; body: string; kind: 'freeform' | 'update' | 'milestone';
  structured: UpdateStructuredView | null; target: 'all' | 'group'; groupId: string | null; groupName: string | null; createdAt: string;
}
const POST_KIND_LABEL: Record<PostView['kind'], string> = { freeform: '', update: '📋 Update', milestone: '🎯 Milestone' };

// Prompt 323 — reciprocity.
type OfferKind = 'deck_review' | 'intro' | 'advice' | 'other';
const OFFER_KIND_LABEL: Record<OfferKind, string> = { deck_review: 'Deck review', intro: 'Intros', advice: 'Advice', other: 'Other' };
interface OfferView { id: string; actorId: string; actorName: string; kind: OfferKind; description: string; slotsTotal: number; slotsClaimed: number; expiresAt: string }
interface ScoutRequestView {
  id: string; investorActorId: string; investorName: string; sectors: string[]; stage: string | null; geography: string | null;
  description: string; expiresAt: string; receivedReferrals: number | null;
}
interface ReferralCandidate { actorId: string; orgId: string | null; name: string; kind: 'founder' | 'investor' }
interface ReferralBootstrap {
  ok: boolean; referrals?: ReferralView[]; reputation?: { sent: number; accepted: number };
  eligibility?: { referredCandidates: ReferralCandidate[]; targetCandidates: ReferralCandidate[] };
}
const REFERRAL_STATE_LABEL: Record<ReferralState, string> = {
  pending_referred_consent: 'Waiting for their consent to be shared',
  pending_target_decision: 'Waiting for the investor to decide',
  accepted: 'Accepted', declined_by_referred: 'Declined (by the startup)', declined_by_target: 'Declined',
  expired: 'Expired',
};

interface NetworkBootstrap {
  available: boolean;
  myActorId?: string;
  myActorKind?: 'founder' | 'investor';
  discoverable?: boolean;
  connections?: ConnectionView[];
  invitesReceived?: InviteReceivedView[];
  invitesSent?: InviteSentView[];
  pendingSentCount?: number;
  suggestions?: SuggestionView[];
  reciprocity?: { officeHoursOffered: number; startupsReferredViaScout: number };
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
  const [referralData, setReferralData] = useState<ReferralBootstrap | null>(null);
  const [referralDraft, setReferralDraft] = useState<{ referredOrgId: string; targetActorId: string; message: string } | null>(null);
  const [founderSignals, setFounderSignals] = useState<FollowOnStatusView[] | null>(null);
  const [investorFollowOn, setInvestorFollowOn] = useState<{ relationships: FollowOnRelationshipView[]; requests: FollowOnRequestView[] } | null>(null);
  const [pathfinderAsks, setPathfinderAsks] = useState<PathfinderAskView[]>([]);
  const [posts, setPosts] = useState<PostView[] | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerKind, setComposerKind] = useState<'freeform' | 'update'>('freeform');
  const [composerBody, setComposerBody] = useState('');
  const [composerStructured, setComposerStructured] = useState<UpdateStructuredView>({});
  const [composerTarget, setComposerTarget] = useState<'all' | 'group'>('all');
  const [composerGroupId, setComposerGroupId] = useState('');
  const [milestoneAvailable, setMilestoneAvailable] = useState(false);
  const [updateGap, setUpdateGap] = useState<{ shouldNudge: boolean; daysSince: number | null } | null>(null);
  const [offers, setOffers] = useState<OfferView[]>([]);
  const [offerComposerOpen, setOfferComposerOpen] = useState(false);
  const [offerDraft, setOfferDraft] = useState<{ kind: OfferKind; description: string; slotsTotal: number; expiresInDays: number }>({
    kind: 'advice', description: '', slotsTotal: 3, expiresInDays: 7,
  });
  const [claimNoteFor, setClaimNoteFor] = useState<string | null>(null);
  const [claimNote, setClaimNote] = useState('');
  const [scoutRequests, setScoutRequests] = useState<ScoutRequestView[]>([]);
  const [scoutComposerOpen, setScoutComposerOpen] = useState(false);
  const [scoutDraft, setScoutDraft] = useState<{ sectors: Set<string>; stage: string; geography: string; description: string; expiresInDays: number }>({
    sectors: new Set(), stage: '', geography: '', description: '', expiresInDays: 14,
  });
  const [scoutReferDraft, setScoutReferDraft] = useState<{ scoutRequestId: string; referredActorId: string; message: string } | null>(null);
  const [excludingOpen, setExcludingOpen] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [composerError, setComposerError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ postId?: string; reportedActorId?: string } | null>(null);
  const [reportReason, setReportReason] = useState('');

  function load() {
    fetch('/api/network').then((r) => r.json()).then(setState).catch(() => setState(null));
    fetch('/api/network/group').then((r) => r.json()).then((b) => setGroups(b.groups ?? [])).catch(() => setGroups([]));
    fetch('/api/network/referral').then((r) => r.json()).then(setReferralData).catch(() => setReferralData(null));
    fetch('/api/network/followon').then((r) => r.json()).then((b) => setFounderSignals(b.signals ?? null)).catch(() => setFounderSignals(null));
    fetch('/api/network/followon/investor').then((r) => r.json())
      .then((b) => setInvestorFollowOn(b.ok ? { relationships: b.relationships ?? [], requests: b.requests ?? [] } : null))
      .catch(() => setInvestorFollowOn(null));
    fetch('/api/network/pathfinder/asks').then((r) => r.json()).then((b) => setPathfinderAsks(b.asks ?? [])).catch(() => setPathfinderAsks([]));
    fetch('/api/network/post').then((r) => r.json()).then((b) => setPosts(b.posts ?? null)).catch(() => setPosts(null));
    fetch('/api/network/milestone').then((r) => r.json()).then((b) => setMilestoneAvailable(!!b.available)).catch(() => setMilestoneAvailable(false));
    fetch('/api/network/update-gap').then((r) => r.json()).then((b) => setUpdateGap(b.ok ? { shouldNudge: b.shouldNudge, daysSince: b.daysSince } : null)).catch(() => setUpdateGap(null));
    fetch('/api/network/offer').then((r) => r.json()).then((b) => setOffers(b.offers ?? [])).catch(() => setOffers([]));
    fetch('/api/network/scout').then((r) => r.json()).then((b) => setScoutRequests(b.requests ?? [])).catch(() => setScoutRequests([]));
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

  function respondToReferral(id: string, as: 'referred' | 'target', action: 'accept' | 'decline') {
    setBusy(true); setError(null);
    fetch('/api/network/referral/respond', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ referralId: id, as, action }),
    }).then((r) => r.json()).then((b) => { if (!b.ok) setError(b.error); load(); }).finally(() => setBusy(false));
  }

  function sendReferral() {
    if (!referralDraft || !referralDraft.referredOrgId || !referralDraft.targetActorId || !referralDraft.message.trim()) return;
    setBusy(true); setError(null);
    fetch('/api/network/referral', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ referredOrgId: referralDraft.referredOrgId, targetActorId: referralDraft.targetActorId, message: referralDraft.message.trim() }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error); return; }
      setReferralDraft(null); load();
    }).finally(() => setBusy(false));
  }

  function followOnAction(orgId: string, action: 'signal' | 'change_visibility' | 'revoke' | 'dismiss_request', visibility?: 'named' | 'anonymous') {
    setBusy(true); setError(null);
    fetch('/api/network/followon/investor', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId, action, visibility }),
    }).then((r) => r.json()).then((b) => { if (!b.ok) setError(b.error); load(); }).finally(() => setBusy(false));
  }

  function dismissPathfinderAsk(id: string) {
    setBusy(true); setError(null);
    fetch('/api/network/pathfinder/asks', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
    }).then((r) => r.json()).then((b) => { if (!b.ok) setError(b.error); load(); }).finally(() => setBusy(false));
  }

  function canSubmitPost() {
    if (composerTarget === 'group' && !composerGroupId) return false;
    if (composerKind === 'update') return Object.values(composerStructured).some((v) => v?.trim());
    return !!composerBody.trim();
  }

  function submitPost() {
    if (!canSubmitPost()) return;
    setBusy(true); setComposerError(null);
    fetch('/api/network/post', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: composerKind,
        body: composerKind === 'freeform' ? composerBody.trim() : undefined,
        structured: composerKind === 'update' ? composerStructured : undefined,
        target: composerTarget,
        groupId: composerTarget === 'group' ? composerGroupId : undefined,
        excludedActorIds: composerTarget === 'all' ? [...excludedIds] : undefined,
      }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setComposerError(b.error); return; }
      setComposerOpen(false); setComposerKind('freeform'); setComposerBody(''); setComposerStructured({});
      setComposerTarget('all'); setComposerGroupId(''); setExcludedIds(new Set());
      load();
    }).finally(() => setBusy(false));
  }

  function submitMilestone() {
    setBusy(true); setError(null);
    fetch('/api/network/milestone', { method: 'POST' })
      .then((r) => r.json()).then((b) => { if (!b.ok) setError(b.error); load(); }).finally(() => setBusy(false));
  }

  function submitOffer() {
    if (!offerDraft.description.trim()) return;
    setBusy(true); setError(null);
    const expiresAt = new Date(Date.now() + offerDraft.expiresInDays * 86_400_000).toISOString();
    fetch('/api/network/offer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: offerDraft.kind, description: offerDraft.description.trim(), slotsTotal: offerDraft.slotsTotal, expiresAt }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error); return; }
      setOfferComposerOpen(false); setOfferDraft({ kind: 'advice', description: '', slotsTotal: 3, expiresInDays: 7 });
      load();
    }).finally(() => setBusy(false));
  }

  function claimSlot(offerId: string) {
    setBusy(true); setError(null);
    fetch('/api/network/offer/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offerId, note: claimNote.trim() || undefined }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error); return; }
      setClaimNoteFor(null); setClaimNote(''); load();
    }).finally(() => setBusy(false));
  }

  function submitScoutRequest() {
    if (!scoutDraft.description.trim()) return;
    setBusy(true); setError(null);
    const expiresAt = new Date(Date.now() + scoutDraft.expiresInDays * 86_400_000).toISOString();
    fetch('/api/network/scout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sectors: [...scoutDraft.sectors], stage: scoutDraft.stage || undefined, geography: scoutDraft.geography.trim() || undefined,
        description: scoutDraft.description.trim(), expiresAt,
      }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error); return; }
      setScoutComposerOpen(false); setScoutDraft({ sectors: new Set(), stage: '', geography: '', description: '', expiresInDays: 14 });
      load();
    }).finally(() => setBusy(false));
  }

  function closeScoutRequest(requestId: string) {
    setBusy(true); setError(null);
    fetch('/api/network/scout', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId }),
    }).then((r) => r.json()).then((b) => { if (!b.ok) setError(b.error); load(); }).finally(() => setBusy(false));
  }

  function submitScoutReferral() {
    if (!scoutReferDraft || !scoutReferDraft.referredActorId || !scoutReferDraft.message.trim()) return;
    setBusy(true); setError(null);
    fetch('/api/network/scout/refer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scoutRequestId: scoutReferDraft.scoutRequestId, referredActorId: scoutReferDraft.referredActorId, message: scoutReferDraft.message.trim() }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error); return; }
      setScoutReferDraft(null); load();
    }).finally(() => setBusy(false));
  }

  function removePost(postId: string) {
    setBusy(true); setError(null);
    fetch(`/api/network/post?postId=${postId}`, { method: 'DELETE' })
      .then((r) => r.json()).then((b) => { if (!b.ok) setError(b.error); load(); }).finally(() => setBusy(false));
  }

  function submitReport() {
    if (!reportTarget || !reportReason.trim()) return;
    setBusy(true); setError(null);
    fetch('/api/network/report', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...reportTarget, reason: reportReason.trim() }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error); return; }
      setReportTarget(null); setReportReason('');
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
        {state.reciprocity && (
          <p className="mt-1 text-[11px] text-gray-400">
            {state.reciprocity.officeHoursOffered} office hours offered · {state.reciprocity.startupsReferredViaScout} startups referred through scout requests
          </p>
        )}
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

      {referralDraft && (
        <Modal onClose={() => setReferralDraft(null)}>
          <h2 className="text-sm font-bold text-gray-800">Refer to an investor</h2>
          <p className="mt-1 text-[11px] text-gray-400">
            {state.myActorKind === 'founder'
              ? 'They’ll be asked to consent before the investor sees anything.'
              : 'The startup gets to decide whether the investor even hears about this, before anything is shared.'}
          </p>
          <div className="mt-2 space-y-2">
            <select value={referralDraft.referredOrgId} onChange={(e) => setReferralDraft((d) => d && ({ ...d, referredOrgId: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm">
              <option value="">{state.myActorKind === 'founder' ? 'Which of your contacts…' : 'Which of your portfolio startups…'}</option>
              {(referralData?.eligibility?.referredCandidates ?? []).map((c) => (
                <option key={c.actorId} value={c.orgId ?? ''}>{c.name}</option>
              ))}
            </select>
            <select value={referralDraft.targetActorId} onChange={(e) => setReferralDraft((d) => d && ({ ...d, targetActorId: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm">
              <option value="">…to which investor?</option>
              {(referralData?.eligibility?.targetCandidates ?? []).map((c) => (
                <option key={c.actorId} value={c.actorId}>{c.name}</option>
              ))}
            </select>
            <textarea value={referralDraft.message} onChange={(e) => setReferralDraft((d) => d && ({ ...d, message: e.target.value }))}
              rows={3} placeholder="Why this intro? (required)" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
            <p className="text-[11px] text-gray-400">{referralData?.reputation?.sent ?? 0}/5 referrals used this month.</p>
          </div>
          <div className="mt-2 flex gap-1.5">
            <button onClick={sendReferral}
              disabled={busy || !referralDraft.referredOrgId || !referralDraft.targetActorId || !referralDraft.message.trim() || (referralData?.reputation?.sent ?? 0) >= 5}
              className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
              Send referral
            </button>
            <button onClick={() => setReferralDraft(null)} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
          </div>
        </Modal>
      )}

      {composerOpen && (
        <Modal onClose={() => setComposerOpen(false)}>
          <h2 className="text-sm font-bold text-gray-800">New post</h2>
          <div className="mt-1.5 flex gap-1.5">
            <button onClick={() => setComposerKind('freeform')}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${composerKind === 'freeform' ? 'bg-[#0E7490] text-white' : 'border border-gray-300 text-gray-600'}`}>
              Free text
            </button>
            <button onClick={() => setComposerKind('update')}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${composerKind === 'update' ? 'bg-[#0E7490] text-white' : 'border border-gray-300 text-gray-600'}`}>
              📋 Structured update
            </button>
          </div>

          {composerKind === 'freeform' ? (
            <textarea value={composerBody} onChange={(e) => { setComposerBody(e.target.value); setComposerError(null); }} rows={4} autoFocus
              placeholder="Share something that helps other founders/investors raise — never sales, partnerships, or prospecting."
              className="mt-2 w-full rounded-lg border border-gray-300 p-2 text-sm" />
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-gray-400">All optional — fill in whichever sections apply. No round/funding field, on purpose.</p>
              {([
                ['productProgress', 'Product'], ['customers', 'Customers'], ['team', 'Team'], ['learnings', 'Learnings'],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="text-[11px] font-medium text-gray-500">{label}</label>
                  <textarea value={composerStructured[key] ?? ''} rows={2}
                    onChange={(e) => { setComposerStructured((s) => ({ ...s, [key]: e.target.value })); setComposerError(null); }}
                    className="mt-0.5 w-full rounded-lg border border-gray-300 p-1.5 text-sm" />
                </div>
              ))}
            </div>
          )}
          {composerError && <p className="mt-1 text-xs font-medium text-[#B00000]">{composerError}</p>}

          <div className="mt-2 flex items-center gap-2">
            <select value={composerTarget} onChange={(e) => setComposerTarget(e.target.value as 'all' | 'group')}
              className="rounded-lg border border-gray-300 bg-white p-1.5 text-xs">
              <option value="all">Everyone (your connections)</option>
              {groups.length > 0 && <option value="group">A specific group…</option>}
            </select>
            {composerTarget === 'group' && (
              <select value={composerGroupId} onChange={(e) => setComposerGroupId(e.target.value)} className="rounded-lg border border-gray-300 bg-white p-1.5 text-xs">
                <option value="">Which group?</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
            {composerTarget === 'all' && connections.length > 0 && (
              <button onClick={() => setExcludingOpen(true)} className="text-[11px] text-gray-400 underline hover:text-gray-600">
                exclude some connections{excludedIds.size > 0 ? ` (${excludedIds.size})` : ''}
              </button>
            )}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button onClick={submitPost} disabled={busy || !canSubmitPost()}
              className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
              Post
            </button>
            <button onClick={() => setComposerOpen(false)} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
          </div>
        </Modal>
      )}

      {excludingOpen && (
        <Modal onClose={() => setExcludingOpen(false)}>
          <h2 className="text-sm font-bold text-gray-800">Exclude some connections</h2>
          <p className="mt-1 text-[11px] text-gray-400">Unchecked connections won&apos;t see this post.</p>
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {connections.map((c) => (
              <label key={c.otherActorId} className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="checkbox" checked={!excludedIds.has(c.otherActorId)}
                  onChange={(e) => setExcludedIds((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.delete(c.otherActorId); else next.add(c.otherActorId);
                    return next;
                  })} />
                {c.otherName}
              </label>
            ))}
          </div>
          <button onClick={() => setExcludingOpen(false)} className="mt-2 rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Done</button>
        </Modal>
      )}

      {reportTarget && (
        <Modal onClose={() => setReportTarget(null)}>
          <h2 className="text-sm font-bold text-gray-800">Report</h2>
          <p className="mt-1 text-[11px] text-gray-400">This goes to our support team for review — never shown to anyone else.</p>
          <textarea value={reportReason} onChange={(e) => setReportReason(e.target.value)} rows={3} autoFocus
            placeholder="What's wrong with this?" className="mt-2 w-full rounded-lg border border-gray-300 p-2 text-sm" />
          <div className="mt-2 flex gap-1.5">
            <button onClick={submitReport} disabled={busy || !reportReason.trim()}
              className="rounded-full bg-[#B00000] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
              Send report
            </button>
            <button onClick={() => setReportTarget(null)} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
          </div>
        </Modal>
      )}

      {offerComposerOpen && (
        <Modal onClose={() => setOfferComposerOpen(false)}>
          <h2 className="text-sm font-bold text-gray-800">Offer office hours</h2>
          <p className="mt-1 text-[11px] text-gray-400">Concrete, time-limited help — visible to your connections only.</p>
          <div className="mt-2 space-y-2">
            <select value={offerDraft.kind} onChange={(e) => setOfferDraft((d) => ({ ...d, kind: e.target.value as OfferKind }))}
              className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm">
              {(Object.keys(OFFER_KIND_LABEL) as OfferKind[]).map((k) => <option key={k} value={k}>{OFFER_KIND_LABEL[k]}</option>)}
            </select>
            <textarea value={offerDraft.description} onChange={(e) => setOfferDraft((d) => ({ ...d, description: e.target.value }))}
              rows={2} placeholder="e.g. This week I'll review 3 decks" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500">Slots
                <input type="number" min={1} max={20} value={offerDraft.slotsTotal}
                  onChange={(e) => setOfferDraft((d) => ({ ...d, slotsTotal: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))}
                  className="ml-1.5 w-14 rounded border border-gray-300 px-1.5 py-1 text-xs" />
              </label>
              <label className="text-xs text-gray-500">Expires in
                <input type="number" min={1} max={60} value={offerDraft.expiresInDays}
                  onChange={(e) => setOfferDraft((d) => ({ ...d, expiresInDays: Math.max(1, Number(e.target.value) || 1) }))}
                  className="ml-1.5 w-14 rounded border border-gray-300 px-1.5 py-1 text-xs" /> days
              </label>
            </div>
          </div>
          <div className="mt-2 flex gap-1.5">
            <button onClick={submitOffer} disabled={busy || !offerDraft.description.trim()}
              className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
              Publish
            </button>
            <button onClick={() => setOfferComposerOpen(false)} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
          </div>
        </Modal>
      )}

      {claimNoteFor && (
        <Modal onClose={() => { setClaimNoteFor(null); setClaimNote(''); }}>
          <h2 className="text-sm font-bold text-gray-800">Claim a slot</h2>
          <textarea value={claimNote} onChange={(e) => setClaimNote(e.target.value)} rows={2} autoFocus
            placeholder="Optional note — e.g. what you'd like help with" className="mt-2 w-full rounded-lg border border-gray-300 p-2 text-sm" />
          <div className="mt-2 flex gap-1.5">
            <button onClick={() => claimSlot(claimNoteFor)} disabled={busy}
              className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
              Claim
            </button>
            <button onClick={() => { setClaimNoteFor(null); setClaimNote(''); }} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
          </div>
        </Modal>
      )}

      {scoutComposerOpen && (
        <Modal onClose={() => setScoutComposerOpen(false)}>
          <h2 className="text-sm font-bold text-gray-800">Scout for a startup</h2>
          <p className="mt-1 text-[11px] text-gray-400">Visible to your connections only — founders can refer a startup they know.</p>
          <div className="mt-2 space-y-2">
            <div className="max-h-28 overflow-y-auto rounded-lg border border-gray-200 p-1.5">
              {ALL_SECTOR_NAMES.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-xs text-gray-700">
                  <input type="checkbox" checked={scoutDraft.sectors.has(s)}
                    onChange={(e) => setScoutDraft((d) => {
                      const next = new Set(d.sectors);
                      if (e.target.checked) next.add(s); else next.delete(s);
                      return { ...d, sectors: next };
                    })} />
                  {s}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={scoutDraft.stage} onChange={(e) => setScoutDraft((d) => ({ ...d, stage: e.target.value }))}
                placeholder="Stage (e.g. pre-seed)" className="w-1/2 rounded-lg border border-gray-300 p-2 text-sm" />
              <input value={scoutDraft.geography} onChange={(e) => setScoutDraft((d) => ({ ...d, geography: e.target.value }))}
                placeholder="Geography (e.g. Portugal)" className="w-1/2 rounded-lg border border-gray-300 p-2 text-sm" />
            </div>
            <textarea value={scoutDraft.description} onChange={(e) => setScoutDraft((d) => ({ ...d, description: e.target.value }))}
              rows={2} placeholder="What are you looking for?" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
            <label className="text-xs text-gray-500">Expires in
              <input type="number" min={1} max={90} value={scoutDraft.expiresInDays}
                onChange={(e) => setScoutDraft((d) => ({ ...d, expiresInDays: Math.max(1, Number(e.target.value) || 1) }))}
                className="ml-1.5 w-14 rounded border border-gray-300 px-1.5 py-1 text-xs" /> days
            </label>
          </div>
          <div className="mt-2 flex gap-1.5">
            <button onClick={submitScoutRequest} disabled={busy || !scoutDraft.description.trim()}
              className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
              Publish
            </button>
            <button onClick={() => setScoutComposerOpen(false)} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
          </div>
        </Modal>
      )}

      {scoutReferDraft && (
        <Modal onClose={() => setScoutReferDraft(null)}>
          <h2 className="text-sm font-bold text-gray-800">Refer a startup</h2>
          <p className="mt-1 text-[11px] text-gray-400">Must be one of your own active connections.</p>
          <div className="mt-2 space-y-2">
            <select value={scoutReferDraft.referredActorId} onChange={(e) => setScoutReferDraft((d) => d && ({ ...d, referredActorId: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm">
              <option value="">Which of your connections?</option>
              {connections.filter((c) => c.otherKind === 'founder').map((c) => <option key={c.otherActorId} value={c.otherActorId}>{c.otherName}</option>)}
            </select>
            <textarea value={scoutReferDraft.message} onChange={(e) => setScoutReferDraft((d) => d && ({ ...d, message: e.target.value }))}
              rows={3} placeholder="Why this startup? (required)" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
          </div>
          <div className="mt-2 flex gap-1.5">
            <button onClick={submitScoutReferral} disabled={busy || !scoutReferDraft.referredActorId || !scoutReferDraft.message.trim()}
              className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
              Send referral
            </button>
            <button onClick={() => setScoutReferDraft(null)} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
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

      <Card title="Feed" right={
        <div className="flex items-center gap-1.5">
          {milestoneAvailable && (
            <button onClick={submitMilestone} disabled={busy}
              className="rounded-full border border-emerald-300 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50">
              🎯 Share a round milestone
            </button>
          )}
          <button onClick={() => setComposerOpen(true)} className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">
            + New post
          </button>
        </div>
      }>
        {/* Prompt 322 Pedido B — private to the founder alone, never shown
            to anyone else, never a countdown or alarming tone (same as
            outreach's own follow-up nudges). */}
        {updateGap?.shouldNudge && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-[#E8F4F8] p-2">
            <p className="text-xs text-[#0E7490]">It&apos;s been {updateGap.daysSince} days since your last update to your network.</p>
            <button onClick={() => { setComposerKind('update'); setComposerOpen(true); }} className="shrink-0 text-[11px] font-semibold text-[#0E7490] underline">
              Post one
            </button>
          </div>
        )}
        {!posts || posts.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing here yet — posts from you, your connections, and your groups will show up here.</p>
        ) : (
          <ul className="space-y-2">
            {posts.map((p) => (
              <li key={p.id} className="rounded-lg border border-gray-100 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-800">
                    {p.authorName} {p.groupName && <span className="text-[11px] font-normal text-gray-400">· {p.groupName}</span>}
                    {POST_KIND_LABEL[p.kind] && (
                      <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{POST_KIND_LABEL[p.kind]}</span>
                    )}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] text-gray-400">{p.createdAt.slice(0, 10)}</span>
                    {p.authorActorId === state.myActorId ? (
                      <button onClick={() => removePost(p.id)} disabled={busy} className="text-[11px] text-gray-300 hover:text-[#B00000]">Delete</button>
                    ) : (
                      <button onClick={() => setReportTarget({ postId: p.id })} className="text-[11px] text-gray-300 hover:text-[#B00000]">Report</button>
                    )}
                  </div>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{p.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Office hours (${offers.length})`} right={
        <button onClick={() => setOfferComposerOpen(true)} className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">
          + Offer office hours
        </button>
      }>
        {offers.length === 0 ? (
          <p className="text-sm text-gray-400">No office hours offered right now — concrete, time-limited help from your connections shows up here.</p>
        ) : (
          <ul className="space-y-2">
            {offers.map((o) => (
              <li key={o.id} className="rounded-lg border border-gray-100 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {o.actorName} <span className="text-[11px] font-normal text-gray-400">· {OFFER_KIND_LABEL[o.kind]}</span>
                    </p>
                    <p className="mt-1 text-sm text-gray-700">{o.description}</p>
                    <p className="mt-1 text-[11px] text-gray-400">{o.slotsTotal - o.slotsClaimed} of {o.slotsTotal} slots left · expires {o.expiresAt.slice(0, 10)}</p>
                  </div>
                  {o.actorId !== state.myActorId && (
                    <button onClick={() => setClaimNoteFor(o.id)} className="shrink-0 rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">
                      Claim a slot
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Scout requests (${scoutRequests.length})`} right={
        state.myActorKind === 'investor' && (
          <button onClick={() => setScoutComposerOpen(true)} className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">
            + New scout request
          </button>
        )
      }>
        {scoutRequests.length === 0 ? (
          <p className="text-sm text-gray-400">No open scout requests right now.</p>
        ) : (
          <ul className="space-y-2">
            {scoutRequests.map((r) => (
              <li key={r.id} className="rounded-lg border border-gray-100 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{r.investorName}</p>
                    <p className="mt-1 text-sm text-gray-700">{r.description}</p>
                    <p className="mt-1 text-[11px] text-gray-400">
                      {[...r.sectors].join(', ') || 'Any sector'}{r.stage ? ` · ${r.stage}` : ''}{r.geography ? ` · ${r.geography}` : ''} · expires {r.expiresAt.slice(0, 10)}
                    </p>
                    {r.receivedReferrals != null && <p className="mt-1 text-[11px] text-gray-400">{r.receivedReferrals} referral{r.receivedReferrals === 1 ? '' : 's'} received through this request</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {r.investorActorId !== state.myActorId && (
                      <button onClick={() => setScoutReferDraft({ scoutRequestId: r.id, referredActorId: '', message: '' })}
                        className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">
                        Refer a startup
                      </button>
                    )}
                    {r.investorActorId === state.myActorId && (
                      <button onClick={() => closeScoutRequest(r.id)} disabled={busy} className="text-[11px] text-gray-400 hover:text-[#B00000]">Close</button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

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
                    <button onClick={() => setReportTarget({ reportedActorId: c.otherActorId })} className="text-[11px] text-gray-300 hover:text-[#B00000]">Report</button>
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

      {pathfinderAsks.length > 0 && (
        <Card title={`Pathfinder — asked to refer someone (${pathfinderAsks.length})`}>
          <ul className="space-y-2">
            {pathfinderAsks.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2.5">
                <span className="text-sm text-gray-700">{a.requesterName} would like an intro to {a.targetName}</span>
                <div className="flex shrink-0 gap-1.5">
                  <button onClick={() => { setReferralDraft({ referredOrgId: a.requesterOrgId, targetActorId: a.targetActorId, message: '' }); dismissPathfinderAsk(a.id); }}
                    className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">
                    Compose referral
                  </button>
                  <button onClick={() => dismissPathfinderAsk(a.id)} disabled={busy}
                    className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600">Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Referrals${referralData?.reputation ? ` (${referralData.reputation.sent}/5 sent this month, ${referralData.reputation.accepted} accepted)` : ''}`} right={
        <button onClick={() => setReferralDraft({ referredOrgId: '', targetActorId: '', message: '' })}
          disabled={!referralData?.eligibility?.referredCandidates.length || !referralData?.eligibility?.targetCandidates.length}
          className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
          + Refer to an investor
        </button>
      }>
        {(() => {
          const referrals = referralData?.referrals ?? [];
          const needsMyConsent = referrals.filter((r) => r.isMineAsReferred && r.effectiveState === 'pending_referred_consent');
          const rest = referrals.filter((r) => !(r.isMineAsReferred && r.effectiveState === 'pending_referred_consent'));
          return (
            <div className="space-y-3">
              {needsMyConsent.length > 0 && (
                <div className="space-y-2 border-b border-gray-100 pb-3">
                  <p className="text-[11px] font-medium text-gray-500">Waiting on you to decide what gets shared</p>
                  {needsMyConsent.map((r) => (
                    <div key={r.id} className="rounded-lg border border-gray-100 p-2.5">
                      <p className="text-sm text-gray-800">{r.referrerName} wants to refer you to {r.targetName}</p>
                      <p className="mt-1 text-xs italic text-gray-600">&ldquo;{r.message}&rdquo;</p>
                      <p className="mt-1 text-[11px] text-gray-400">
                        If you accept, {r.targetName} will see this referral (with {r.referrerName}&apos;s note) — nothing is shared until then.
                      </p>
                      <div className="mt-1.5 flex gap-1.5">
                        <button onClick={() => respondToReferral(r.id, 'referred', 'accept')} disabled={busy}
                          className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">Let it be shared</button>
                        <button onClick={() => respondToReferral(r.id, 'referred', 'decline')} disabled={busy}
                          className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600">Decline</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {rest.length === 0 && needsMyConsent.length === 0 ? (
                <p className="text-sm text-gray-400">No referrals yet.</p>
              ) : (
                <ul className="space-y-2">
                  {rest.map((r) => (
                    <li key={r.id} className="rounded-lg border border-gray-100 p-2.5">
                      <p className="text-sm text-gray-800">
                        {r.isMineAsTarget ? `${r.referrerName} referred you a startup` : `${r.referrerName} → ${r.targetName}`}
                      </p>
                      {r.followOn.active && <div className="mt-1"><FollowOnBadge signal={r.followOn} /></div>}
                      {r.isMineAsTarget && <p className="mt-1 text-xs italic text-gray-600">&ldquo;{r.message}&rdquo;</p>}
                      <p className="mt-1 text-[11px] text-gray-400">{REFERRAL_STATE_LABEL[r.effectiveState]}</p>
                      {r.isMineAsTarget && r.effectiveState === 'pending_target_decision' && (
                        <div className="mt-1.5 flex gap-1.5">
                          <button onClick={() => respondToReferral(r.id, 'target', 'accept')} disabled={busy}
                            className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">Accept</button>
                          <button onClick={() => respondToReferral(r.id, 'target', 'decline')} disabled={busy}
                            className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600">Decline</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })()}
      </Card>

      {state.myActorKind === 'founder' && founderSignals && (
        <Card title={`Follow-on interest received (${founderSignals.filter((s) => s.active).length})`}>
          {founderSignals.filter((s) => s.active).length === 0 ? (
            <p className="text-sm text-gray-400">No investor has signaled follow-on interest yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {founderSignals.filter((s) => s.active).map((s) => (
                <li key={s.investorCatalogEntityId} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{s.investorName}</span>
                  <span className="text-[11px] text-gray-400">{s.visibility === 'anonymous' ? 'shown anonymously to others' : 'shown by name to others'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {state.myActorKind === 'investor' && investorFollowOn && (
        <Card title="Follow-on interest">
          {investorFollowOn.requests.length > 0 && (
            <div className="mb-3 space-y-2 border-b border-gray-100 pb-3">
              <p className="text-[11px] font-medium text-gray-500">Startups asking whether you&apos;d consider a follow-on</p>
              {investorFollowOn.requests.map((req) => (
                <div key={req.orgId} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2.5">
                  <span className="text-sm text-gray-700">{req.orgName}</span>
                  <div className="flex shrink-0 gap-1.5">
                    <button onClick={() => followOnAction(req.orgId, 'signal', 'named')} disabled={busy}
                      className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">Signal interest</button>
                    <button onClick={() => followOnAction(req.orgId, 'dismiss_request')} disabled={busy}
                      className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600">Dismiss</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {investorFollowOn.relationships.length === 0 ? (
            <p className="text-sm text-gray-400">No verified invested relationships yet.</p>
          ) : (
            <ul className="space-y-2">
              {investorFollowOn.relationships.map((rel) => (
                <li key={rel.orgId} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2.5">
                  <span className="text-sm text-gray-700">{rel.orgName}</span>
                  {rel.hasActiveSignal ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <select value={rel.visibility ?? 'named'} onChange={(e) => followOnAction(rel.orgId, 'change_visibility', e.target.value as 'named' | 'anonymous')}
                        className="rounded-lg border border-gray-300 bg-white p-1 text-[11px]">
                        <option value="named">Named</option>
                        <option value="anonymous">Anonymous</option>
                      </select>
                      <button onClick={() => followOnAction(rel.orgId, 'signal', rel.visibility ?? 'named')} disabled={busy}
                        className="rounded-full border border-gray-300 px-2 py-1 text-[11px] text-gray-600">Renew</button>
                      <button onClick={() => followOnAction(rel.orgId, 'revoke')} disabled={busy}
                        className="rounded-full border border-gray-300 px-2 py-1 text-[11px] text-gray-600">Revoke</button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 gap-1.5">
                      <button onClick={() => followOnAction(rel.orgId, 'signal', 'named')} disabled={busy}
                        className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">Signal (named)</button>
                      <button onClick={() => followOnAction(rel.orgId, 'signal', 'anonymous')} disabled={busy}
                        className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600">Signal (anonymous)</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

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
