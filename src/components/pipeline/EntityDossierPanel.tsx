'use client';
// Prompt 650/672 (Phase 3) — the investor dossier panel that opens on a
// stationary click in the Pipeline (Prompt 668 already tells that click apart
// from a real drag; this only changes what the click opens). Composes the
// SAME sub-components /entities/[id]/page.tsx already uses and has proven —
// RelationshipSummaryCard, SherlockInsightBanner, EntityPeoplePanel,
// RailLogForm, RecentInteractions, MessageThreadCore, ContributionBox,
// CommunityConsensusPanel — reorganized into the five tabs Nuno specified
// (650 v2 §3, restated definitively in 672), rather than reimplementing any
// of their logic. /entities/[id]/page.tsx itself is untouched: every other
// caller (Today, Tasks, People, catalog) keeps navigating there exactly as
// before. This panel is a second, additional way to reach a dossier — from a
// Pipeline row — never a competing destination for the SAME click (672's own
// warning, after the "Summary" duplication in Prompts 663/667).
//
// Deliberately narrower than the full page: the matchdeal-firm prefill, the
// follow-on ask, and the ?rail=/?ndaDraft= external deep-link prefills are
// specific to the standalone page and its own external callers (Today's
// "Draft this message", the document-request review page, …), which keep
// working unchanged because that page is untouched. Rebuilding those same
// integrations a second time, INTO this panel, was not attempted — flagged in
// the delivery report as a disclosed scope boundary, not hidden.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card, HardFilterBanner, PersonLink, VerBadge, fitLabel, fmtEur } from '@/components/ui';
import { EntityAvatar } from '@/components/EntityAvatar';
import { RelationshipSummaryCard } from '@/components/RelationshipSummaryCard';
import { SherlockInsightBanner } from '@/components/SherlockInsightBanner';
import { RecentInteractions } from '@/components/RecentInteractions';
import { RailLogForm } from '@/components/RailLogForm';
import { MessageThreadCore } from '@/components/MessageThreadCore';
import { PreContactReadinessNudge } from '@/components/PreContactReadinessNudge';
import { ContributionBox } from '@/components/ContributionBox';
import { CommunityConsensusPanel } from '@/components/CommunityConsensusPanel';
import { EntityPeoplePanel } from '@/components/EntityPeoplePanel';
import { QuickCreatePerson } from '@/components/QuickCreatePerson';
import { CompetitorInvestmentCard } from '@/components/CompetitorInvestmentCard';
import { PathfinderCard } from '@/components/PathfinderCard';
import { EntityClassificationEditor } from '@/components/EntityClassificationEditor';
import { TicketSignalCard } from '@/components/TicketSignalCard';
import { ThreadDrawer } from '@/components/ThreadDrawer';
import { ReportFraudModal } from '@/components/ReportFraudModal';
import { computeEntitySummaryPrefill, matchEntityToCatalog } from '@/lib/entity-catalog-prefill';
import {
  isPersonCandidate, isUnverifiedStub, relatedContacts, relationshipSummary,
  effectiveMode, suggestNextAction, recommendInterlocutor, recommendChannel,
} from '@/lib/relationship';
import { computeAlignment } from '@/lib/company-canon-logic';
import { vaultAccessAdviceFromDb } from '@/lib/vault-access-advice';
import { pipelineStageLabel } from '@/lib/pipeline-taxonomy';
import { findEffectiveGrant, computeCellEffect } from '@/lib/people-access-matrix';
import { useInterestRequests } from '@/lib/interest-requests-client';
import { authEnabled, browserClient } from '@/lib/supabase';
import { emitProductEvent } from '@/lib/product-events';
import type { Channel } from '@/lib/types';

// Prompt 727 §1 — "Next step" is now first: opening a dossier answers "what
// do I do about this firm" before anything else, not after paging through
// Overview.
const TABS = [
  { key: 'log', label: 'Next step' },
  { key: 'people', label: 'People & Team' },
  { key: 'messages', label: 'Messages' },
  { key: 'files', label: 'Files' },
  { key: 'overview', label: 'Overview' },
] as const;
type TabKey = typeof TABS[number]['key'];

// Prompt 727 §4's own local "sem IA, mínimo" channel rule and person pick
// (dossierChannelSuggestion + a bare nextContactPerson call) are replaced
// here by Prompt 728's real shared recommendInterlocutor()/
// recommendChannel() (relationship.ts) — same LinkedIn/email/institutional-
// channel priority, now with the documented reason and the affinity
// alternatives 728 §3 asks for.

// Prompt 727 §3 — the three honest empty-state shapes, replacing a bare "—"
// everywhere in this panel: work is actually running/scheduled ('preparing'
// — only ever shown when a real enrichment is pending, never a promise of
// work that isn't happening); only the founder can know this ('founder',
// with an edit affordance); or the field is real but its precondition
// hasn't happened yet ('not_yet', with the condition stated).
function EmptyField({ kind, onEdit, editLabel, condition }: {
  kind: 'preparing' | 'founder' | 'not_yet';
  onEdit?: () => void; editLabel?: string; condition?: string;
}) {
  if (kind === 'preparing') return <span className="italic text-gray-400">Sherlock is preparing this</span>;
  if (kind === 'founder') return (
    <span className="text-gray-400">
      Only you know this.{onEdit && <button onClick={onEdit} className="ml-1 text-cyan-700 hover:underline">{editLabel ?? 'Write'}</button>}
    </span>
  );
  return <span className="text-gray-400">Doesn&apos;t apply yet{condition ? ` — ${condition}` : ''}</span>;
}

export function EntityDossierPanel({ entityId, onClose }: {
  entityId: string;
  onClose: () => void;
}) {
  const { db, setInterest, markEntityVerified, updateEntity, updatePerson, resolveHardFilter, toggleTask } = useStore();
  const entity = db.entities.find((e) => e.id === entityId);
  const [tab, setTab] = useState<TabKey>('log');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [classifyNonce, setClassifyNonce] = useState(0);
  const [focusInteraction, setFocusInteraction] = useState<{ id: string; nonce: number }>({ id: '', nonce: 0 });
  const [logMode, setLogMode] = useState<'history' | 'log'>('history');
  const [logPrefill, setLogPrefill] = useState<{ personId?: string; nonce: number }>({ nonce: 0 });
  // Prompt 727 §5 — "Already sent — log it" prefills person AND channel AND
  // direction/date together (RailLogForm already supports all three
  // independently; this dossier just never wired channel/draft before).
  const [logChannelPrefill, setLogChannelPrefill] = useState<{ channel?: Channel; nonce: number }>({ nonce: 0 });
  const [logDraftPrefill, setLogDraftPrefill] = useState<{ direction?: 'out' | 'in'; date?: string; nonce: number }>({ nonce: 0 });
  const [contributionsRefreshKey, setContributionsRefreshKey] = useState(0);
  const [keyPeopleShownInTeam, setKeyPeopleShownInTeam] = useState(false);
  const [justAddedPersonId, setJustAddedPersonId] = useState<string | null>(null);
  const [addingPerson, setAddingPerson] = useState(false);
  const [reportingFraud, setReportingFraud] = useState(false);
  const [messaging, setMessaging] = useState<{ canMessage: boolean; investorCatalogEntityId: string | null; messages: { senderSide: string; createdAt: string }[] }>(
    { canMessage: false, investorCatalogEntityId: null, messages: [] },
  );
  // Prompt 677 §2 — "Thesis — their own words" had no edit affordance at
  // all: the text shown was always the generic catalog-matched summary
  // (catalog_entities.thesis), never a real quote, and there was no way to
  // put one there. Same pencil-icon-opens-a-box pattern already used for
  // Sectors/Stage (EntityClassificationEditor), writing through the same
  // updateEntity -> entities.thesis path — an org-level override over the
  // shared catalog value, exactly like those other fields.
  const [editingThesis, setEditingThesis] = useState(false);
  const [thesisDraft, setThesisDraft] = useState('');
  // Prompt 727 §3 — same pencil-icon pattern as Thesis above, for the two
  // "only you know this" fields in the Approach card.
  const [editingOurAngle, setEditingOurAngle] = useState(false);
  const [ourAngleDraft, setOurAngleDraft] = useState('');
  const [editingTheAsk, setEditingTheAsk] = useState(false);
  const [theAskDraft, setTheAskDraft] = useState('');
  // Prompt 727 §3 — "Sherlock prepara" is only ever shown when real
  // enrichment work is actually pending for this entity's catalog match —
  // never a promise of work that isn't happening. A live read (same
  // catalog_deliveries -> catalog_entities.enrichment_status join
  // EntityPeoplePanel.tsx already does for its own purpose), since
  // enrichment_status lives only on the real Postgres row, never in the
  // client `db` store's own CatalogEntity type.
  const [catalogPending, setCatalogPending] = useState(false);

  // Reset tab-local UI state whenever the panel switches to a different
  // investor — otherwise "Next step" could stay open on Log mode with
  // stale prefill from the previous row.
  useEffect(() => {
    setTab('log'); setLogMode('history'); setClassifyNonce(0);
    setFocusInteraction({ id: '', nonce: 0 }); setLogPrefill({ nonce: 0 });
    setLogChannelPrefill({ nonce: 0 }); setLogDraftPrefill({ nonce: 0 });
    setAddingPerson(false); setEditingThesis(false); setEditingOurAngle(false); setEditingTheAsk(false);
    emitProductEvent('dossier_opened', { entityId });
  }, [entityId]);

  // Prompt 727 §6 — "Next step" is the default tab now, so simply opening
  // the dossier already satisfies next_step_seen; also fires on an explicit
  // tab switch back to it.
  useEffect(() => {
    if (tab === 'log') emitProductEvent('next_step_seen', { entityId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, entityId]);

  useEffect(() => {
    if (!authEnabled) { setCatalogPending(false); return; }
    let cancelled = false;
    (async () => {
      const sb = browserClient();
      const { data: delivery } = await sb.from('catalog_deliveries').select('catalog_id').eq('entity_id', entityId).maybeSingle();
      if (cancelled) return;
      if (!delivery) { setCatalogPending(false); return; }
      const { data: catalogEntity } = await sb.from('catalog_entities').select('enrichment_status').eq('id', delivery.catalog_id as string).maybeSingle();
      if (!cancelled) setCatalogPending(catalogEntity?.enrichment_status === 'pending');
    })();
    return () => { cancelled = true; };
  }, [entityId]);

  useEffect(() => {
    if (!entity) return;
    fetch(`/api/founder/messages?entityId=${entity.id}`).then((r) => r.json())
      .then((d) => setMessaging({ canMessage: !!d.canMessage, investorCatalogEntityId: d.investorCatalogEntityId ?? null, messages: d.messages ?? [] }))
      .catch(() => {});
    // Re-fetch only when the id changes, not on every store mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.id]);

  const interestRequests = useInterestRequests();
  const pendingInterest = interestRequests.find((r) => r.status === 'pending' && r.entityId === entityId);

  const dealMessageTouches = useMemo(
    () => messaging.messages.map((m) => ({ occurredAt: m.createdAt, direction: (m.senderSide === 'investor' ? 'in' : 'out') as 'in' | 'out' })),
    [messaging.messages],
  );
  const canMessagePanel = !!(messaging.canMessage && messaging.investorCatalogEntityId);

  // Hooks above any early return, keyed off entityId (stable even before
  // `entity` itself resolves) — same discipline as /entities/[id]/page.tsx.
  const noDataRoomAccess = useMemo(
    () => vaultAccessAdviceFromDb(db).inConversationWithoutAccess.some((e) => e.entityId === entityId),
    [db, entityId],
  );

  if (!entity) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-gray-400">
        <p>This investor isn&apos;t in your pipeline (or hasn&apos;t finished loading).</p>
        <button onClick={onClose} className="text-[#0E7490] hover:underline">Close</button>
      </div>
    );
  }

  const catalogMatch = matchEntityToCatalog(entity, db.catalog);
  const summaryPrefill = computeEntitySummaryPrefill(entity, catalogMatch);
  const people = db.people.filter((p) => p.entity_id === entity.id).sort((a, b) => a.seniority_rank - b.seniority_rank);
  const personCandidate = isPersonCandidate(db, entity);
  const alignment = db.companyFacts.length > 0 ? computeAlignment(entity, db.companyFacts) : null;
  const alsoConnected = relatedContacts(db, entity.id).filter((r) => r.viaAffiliation);
  const locked = entity.contact_lock_until && new Date(entity.contact_lock_until) > new Date();
  const relSummary = relationshipSummary(db, entity.id, new Date(), dealMessageTouches);
  const tasks = db.tasks.filter((t) => t.entity_id === entity.id && !t.done);
  const recentTouches = [...db.interactions].filter((i) => i.entity_id === entity.id)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 2);
  const location = [entity.hq_city, entity.hq_country].filter(Boolean).join(', ') || summaryPrefill.hqCity || summaryPrefill.hqCountry
    || (catalogPending ? 'Sherlock is preparing this' : 'Not on file yet');

  // Prompt 727 §1/§4, now on Prompt 728's real shared rule — mode decides
  // the terminal branch (passed/dormant); relSummary.whoseTurn ('us' = they
  // replied, we owe a move; 'them'/'overdue' = we're waiting) decides
  // between the two live branches; the interlocutor recommendation
  // (person, reason, and any documented-affinity alternatives) and channel
  // pick both come from relationship.ts's shared functions now.
  const mode = effectiveMode(db, entity.id);
  const interlocutor = recommendInterlocutor(db, entity.id);
  const recommendedPerson = interlocutor.person;
  const recommendedChannel = recommendChannel(recommendedPerson, entity);
  const lastInboundInteraction = [...db.interactions].filter((i) => i.entity_id === entity.id && i.direction === 'in')
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
  const lastOutboundInteraction = [...db.interactions].filter((i) => i.entity_id === entity.id && i.direction === 'out')
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
  // Prompt 727 §1 — the pass reason lives on the INTERACTION that recorded
  // it (classification='pass'), not on the entity itself — Entity has no
  // pass_reason field of its own. reopenSignal()/suggestedReapproach()
  // (reopen-signals.ts) — the existing reevaluation mechanism this prompt
  // pointed at — take a ReopenSignalsDb (catalogDeliveries/
  // investorInvestments/approvedClaims/catalogCurrent), a strictly richer
  // shape than this panel's client-side Db and, confirmed by grep, called
  // from nowhere in production today (only its own test file) — wiring it
  // properly is more than this prompt's own "sem IA, mínimo" scope for a
  // dossier panel already this large, so it's flagged in the report rather
  // than force-fit here.
  const lastPassInteraction = mode !== 'active'
    ? [...db.interactions].filter((i) => i.entity_id === entity.id && i.classification === 'pass')
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0]
    : undefined;

  function prefillAlreadySent() {
    setLogPrefill((p) => ({ personId: recommendedPerson?.id, nonce: p.nonce + 1 }));
    setLogChannelPrefill((p) => ({ channel: recommendedChannel.value ?? undefined, nonce: p.nonce + 1 }));
    setLogDraftPrefill((p) => ({ direction: 'out', date: new Date().toISOString().slice(0, 10), nonce: p.nonce + 1 }));
    setLogMode('log');
    emitProductEvent('log_prefilled', { entityId });
  }

  // Prompt 889 §2 / 672 — the "missing hook" indication belongs here (and on
  // the open person profile), never as a task on the founder's own list
  // (Prompt 889's own decision, and the reason the 971-task batch was
  // deleted). Purely informational, plus a voluntary, optional way to help —
  // never a requirement gating anything else on this tab.
  const peopleWithoutHook = people.filter((p) => p.hook_status !== 'researched' && !p.do_not_contact);

  function focusHistory(interactionId: string) {
    setFocusInteraction((p) => ({ id: interactionId, nonce: p.nonce + 1 }));
    setTab('log'); setLogMode('history');
  }
  function classifyOnHistory() {
    setClassifyNonce((n) => n + 1);
    setTab('log'); setLogMode('history');
  }

  // Prompt 672 — "Shared with this investor": every document any of this
  // entity's people can currently reach, reusing the exact folder/document
  // precedence WhoHasAccessPanel/PeopleAccessPanel already use — never a
  // second resolution of "who can see what".
  const folderTree = db.folders.map((f) => ({ id: f.id, parent_id: f.parent_id }));
  const personIds = new Set(people.map((p) => p.id));
  const sharedDocs = personIds.size === 0 ? [] : db.documents.filter((d) => {
    const g = findEffectiveGrant(db.grants, d.id, d.folder_id, personIds, folderTree);
    const effect = computeCellEffect(g, new Date(), d.visibility);
    return effect === 'shared' || effect === 'shared_pending_nda' || effect === 'shared_pending_confirmation';
  });

  const tabCount: Record<TabKey, number | undefined> = {
    overview: undefined, people: people.length || undefined, log: undefined, messages: undefined,
    files: sharedDocs.length || undefined,
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Header — Prompt 675 §2: a faintly distinct background (not the
          same white as the content below) plus its own divider, so this
          reads as its own block — name, stage pills, tabs — rather than a
          plain continuation of the page. */}
      <div className="shrink-0 border-b border-gray-100 bg-[#FAFBFC] px-4 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2.5">
          <EntityAvatar id={entity.id} name={entity.name} website={entity.website} size="md" />
          <div className="min-w-0">
            {/* Prompt 672 — below ~900px the panel takes over the whole
                screen and needs its own way back, instead of relying on the
                now-hidden list beside it. Pure CSS (hidden until the
                min-[900px] breakpoint flips it back off), not a window-resize
                listener: the panel never needs to know its own rendered
                width, only which side of that one breakpoint it's on. */}
            <button onClick={onClose} className="mb-1 hidden text-xs font-medium text-gray-500 hover:text-gray-700 max-[899px]:inline-block">← Back to list</button>
            <h2 className="truncate text-lg font-bold text-gray-900">
              {entity.name}
              {isUnverifiedStub(entity) && (
                <span className="ml-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 align-middle text-[10px] font-semibold text-amber-700">not yet verified</span>
              )}
            </h2>
            <div className="mt-0.5 truncate text-[12.5px] text-gray-500">
              {entity.type.replace('_', ' ')} · {location} · <span className="font-mono">{fmtEur(entity.check_min_eur)}–{fmtEur(entity.check_max_eur)}</span>
            </div>
          </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Prompt 727 §2 — unconditional (unlike "← Back to list" above,
                which is narrow-width-only), so this is visible in both the
                wide and narrow layouts without needing a second copy. */}
            <Link href={`/entities/${entity.id}`} className="whitespace-nowrap text-xs font-medium text-[#0E7490] hover:underline">
              Open full dossier ↗
            </Link>
            <button onClick={onClose} aria-label="Close dossier" title="Close (Esc)"
              className="shrink-0 rounded-full border border-gray-200 px-2 py-1 text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-700">✕</button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-semibold text-gray-700">{pipelineStageLabel(entity.status)}</span>
          {entity.fit_score && <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10.5px] font-semibold text-green-700">{fitLabel[entity.fit_score]} fit</span>}
        </div>
        <div className="mt-2.5 flex gap-1 overflow-x-auto" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px] font-medium ${
                tab === t.key ? 'border-[#0E7490] text-[#0E7490]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t.label}{tabCount[t.key] ? <span className="ml-1 text-gray-400">{tabCount[t.key]}</span> : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Body — scrolls independently of the header/tabs. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'overview' && (
          <div className="space-y-3">
            {personCandidate && (
              <div className="rounded-lg border-l-4 border-purple-400 bg-purple-50 px-3 py-2 text-sm">
                <div className="font-semibold text-purple-900">This looks like a person, not a fund</div>
                <button onClick={() => markEntityVerified(entity.id)} className="mt-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50">Not a person</button>
              </div>
            )}
            <HardFilterBanner entity={entity} />
            <CompetitorInvestmentCard entityId={entity.id} />
            <PathfinderCard entityId={entity.id} />
            {alignment && alignment.status !== 'aligned' && (
              <div className={`rounded-lg border-l-4 px-3 py-2 text-sm ${alignment.status === 'misaligned' ? 'border-[#B00000] bg-red-50' : 'border-amber-400 bg-amber-50'}`}>
                <div className={`font-semibold ${alignment.status === 'misaligned' ? 'text-[#B00000]' : 'text-amber-900'}`}>
                  {alignment.status === 'misaligned' ? '⚠ Misaligned with the current company canon' : 'Caution — check against the company canon'}
                </div>
                <ul className="mt-1 space-y-0.5 text-gray-700">{alignment.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
            )}
            {locked && (
              <div className="rounded-lg border border-cyan-200 bg-[#E8F4F8] px-3 py-2 text-sm text-cyan-900">
                🔒 Contact lock until {entity.contact_lock_until!.slice(0, 10)}.
              </div>
            )}
            {pendingInterest && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Pending</span>
                <span className="ml-1.5 text-amber-900">Requested direct contact on {new Date(pendingInterest.requestedAt).toLocaleDateString()}.</span>
                {' '}<Link href="/today" className="font-medium text-[#0E7490] hover:underline">Decide in Today →</Link>
              </div>
            )}
            <SherlockInsightBanner entity={entity} dealMessageTouches={dealMessageTouches}
              onClassifyRequest={classifyOnHistory} canMessage={canMessagePanel}
              onSwitchToMessage={() => setTab('messages')}
              onSwitchToLog={(personId) => { setLogPrefill((p) => ({ personId, nonce: p.nonce + 1 })); setTab('log'); setLogMode('log'); }} />
            <RelationshipSummaryCard entity={entity} onClassifyRequest={classifyOnHistory} onViewInHistory={focusHistory} dealMessageTouches={dealMessageTouches} />
            <Card title="Entity summary">
              <div className="grid gap-3 sm:grid-cols-2">
                <dl className="space-y-1.5 text-sm text-gray-600">
                  <div>Website: {entity.website
                    ? <a className="text-[#0E7490] hover:underline" href={entity.website} target="_blank" rel="noreferrer">{entity.website.replace('https://', '')}</a>
                    : summaryPrefill.website ? <a className="text-[#0E7490] hover:underline" href={summaryPrefill.website} target="_blank" rel="noreferrer">{summaryPrefill.website.replace('https://', '')}</a>
                    : catalogPending ? <EmptyField kind="preparing" /> : <EmptyField kind="not_yet" condition="not on file" />}
                    {entity.website && <VerBadge state={entity.website_verified ? 'verified' : 'missing'} label={entity.website_verified ? '' : 'unverified'} />}
                  </div>
                  {/* Prompt 677 — this used to duplicate EntityClassificationEditor's
                      own "Sectors" line below it (a plain, non-editable,
                      no-prefill copy sitting right above the real, editable
                      one) — found while investigating that prompt's Geos
                      report. EntityClassificationEditor already renders
                      Sectors (with prefill + pencil), Geos, and Stage; this
                      dl only needs Website/Check on top of it. */}
                  <EntityClassificationEditor entity={entity} onUpdate={(patch) => updateEntity(entity.id, patch)}
                    sectorsPrefill={summaryPrefill.sectors} stagePrefill={{ min: summaryPrefill.stageMin, max: summaryPrefill.stageMax }} />
                  <div>Check: {entity.check_min_eur != null || entity.check_max_eur != null
                    ? <>{fmtEur(entity.check_min_eur)}–{fmtEur(entity.check_max_eur)}</>
                    : <>{fmtEur(summaryPrefill.checkMinEur)}–{fmtEur(summaryPrefill.checkMaxEur)}</>}
                  </div>
                </dl>
                <div className="space-y-2 text-sm text-gray-600">
                  <div>
                    <div className="text-xs text-gray-500">
                      Thesis — their own words
                      {!editingThesis && (
                        <button onClick={() => { setThesisDraft(entity.thesis ?? ''); setEditingThesis(true); }}
                          title="Edit" className="ml-1 text-[11px] text-gray-300 hover:text-cyan-700">✎</button>
                      )}
                    </div>
                    {editingThesis ? (
                      <div className="mt-1">
                        <textarea value={thesisDraft} onChange={(e) => setThesisDraft(e.target.value)} autoFocus rows={3}
                          placeholder="Paste the investor's own words — from their site, a call, an email…"
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs not-italic" />
                        <div className="mt-1 flex gap-2">
                          <button onClick={() => { updateEntity(entity.id, { thesis: thesisDraft.trim() || undefined }); setEditingThesis(false); }}
                            className="rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-medium text-white">Save</button>
                          <button onClick={() => setEditingThesis(false)} className="text-[11px] text-gray-500">Cancel</button>
                        </div>
                      </div>
                    ) : entity.thesis || summaryPrefill.thesis ? (
                      <p className="italic">&ldquo;{entity.thesis ?? summaryPrefill.thesis}&rdquo;</p>
                    ) : (
                      <p className="text-gray-400">No quote on file yet.</p>
                    )}
                  </div>
                  {entity.network_cluster_notes && <div><div className="text-xs text-gray-500">Network notes</div><p>{entity.network_cluster_notes}</p></div>}
                </div>
              </div>
              <div className="mt-3 border-t border-gray-100 pt-3">
                <ContributionBox subjectType="entity" subjectId={entity.id} orgId={db.org.id} subject={entity as unknown as Record<string, unknown>}
                  onApplyValue={(field, value) => updateEntity(entity.id, { [field]: value } as Partial<typeof entity>)}
                  refreshKey={contributionsRefreshKey} keyPeopleShownElsewhere={keyPeopleShownInTeam} />
              </div>
              <CommunityConsensusPanel entityId={entity.id} onApplyValue={(field, value) => updateEntity(entity.id, { [field]: value } as Partial<typeof entity>)} />
            </Card>
            <Card title="Tasks">
              {tasks.length === 0 ? <p className="text-sm text-gray-400">No open tasks for this investor.</p> : (
                <ul className="divide-y divide-gray-100 text-sm">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 py-1.5">
                      <input type="checkbox" checked={false} onChange={() => toggleTask(t.id)} />
                      <span className="flex-1">{t.title}</span>
                      {t.due_at && <span className="text-xs text-gray-400">{t.due_at.slice(0, 10)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Recent activity">
              {recentTouches.length === 0 ? <p className="text-sm text-gray-400">Nothing logged yet.</p> : (
                <ul className="space-y-1.5 text-sm text-gray-600">
                  {recentTouches.map((i) => (
                    <li key={i.id}>{i.direction === 'in' ? 'They wrote' : 'You wrote'} · {i.channel.replace('_', ' ')} — {i.occurred_at.slice(0, 10)}</li>
                  ))}
                </ul>
              )}
            </Card>
            {entity.hard_filter_status !== 'resolved_blocked' && (
              <button onClick={() => setReportingFraud(true)} className="text-xs text-gray-400 hover:text-red-700 hover:underline">🚩 Report this investor</button>
            )}
          </div>
        )}

        {tab === 'people' && (
          <div className="space-y-3">
            {peopleWithoutHook.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <b>{peopleWithoutHook.length} of {people.length} people have no researched hook yet.</b> Sherlock is on it —
                you can help with a news item, article, or reference link below. Optional, never a task on your list.
                <div className="mt-2 space-y-2">
                  {peopleWithoutHook.map((p) => (
                    <div key={p.id} className="rounded border border-amber-200 bg-white px-2 py-1.5">
                      <PersonLink id={p.id}><span className="font-medium text-amber-900">{p.full_name}</span></PersonLink>
                      <div className="mt-1">
                        <ContributionBox subjectType="person" subjectId={p.id} orgId={db.org.id} subject={p as unknown as Record<string, unknown>}
                          onApplyValue={(field, value) => updatePerson(p.id, { [field]: value } as Partial<typeof p>)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <EntityPeoplePanel entityId={entity.id} onShowsKeyPeopleFallback={setKeyPeopleShownInTeam} onPersonAdded={setJustAddedPersonId} />
            <Card title="People — one at a time, senior first">
              <p className="mb-2 text-xs text-gray-500">Approach one person per firm at a time, starting with the most senior.</p>
              <ul className="divide-y divide-gray-100">
                {people.map((p) => (
                  <li key={p.id} className={`flex items-center gap-3 py-2 ${justAddedPersonId === p.id ? 'person-added-highlight' : ''}`}>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">{p.seniority_rank}</span>
                    <div className="min-w-0 flex-1">
                      <PersonLink id={p.id}><span className="font-medium">{p.full_name}</span></PersonLink>
                      <span className="ml-2 text-xs text-gray-500">{p.role}</span>
                      {p.do_not_contact && <span className="ml-2 rounded bg-red-100 px-1.5 text-[10px] font-bold text-red-700">DO NOT CONTACT</span>}
                      <div className="mt-0.5 flex gap-3">
                        <VerBadge state={p.linkedin_verified ? 'verified' : 'missing'} label={p.linkedin_verified ? 'LinkedIn ✓' : 'LinkedIn ?'} />
                        <VerBadge state={p.bounce_count > 0 ? 'bounced' : p.email_verified ? 'verified' : p.email_guess ? 'guessed' : 'missing'}
                          label={p.bounce_count > 0 ? `Email bounced ×${p.bounce_count}` : p.email_verified ? 'Email ✓' : p.email_guess ? 'Email guessed' : 'No email'} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {people.length === 0 && relSummary.stage === 'not_contacted' && (
                <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">Nobody on file yet — add the person you want to approach before reaching out.</p>
              )}
              {addingPerson ? (
                <QuickCreatePerson entityId={entity.id} onCreated={(pid) => { setJustAddedPersonId(pid); setAddingPerson(false); }} onCancel={() => setAddingPerson(false)} />
              ) : (
                <button onClick={() => setAddingPerson(true)} className="mt-2 text-xs text-cyan-700 hover:underline">Add someone else</button>
              )}
            </Card>
            {alsoConnected.length > 0 && (
              <Card title="Also connected (other affiliations)" tint="amber">
                <ul className="space-y-1.5 text-sm">
                  {alsoConnected.map((r) => (
                    <li key={r.person.id}><PersonLink id={r.person.id}>{r.person.full_name}</PersonLink>{r.entity && <span className="text-gray-500"> — primarily at {r.entity.name}</span>}</li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}

        {tab === 'log' && (
          <div className="space-y-3">
            {/* Prompt 727 §1 — the action block: what changes per relationship
                state is THIS card, never the History/Log tools below it.
                Priority order: parked/closed (terminal) first, then
                not-yet-contacted, then whichever side owes the next move. */}
            {mode !== 'active' ? (
              <Card title="Why this is parked" tint="amber">
                <p className="text-sm text-gray-700">
                  {entity.status === 'dormant' ? (entity.dormant_reason ?? 'Manually parked.') : (lastPassInteraction?.pass_reason ?? 'Passed.')}
                </p>
                <p className="mt-1"><EmptyField kind="not_yet" condition="no reopening condition on file yet" /></p>
              </Card>
            ) : relSummary.stage === 'not_contacted' ? (
              recommendedPerson ? (
                <Card title="Prepare your approach" tint="blue">
                  <p className="text-sm text-gray-700">
                    <PersonLink id={recommendedPerson.id}><span className="font-medium">{recommendedPerson.full_name}</span></PersonLink>
                    {' '}— {interlocutor.reason}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Channel: {recommendedChannel.label}{recommendedChannel.needsConfirmation ? ' (possibility to confirm)' : ''}.
                  </p>
                  {/* Prompt 728 §3 — visible and a click away, never
                      automatic: there's no honest way yet to say a hook is
                      relevant to THIS startup specifically, only that one
                      exists. Promoting the alphabetically/seniority-first
                      alternative here would be exactly the unearned
                      confidence Fase 1 explicitly avoids. */}
                  {interlocutor.alternatives.length > 0 && (
                    <div className="mt-2 rounded-lg border border-[#0E7490]/30 bg-[#E8F4F8] px-2.5 py-2 text-xs text-[#0E7490]">
                      Person with documented affinity —{' '}
                      <PersonLink id={interlocutor.alternatives[0].person.id}>
                        <span className="font-medium">{interlocutor.alternatives[0].person.full_name}</span>
                      </PersonLink>
                      {interlocutor.alternatives[0].hook && <span className="italic"> — &ldquo;{interlocutor.alternatives[0].hook}&rdquo;</span>}
                      {' '}
                      <button onClick={() => { setLogPrefill((p) => ({ personId: interlocutor.alternatives[0].person.id, nonce: p.nonce + 1 })); }}
                        className="font-medium underline hover:no-underline">Contact this one instead</button>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={prefillAlreadySent} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">
                      Already sent — log it
                    </button>
                  </div>
                </Card>
              ) : (
                <Card title="Nobody to contact here yet" tint="amber">
                  <p className="text-sm text-gray-700">There&apos;s no contactable person on file for this firm yet.</p>
                  <button onClick={() => setTab('people')} className="mt-1 text-xs text-cyan-700 hover:underline">Go to People &amp; Team →</button>
                  {entity.submission_channel && (entity.submission_channel_type === 'form' || entity.submission_channel_type === 'email') && (
                    <p className="mt-2 text-xs text-gray-500">
                      Institutional channel: {entity.submission_channel_type === 'form' ? 'Submission form' : 'General email'} — {entity.submission_channel}
                    </p>
                  )}
                </Card>
              )
            ) : relSummary.whoseTurn === 'them' || relSummary.whoseTurn === 'overdue' ? (
              <Card title="Waiting on their reply" tint="blue">
                <p className="text-sm text-gray-700">Awaiting a reply since {relSummary.lastTouchAt?.slice(0, 10)}.</p>
                {lastOutboundInteraction && (() => {
                  const suggestion = suggestNextAction(lastOutboundInteraction.direction, lastOutboundInteraction.channel, undefined, lastOutboundInteraction.occurred_at, { entityName: entity.name });
                  return suggestion ? <p className="mt-1 text-xs text-gray-500">{suggestion.title}</p> : null;
                })()}
                <button onClick={() => setLogMode('log')} className="mt-2 rounded-lg border border-[#0E7490] px-3 py-1.5 text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8]">
                  Register their reply
                </button>
              </Card>
            ) : (() => {
              const classification = lastInboundInteraction?.classification;
              const verb = classification === 'meeting_request' ? 'Schedule the meeting'
                : classification === 'question' ? 'Answer their question'
                : classification === 'interested' ? 'Send material'
                : 'Reply';
              return (
                <Card title={verb} tint="blue">
                  <p className="text-sm text-gray-700">
                    They replied on {relSummary.lastTouchAt?.slice(0, 10)}{classification ? ` — ${classification.replace('_', ' ')}` : ''}.
                  </p>
                  <button onClick={() => setLogMode('log')} className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">{verb} →</button>
                </Card>
              );
            })()}

            <Card title="Approach" tint="blue">
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-gray-500">Our angle</dt>
                  {editingOurAngle ? (
                    <dd className="mt-1">
                      <textarea value={ourAngleDraft} onChange={(e) => setOurAngleDraft(e.target.value)} autoFocus rows={2}
                        placeholder="Your angle for this firm…" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
                      <div className="mt-1 flex gap-2">
                        <button onClick={() => { updateEntity(entity.id, { our_angle: ourAngleDraft.trim() || undefined }); setEditingOurAngle(false); }}
                          className="rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-medium text-white">Save</button>
                        <button onClick={() => setEditingOurAngle(false)} className="text-[11px] text-gray-500">Cancel</button>
                      </div>
                    </dd>
                  ) : (
                    <dd>{entity.our_angle ?? <EmptyField kind="founder" editLabel="Write" onEdit={() => { setOurAngleDraft(entity.our_angle ?? ''); setEditingOurAngle(true); }} />}</dd>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-gray-500">The ask (one, small)</dt>
                  {editingTheAsk ? (
                    <dd className="mt-1">
                      <textarea value={theAskDraft} onChange={(e) => setTheAskDraft(e.target.value)} autoFocus rows={2}
                        placeholder="The one, small thing to ask for…" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
                      <div className="mt-1 flex gap-2">
                        <button onClick={() => { updateEntity(entity.id, { the_ask: theAskDraft.trim() || undefined }); setEditingTheAsk(false); }}
                          className="rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-medium text-white">Save</button>
                        <button onClick={() => setEditingTheAsk(false)} className="text-[11px] text-gray-500">Cancel</button>
                      </div>
                    </dd>
                  ) : (
                    <dd className="font-medium">{entity.the_ask ?? <EmptyField kind="founder" editLabel="Write" onEdit={() => { setTheAskDraft(entity.the_ask ?? ''); setEditingTheAsk(true); }} />}</dd>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Committed by this investor</dt>
                  <dd className="mt-1 text-xs text-gray-400">
                    {entity.interest_eur == null ? (
                      <EmptyField kind="not_yet" condition="appears after a positive response" />
                    ) : (
                      <>Current: {fmtEur(entity.interest_eur)}</>
                    )}
                    <button onClick={() => { const v = window.prompt('Amount (€)', String(entity.interest_eur ?? '')); if (v !== null) setInterest(entity.id, v ? Number(v) : undefined); }}
                      className="ml-2 text-cyan-700 hover:underline">Edit</button>
                  </dd>
                </div>
              </dl>
            </Card>
            <div className="flex gap-3">
              <div className="min-w-0 flex-1 rounded-xl bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">First contact</div>
                <div className="text-sm font-bold text-[#0E7490]">
                  {relSummary.firstContactAt?.slice(0, 10) ?? <EmptyField kind="not_yet" condition="appears after your first logged contact" />}
                </div>
                <div className="text-[11px] text-gray-500">{relSummary.touchCount} touches</div>
              </div>
              <div className="min-w-0 flex-1 rounded-xl bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Last touch</div>
                <div className="text-sm font-bold text-[#0E7490]">
                  {relSummary.lastTouchAt?.slice(0, 10) ?? <EmptyField kind="not_yet" condition="appears after your first logged contact" />}
                </div>
                <div className="text-[11px] font-semibold text-[#0E7490]">{relSummary.daysSinceLastTouch != null ? `${relSummary.daysSinceLastTouch}d ago` : ' '}</div>
              </div>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="flex gap-1 rounded-lg bg-white p-1">
                {(['history', 'log'] as const).map((m) => (
                  <button key={m} onClick={() => setLogMode(m)}
                    className={`flex-1 rounded py-1.5 text-[12px] font-semibold ${logMode === m ? 'bg-[#0E7490] text-white' : 'text-gray-500 hover:text-gray-700'}`}>
                    {m === 'history' ? '🕐 History' : '＋ Log'}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                {logMode === 'history' && (
                  <RecentInteractions entity={entity} onOpenFull={() => setDrawerOpen(true)} focusClassifyNonce={classifyNonce} focusInteraction={focusInteraction} dealMessages={messaging.messages as unknown as never[]} />
                )}
                {logMode === 'log' && (
                  <RailLogForm entity={entity} defaultPersonId={logPrefill.personId} prefillNonce={logPrefill.nonce}
                    defaultChannel={logChannelPrefill.channel} channelNonce={logChannelPrefill.nonce}
                    defaultDraft={logDraftPrefill.direction ? { direction: logDraftPrefill.direction, date: logDraftPrefill.date } : undefined}
                    draftNonce={logDraftPrefill.nonce}
                    onSaved={() => { setLogMode('history'); emitProductEvent('interaction_logged', { entityId }); }} />
                )}
              </div>
            </div>
            <TicketSignalCard orgId={db.org.id} people={people} />
          </div>
        )}

        {tab === 'messages' && (
          canMessagePanel && messaging.investorCatalogEntityId ? (
            <div className="space-y-3">
              <PreContactReadinessNudge entityId={entity.id} />
              <MessageThreadCore entityId={entity.id} investorCatalogEntityId={messaging.investorCatalogEntityId} />
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              In-app messaging is for MatchDeal investors who marked you Interested. For a catalog investor, reach out on your own channel and log it in Approach & Log.
            </p>
          )
        )}

        {tab === 'files' && (
          <div className="space-y-3">
            {noDataRoomAccess && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                You&apos;re in active conversation with {entity.name} — they still have no data room access.{' '}
                <Link href="/documents" className="font-medium underline hover:no-underline">Share the folders that answer their questions</Link>.
              </div>
            )}
            <Card title="Shared with this investor">
              {sharedDocs.length === 0 ? (
                <p className="text-sm text-gray-400">Nothing shared yet. Documents you share appear here.</p>
              ) : (
                <ul className="divide-y divide-gray-100 text-sm">
                  {sharedDocs.map((d) => <li key={d.id} className="py-1.5 text-gray-700">{d.name}</li>)}
                </ul>
              )}
              <Link href="/documents" className="mt-2 inline-block text-xs text-cyan-700 hover:underline">+ Share a document →</Link>
            </Card>
          </div>
        )}
      </div>

      <ThreadDrawer entity={entity} open={drawerOpen} onClose={() => setDrawerOpen(false)} dealMessageTouches={dealMessageTouches} dealMessages={messaging.messages as unknown as never[]} />
      {reportingFraud && (
        <ReportFraudModal entityId={entity.id} entityName={entity.name}
          onCancel={() => setReportingFraud(false)}
          onReported={() => { setReportingFraud(false); resolveHardFilter(entity.id, 'resolved_blocked'); }} />
      )}
    </div>
  );
}
