'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import { Card, HardFilterBanner, MatchDealProfileBadge, PersonLink, TermHint, VerBadge, fitLabel, fmtEur } from '@/components/ui';
import { computeEntitySummaryPrefill, matchEntityToCatalog } from '@/lib/entity-catalog-prefill';
import { preflight, preflightSummary } from '@/lib/rules';
import { RelationshipSummaryCard } from '@/components/RelationshipSummaryCard';
import { RecentInteractions } from '@/components/RecentInteractions';
import { ThreadDrawer } from '@/components/ThreadDrawer';
import { MessageThreadCore } from '@/components/MessageThreadCore';
import { RailLogForm } from '@/components/RailLogForm';
import { ContributionBox } from '@/components/ContributionBox';
import { CommunityConsensusPanel } from '@/components/CommunityConsensusPanel';
import { EnrichmentBadge } from '@/components/EnrichmentBadge';
import { EntityPeoplePanel } from '@/components/EntityPeoplePanel';
import { CompetitorInvestmentCard } from '@/components/CompetitorInvestmentCard';
import { PathfinderCard } from '@/components/PathfinderCard';
import { entityCompleteness, qualifiesForContactEnrichment } from '@/lib/completeness';
import { isPersonCandidate, isUnverifiedStub, relatedContacts, relationshipSummary } from '@/lib/relationship';
import { SherlockInsightBanner } from '@/components/SherlockInsightBanner';
import { computeAlignment } from '@/lib/company-canon-logic';
import { browserClient } from '@/lib/supabase';
import { EntityClassificationEditor } from '@/components/EntityClassificationEditor';
import { TicketSignalCard } from '@/components/TicketSignalCard';
import { FormAssistModal } from '@/components/FormAssistModal';
import { useInterestRequests } from '@/lib/interest-requests-client';
import type { DealMessage } from '@/components/deal-messages/DealThreadView';
import { PageTour } from '@/components/onboarding/PageTour';
import { ReportFraudModal } from '@/components/ReportFraudModal';

export default function EntityPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { db, loading, refreshFromServer, setInterest, markEntityVerified, updateEntity, resolveHardFilter } = useStore();
  const entity = db.entities.find((e) => e.id === id);
  // Prompt 346 §B — this used to trust the client store blindly: an id not
  // found here was declared "Entity not found" outright, even for an
  // entity that demonstrably exists in the database (the confirmed
  // incident — an investor's interest reconciled server-side seconds
  // earlier, invisible here until an F5, since this store only ever
  // hydrates once on load). One refetch of the whole store (the same
  // refreshFromServer path the interest popup itself uses — never a
  // second, parallel fetch) before giving up; only a genuinely nonexistent
  // id still reaches the error state below, which now offers a real way
  // out (Refresh) instead of being a dead end.
  const [attemptedRefetch, setAttemptedRefetch] = useState(false);
  const [refetching, setRefetching] = useState(false);
  useEffect(() => {
    if (entity || loading || attemptedRefetch) return;
    setRefetching(true);
    refreshFromServer().finally(() => { setRefetching(false); setAttemptedRefetch(true); });
  }, [entity, loading, attemptedRefetch, refreshFromServer]);
  // Prompt 220 §C — o pedido de nível 3 deste investidor, se pendente. O
  // match é por entityId (a resolução catalog_deliveries devolvida pelo
  // endpoint founder), a mesma que liga a task do Today ao pedido.
  const interestRequests = useInterestRequests();
  const pendingInterest = interestRequests.find((r) => r.status === 'pending' && r.entityId === id);
  const [interest, setInterestLocal] = useState<string>('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Prompt 208 §D — contador, nao booleano: o founder pode pedir "leva-me la"
  // duas vezes seguidas e a segunda tem de voltar a fazer scroll.
  const [classifyNonce, setClassifyNonce] = useState(0);
  // Prompt 209 — ancora do badge de documentos. Contador pela mesma razao do
  // classifyNonce: pedir duas vezes a mesma tem de voltar a fazer scroll.
  const [focusInteraction, setFocusInteraction] = useState<{ id: string; nonce: number }>({ id: '', nonce: 0 });
  const [contactAvailable, setContactAvailable] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState({ website: '', email: '', phone: '', address: '' });
  const [contributionsRefreshKey, setContributionsRefreshKey] = useState(0);
  // Prompt 275 §1 — set by EntityPeoplePanel itself (only it knows whether
  // its live catalog read is empty, which is what decides whether the
  // key_people fallback list renders) so ContributionBox can drop its own
  // duplicate "Key people: ... verified" line for the exact same data.
  const [keyPeopleShownInTeam, setKeyPeopleShownInTeam] = useState(false);
  // Prompt 275 §3 — id of the person just promoted from the Team card's
  // key_people fallback via "Add as contact"; drives the scroll+highlight
  // in the "People" card below so the click's effect is visible.
  const [justAddedPersonId, setJustAddedPersonId] = useState<string | null>(null);
  const personRowRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const [showFormAssist, setShowFormAssist] = useState(false);
  // Prompt 285 §1 — a general, always-reachable report entry point,
  // independent of HardFilterBanner's own "Report" button (ui.tsx L273
  // only ever shows it when hard_filter_status==='open' AND hard_filter
  // text exists — most entities have neither, so most had no way to
  // report at all). Own state, own modal instance: HardFilterBanner's
  // `reporting` state is scoped to its own button and stays exactly as is.
  const [reportingFraud, setReportingFraud] = useState(false);
  // Prompt 197 A §2 — "Message investor" button visibility. canMessage
  // mirrors canInvestorMessage's own symmetric criterion, computed
  // server-side (deal-messages.ts's founderMessageEligibleFirms +
  // resolveFounderEntityToEligibleFirm) since it needs a DB round-trip this
  // client-side entity object can't answer on its own. `messages` (raw
  // Sherlock thread, if any) is kept here too — Prompt 197 C.1 turns it
  // into dealMessageTouches below, fed to RelationshipSummaryCard/
  // ThreadDrawer so a Sherlock reply counts toward whoseTurn/health the
  // same way a manually-logged interaction already does.
  // Prompt 238 — `messages` alargado ao DealMessage completo (o servidor já
  // devolvia isto sempre; o tipo aqui é que estava reduzido a
  // {senderSide, createdAt}, porque até agora só serviam dealMessageTouches
  // — as mensagens nunca eram DESENHADAS, só contadas). Agora servem as
  // duas coisas: a contagem (como sempre) e o conteúdo, fundido no
  // histórico via mergeTimeline.
  const [messaging, setMessaging] = useState<{
    canMessage: boolean; investorCatalogEntityId: string | null; investorName: string | null;
    messages: DealMessage[];
  }>({ canMessage: false, investorCatalogEntityId: null, investorName: null, messages: [] });
  // Prompt 397 §B.1 — the conversation panel's own segmented state. History
  // is the default (also where the `entity-history` tour anchor lives, via
  // RecentInteractions — matches Zone B's own default-tab pattern below).
  const [panelMode, setPanelMode] = useState<'history' | 'log' | 'message'>('history');
  // Prompt 397 §B.3.3 — carries the Sherlock Insight banner's suggested
  // target person into RailLogForm; nonce bumps on every banner click (even
  // to the same person) so it re-applies even if the founder already
  // switched away and back.
  const [logPrefill, setLogPrefill] = useState<{ personId?: string; nonce: number }>({ nonce: 0 });
  // Prompt 400 §B.2 — the document-request review page's own prefill
  // (direction/date/content, via ?rail=log&direction=&date=&content=),
  // separate from logPrefill since it doesn't drive RailLogForm's §D.1
  // shimmer (see that component's own prop comment).
  const [logDraftPrefill, setLogDraftPrefill] = useState<{ direction?: 'out' | 'in'; date?: string; content?: string; nonce: number }>({ nonce: 0 });
  // Block F — a "Request NDA via message" link (from the document-request
  // review page) lands here with a draft body pre-filled but NEVER sent
  // automatically: it switches the panel to Message with the same composer
  // the founder always uses, they still have to review it and press Send.
  const searchParams = useSearchParams();
  const ndaDraft = searchParams.get('ndaDraft');
  // Prompt 319 Pedido C.4 — "ask about follow-on interest", only where a
  // verified invested relationship already exists. Prompt 396 §1 — the GET
  // used to only check "a MatchDeal delivery row exists", not invested
  // status, so this rendered (as dead weight — the POST silently rejected
  // it) for any MatchDeal-delivered investor. The GET now enforces the same
  // check the POST always did.
  const [followOn, setFollowOn] = useState<{ eligible: boolean; investorCatalogEntityId?: string; signal?: { active: boolean } | null; requestPending?: boolean }>({ eligible: false });
  const [followOnBusy, setFollowOnBusy] = useState(false);
  // Prompt 396 §5 — the bottom half of the page used to stack ~12 blocks in
  // one continuous column. True tabs now, same pattern as 394 §2's Company
  // settings page: only the active section mounts. 'summary' is the
  // default — it's also where the `entity-summary` tour anchor lives.
  const [activeSection, setActiveSection] = useState<'summary' | 'people' | 'approach' | 'engagement'>('summary');

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((me) => setContactAvailable(!!me.capabilities?.entityContactFields)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!entity) return;
    fetch(`/api/network/followon?entityId=${entity.id}`).then((r) => r.json()).then(setFollowOn).catch(() => setFollowOn({ eligible: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.id]);

  function askAboutFollowOn() {
    if (!followOn.investorCatalogEntityId) return;
    setFollowOnBusy(true);
    fetch('/api/network/followon', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ investorCatalogEntityId: followOn.investorCatalogEntityId }),
    }).then((r) => r.json()).then((b) => { if (b.ok && entity) fetch(`/api/network/followon?entityId=${entity.id}`).then((r) => r.json()).then(setFollowOn); })
      .finally(() => setFollowOnBusy(false));
  }

  useEffect(() => {
    if (!entity) return;
    fetch(`/api/founder/messages?entityId=${entity.id}`).then((r) => r.json())
      .then((d) => setMessaging({
        canMessage: !!d.canMessage, investorCatalogEntityId: d.investorCatalogEntityId ?? null,
        investorName: d.investorName ?? null, messages: d.messages ?? [],
      }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.id]);

  useEffect(() => {
    if (ndaDraft && messaging.canMessage) setPanelMode('message');
  }, [ndaDraft, messaging.canMessage]);

  // Prompt 400 §A.3 — the panel's own deep-link params, same pattern as
  // ?ndaDraft just above: read once on mount, no page of their own. The
  // Sherlock "Next" button (shell.tsx) is the first caller, landing here
  // already set up to act instead of a bare entity link; §B reuses this for
  // /log's own redirect.
  const railMode = searchParams.get('rail');
  const railPerson = searchParams.get('person');
  const railClassify = searchParams.get('classify');
  // §B.2 — the document-request review page's own prefill shape (Prompt
  // 372 Block D: pre-fill an INBOUND log with the request text verbatim,
  // no person involved).
  const railDirection = searchParams.get('direction');
  const railDate = searchParams.get('date');
  const railContent = searchParams.get('content');
  // Prompt 410 §2.2/§2.4 — the Sherlock Next Clue button's own deep-link
  // for a pending interest request (sherlock-next.ts §2.1): scrolls to the
  // Sherlock Insight banner and asks it to draw the focus lupa over its
  // primary action (§2.4). Same "read once at mount" shape as ndaDraft
  // above and rail* below — no page of its own.
  const focusParam = searchParams.get('focus');
  useEffect(() => {
    if (focusParam !== 'interest') return;
    const id = window.setTimeout(() => {
      document.querySelector<HTMLElement>('[data-tour-id="entity-tip"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
    return () => window.clearTimeout(id);
  }, [focusParam]);

  useEffect(() => {
    if (railMode === 'log') {
      setLogPrefill((p) => ({ personId: railPerson ?? undefined, nonce: p.nonce + 1 }));
      if (railDirection || railDate || railContent) {
        setLogDraftPrefill((p) => ({
          direction: railDirection === 'in' ? 'in' : railDirection === 'out' ? 'out' : undefined,
          date: railDate ?? undefined, content: railContent ?? undefined, nonce: p.nonce + 1,
        }));
      }
      setPanelMode('log');
    } else if (railMode === 'history') {
      setPanelMode('history');
      if (railClassify) setClassifyNonce((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railMode, railPerson, railClassify, railDirection, railDate, railContent]);

  // Prompt 275 §3 — scrolls to and briefly highlights the row a founder
  // just promoted from the Team card's key_people fallback via "Add as
  // contact", closing the loop between the two cards. Same ref-map +
  // setTimeout(0) pattern as RecentInteractions' own focusInteraction (the
  // row must exist in the DOM before scrollIntoView can find it — the
  // person only enters `people` on the next render after addPerson). The
  // clearing timeout matches the CSS animation's own 1500ms duration
  // (person-added-highlight, globals.css) rather than leaving the
  // conditional class attached indefinitely.
  useEffect(() => {
    if (!justAddedPersonId) return;
    const scrollId = window.setTimeout(() => {
      personRowRefs.current[justAddedPersonId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
    const clearId = window.setTimeout(() => setJustAddedPersonId(null), 1500);
    return () => { window.clearTimeout(scrollId); window.clearTimeout(clearId); };
  }, [justAddedPersonId]);

  // Prompt 197 C.1 — deal_messages -> the same {occurredAt, direction} shape
  // relationshipSummary already understands. senderSide==='investor' is the
  // 'in' direction (they wrote, founder's turn), mirroring
  // Interaction.direction's own convention exactly.
  const dealMessageTouches = useMemo(
    () => messaging.messages.map((m) => ({ occurredAt: m.createdAt, direction: (m.senderSide === 'investor' ? 'in' : 'out') as 'in' | 'out' })),
    [messaging.messages],
  );

  if (!entity) {
    if (loading || refetching || !attemptedRefetch) return <div className="text-gray-500">Loading…</div>;
    return (
      <div className="mx-auto mt-16 max-w-sm space-y-3 text-center">
        <p className="text-sm text-gray-600">We couldn&apos;t find this entity — it may still be syncing.</p>
        <button onClick={() => setAttemptedRefetch(false)}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b]">
          Refresh
        </button>
      </div>
    );
  }

  function startEditContact() {
    setContactDraft({
      website: entity!.website ?? '', email: entity!.email ?? '',
      phone: entity!.phone ?? '', address: entity!.address ?? '',
    });
    setEditingContact(true);
  }

  function saveContact() {
    updateEntity(entity!.id, {
      website: contactDraft.website.trim() || undefined,
      email: contactDraft.email.trim() || undefined,
      phone: contactDraft.phone.trim() || undefined,
      address: contactDraft.address.trim() || undefined,
    });
    setEditingContact(false);
  }
  const completeness = entityCompleteness(entity);

  // Prompt 256 §B — resolved fresh every render (no one-time copy) so an
  // investor updating their MatchDeal profile shows up here without any
  // sync step; both entity-catalog-prefill.ts functions are pure and cheap
  // (one pass over the already-loaded db.catalog), matching the cost class
  // of the plain filters already on this page.
  const catalogMatch = matchEntityToCatalog(entity, db.catalog);
  const summaryPrefill = computeEntitySummaryPrefill(entity, catalogMatch);

  const people = db.people.filter((p) => p.entity_id === entity.id).sort((a, b) => a.seniority_rank - b.seniority_rank);
  const personCandidate = isPersonCandidate(db, entity);
  // §11d — only computed/shown once there's real canon to compare against;
  // stays invisible tonight (db.companyFacts is empty pre-migration/pre-population).
  const alignment = db.companyFacts.length > 0 ? computeAlignment(entity, db.companyFacts) : null;
  const alsoConnected = relatedContacts(db, entity.id).filter((r) => r.viaAffiliation);
  const locked = entity.contact_lock_until && new Date(entity.contact_lock_until) > new Date();
  const grants = db.grants.filter((g) => people.some((p) => p.id === g.person_id));
  // Prompt 397 §B.1 — the FIRST CONTACT/LAST TOUCH mini-cards need this same
  // pure computation the journey card/banner also call independently (same
  // pattern as HealthDot/WhoseTurnChip already use throughout this codebase).
  const relSummary = relationshipSummary(db, entity.id, new Date(), dealMessageTouches);
  const views = db.views.filter((v) => grants.some((g) => g.id === v.grant_id)
    || people.some((p) => p.email_verified && p.email_verified === v.viewer_email));
  const canMessagePanel = !!(messaging.canMessage && messaging.investorCatalogEntityId);
  // Both the journey card's history-badge clicks and the banner's classify
  // button need to land on the History tab of the panel below, now that
  // history isn't always visible — same functional effect as before (398
  // §B focuses/scrolls), just also switching tabs first.
  function focusHistory(interactionId: string) {
    setFocusInteraction((p) => ({ id: interactionId, nonce: p.nonce + 1 }));
    setPanelMode('history');
  }
  function classifyOnHistory() {
    setClassifyNonce((n) => n + 1);
    setPanelMode('history');
  }

  return (
    // Prompt 397 §A.1 — content-area background tint, scoped to only this
    // page: the negative margin cancels the shell's own `<main>` padding
    // (shell.tsx, shared globally, untouched) and re-applies the same
    // amount so the tint fills exactly the content region, not the whole
    // shell (sidebar/header stay whatever they already are).
    <div className="-m-4 space-y-4 bg-[#F8FAFC] p-4 md:-m-8 md:p-8">
      <PageTour pageKey="guide_entity" />
      {/* Prompt 397 §A.2 — identity header: big name + verified chip, then
          an icon row carrying the SAME info the StatusPill/FitTag/WaveTag
          pills used to (status is now redundant with the journey card's own
          highlighted current stage right below, so it's dropped here
          entirely — not hidden, just no longer duplicated). Those three
          components are shared elsewhere (Pipeline table) and keep their
          own look there; they simply don't render on THIS page anymore,
          which doesn't touch their global appearance.
          No buttons here — Log interaction / Message investor move to the
          conversation panel (Phase 397 B). Follow-on's ask button has no
          assigned spot in the approved study (Log/Message are the only two
          named); left here rather than inventing a new home for it or
          silently dropping a working action. */}
      <div data-tour-id="entity-header" className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[27px] font-bold tracking-tight text-gray-900">
            {entity.name}
            {isUnverifiedStub(entity) && (
              <span className="ml-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 align-middle text-xs font-semibold text-amber-700" title="No independent proof this entity exists yet — website, domain, phone, address, or a source specific to it.">
                not yet verified
              </span>
            )}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[#475569]">
            {entity.email && (
              <span className="flex items-center gap-1.5">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5"><path d="M3 5h14v10H3z" strokeLinejoin="round" /><path d="m3 5 7 6 7-6" strokeLinejoin="round" /></svg>
                {entity.email}
              </span>
            )}
            {(entity.hq_city || entity.hq_country) && (
              <span className="flex items-center gap-1.5">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5"><path d="M10 18s6-5.5 6-10a6 6 0 1 0-12 0c0 4.5 6 10 6 10Z" strokeLinejoin="round" /><circle cx="10" cy="8" r="2" /></svg>
                {entity.hq_city ? `${entity.hq_city}, ` : ''}{entity.hq_country}
              </span>
            )}
            <span>• {entity.type.replace('_', ' ')} · Wave {entity.wave ?? '—'} · {entity.fit_score ? fitLabel[entity.fit_score] : '—'} fit</span>
            {followOn.signal?.active && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                ↻ Signaled follow-on interest
              </span>
            )}
          </div>
        </div>
        {followOn.eligible && !followOn.signal?.active && (
          <button onClick={askAboutFollowOn} disabled={followOnBusy || followOn.requestPending}
            className="rounded-lg border border-emerald-300 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60">
            {followOn.requestPending ? 'Follow-on ask sent' : 'Ask about follow-on interest'}
          </button>
        )}
      </div>

      {/* "Convert to person (angel)" removed from every founder-facing
          surface (prompt 33) — it's a shared-catalog type correction, not a
          founder pipeline opinion, and now requires platform_admin via
          POST /api/entities/[id]/convert-to-person. "Not a person" stays:
          it only dismisses this founder's own flag (last_verified), no
          catalog-wide effect. */}
      {personCandidate && (
        <div className="flex items-start justify-between gap-4 rounded-lg border-l-4 border-purple-400 bg-purple-50 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-purple-900">This looks like a person, not a fund</div>
            <div className="text-sm text-gray-700">
              No website, no email domain, and no contacts recorded under it — likely an individual (e.g. a solo angel) imported as an organization.
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => markEntityVerified(entity.id)}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50">Not a person</button>
          </div>
        </div>
      )}

      <HardFilterBanner entity={entity} />
      <CompetitorInvestmentCard entityId={entity.id} />
      <PathfinderCard entityId={entity.id} />
      {alignment && alignment.status !== 'aligned' && (
        <div className={`rounded-lg border-l-4 px-4 py-3 ${alignment.status === 'misaligned' ? 'border-[#B00000] bg-red-50' : 'border-amber-400 bg-amber-50'}`}>
          <div className={`text-sm font-semibold ${alignment.status === 'misaligned' ? 'text-[#B00000]' : 'text-amber-900'}`}>
            {alignment.status === 'misaligned' ? '⚠ Misaligned with the current company canon' : 'Caution — check against the company canon'}
          </div>
          <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
            {alignment.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {alignment.status === 'misaligned' && (
            <p className="mt-1 text-xs text-gray-500">Consider parking this one with a reopen trigger rather than approaching now.</p>
          )}
        </div>
      )}
      {locked && (
        <div className="rounded-lg border border-cyan-200 bg-[#E8F4F8] px-4 py-2 text-sm text-cyan-900">
          🔒 Contact lock until {entity.contact_lock_until!.slice(0, 10)} — one approach per entity.
        </div>
      )}
      {/* Prompt 396 §5 — moved up from the right column of the old grid
          (where it lived buried under People/Approach/Round): this is a
          decision request FROM the investor, not something that belongs
          hidden at the bottom. Zone A, with the other banners. */}
      {pendingInterest && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Pending</span>
          <span className="ml-1.5 text-xs text-amber-900">
            This investor requested direct contact (level 3) on {new Date(pendingInterest.requestedAt).toLocaleDateString()}.
          </span>
          <Link href="/today" className="ml-1.5 text-xs font-medium text-[#0E7490] hover:underline">Decide in Today →</Link>
        </div>
      )}

      {/* Prompt 397 §A.3 — the journey+state+actions card. */}
      <RelationshipSummaryCard entity={entity}
        onClassifyRequest={classifyOnHistory}
        onViewInHistory={focusHistory}
        dealMessageTouches={dealMessageTouches} />

      {/* Prompt 397 §A.4 — the advice banner, full-width, between the
          journey card and the rest of the page. */}
      <SherlockInsightBanner entity={entity} dealMessageTouches={dealMessageTouches}
        onClassifyRequest={classifyOnHistory}
        canMessage={canMessagePanel}
        focusInterest={focusParam === 'interest'}
        onSwitchToMessage={() => setPanelMode('message')}
        onSwitchToLog={(personId) => { setLogPrefill((p) => ({ personId, nonce: p.nonce + 1 })); setPanelMode('log'); }} />

      {/* Prompt 397 §B.1 — below the banner: left = Zone B's 4 tabs
          (unchanged), right = the conversation panel (History/Log/Message).
          Stacks (panel below) under `lg`. */}
      <div className="grid gap-[18px] lg:grid-cols-[1fr_392px]">
        <div className="min-w-0 space-y-4">
          {/* Prompt 396 §5 — Zone B: sub-tabs for everything accessory to
              the main flow. Only the active section mounts (same pattern as
              394 §2's Company settings page). */}
          <div className="flex gap-1 overflow-x-auto border-b border-gray-200">
            {([
              { key: 'summary', label: 'Entity summary' },
              { key: 'people', label: 'People & Team' },
              { key: 'approach', label: 'Approach' },
              { key: 'engagement', label: 'Engagement' },
            ] as const).map((s) => (
              // Prompt 396 §5.4 — `entity-people`'s tour anchor moved from
              // the People card (only mounted on this tab) to this
              // always-mounted tab button, same fix as 394 §2.4 for the
              // same underlying problem: PageTour resolves every step's
              // anchor up front, so a step whose anchor lives inside a
              // not-yet-active tab gets silently dropped.
              <button key={s.key} data-tour-id={s.key === 'people' ? 'entity-people' : undefined}
                onClick={() => setActiveSection(s.key)}
                className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
                  activeSection === s.key ? 'border-[#0E7490] text-[#0E7490]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {s.label}
              </button>
            ))}
          </div>

      {activeSection === 'engagement' && (
        <>
          {db.ndas.filter((n) => n.entity_id === entity.id).length > 0 && (
            <Card title="NDAs on file">
              <ul className="space-y-2 text-sm">
                {db.ndas.filter((n) => n.entity_id === entity.id).map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center gap-2">
                    <span>{n.file_name ?? 'NDA'}</span>
                    <span className="text-xs text-gray-400">
                      uploaded {n.uploaded_at.slice(0, 10)}{n.uploaded_by ? ` by ${n.uploaded_by}` : ''}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      n.match_status === 'match' ? 'bg-green-100 text-green-800'
                      : n.match_status === 'mismatch' ? 'bg-red-100 text-[#B00000]'
                      : 'bg-amber-100 text-amber-800'}`} title={n.match_notes}>
                      {n.match_status === 'match' ? 'AI check: match' : n.match_status === 'mismatch' ? 'AI check: mismatch — verify' : 'AI check: uncertain'}
                    </span>
                    <button
                      onClick={async () => {
                        const sb = browserClient();
                        const { data, error } = await sb.storage.from('data-room').createSignedUrl(n.storage_path, 60);
                        if (error) { alert(`Could not open file: ${error.message}`); return; }
                        window.open(data.signedUrl, '_blank');
                      }}
                      className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {(grants.length > 0 || views.length > 0) && (
            <Card title="Data room engagement">
              <div className="text-sm text-gray-600">
                {grants.filter((g) => !g.revoked_at).length} active grant(s) · {views.length} view(s)
              </div>
              {views.slice(-3).reverse().map((v) => (
                <div key={v.id} className="mt-1 text-xs text-gray-500">
                  {db.documents.find((d) => d.id === v.document_id)?.name} — {v.viewed_at.slice(0, 16).replace('T', ' ')}
                  {v.seconds ? ` · ${Math.round(v.seconds / 60)} min` : ''}
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {activeSection === 'summary' && (
      <Card title={
        <span data-tour-id="entity-summary" className="flex items-center gap-1.5">
          Entity summary
          {/* Prompt 407 §B.4 — entity-level provenance: at least one field
              below (website/sectors/thesis/check size/geographies) came
              from the investor's own claimed, complete profile rather than
              research, as of when this entity was delivered. Not per-field
              (claimed_profile_at_delivery is a single flag, not tracked
              column by column) and not live (a later claim revocation
              doesn't change what was already delivered — see migration
              0257's own comment). */}
          {entity.claimed_profile_at_delivery && (
            <span title="At least one field below was provided directly by the investor, not researched by our team."
              className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700">
              Provided by the investor · verified profile
            </span>
          )}
        </span>
      } right={
        <div className="flex flex-col items-end gap-1">
          <EnrichmentBadge label="Firmographic" result={completeness.firmographic} subjectType="entity" subjectId={entity.id} orgId={db.org.id} onEnriched={() => setContributionsRefreshKey((k) => k + 1)} />
          <EnrichmentBadge label="Contact" result={completeness.contact} low={qualifiesForContactEnrichment(completeness)} subjectType="entity" subjectId={entity.id} orgId={db.org.id} onEnriched={() => setContributionsRefreshKey((k) => k + 1)} />
        </div>
      }>
        <div className="grid gap-4 sm:grid-cols-2">
          <dl className="space-y-1.5 text-sm text-gray-600">
            {contactAvailable ? (
              <div className="-mx-2 mb-1 rounded-lg border border-gray-100 bg-gray-50 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">Contact</span>
                  {!editingContact && <button onClick={startEditContact} className="text-xs text-cyan-700 hover:underline">Edit</button>}
                </div>
                {editingContact ? (
                  <div className="space-y-1.5">
                    <input value={contactDraft.website} onChange={(e) => setContactDraft({ ...contactDraft, website: e.target.value })}
                      placeholder="Website" className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
                    <input value={contactDraft.email} onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })}
                      placeholder="Email" className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
                    <input value={contactDraft.phone} onChange={(e) => setContactDraft({ ...contactDraft, phone: e.target.value })}
                      placeholder="Phone" className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
                    <input value={contactDraft.address} onChange={(e) => setContactDraft({ ...contactDraft, address: e.target.value })}
                      placeholder="Address" className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
                    <div className="flex gap-2">
                      <button onClick={saveContact} className="rounded bg-[#0E7490] px-2 py-1 text-xs font-medium text-white">Save</button>
                      <button onClick={() => setEditingContact(false)} className="rounded border border-gray-300 px-2 py-1 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-1">Website: {entity.website
                      ? <a className="text-[#0E7490] hover:underline" href={entity.website} target="_blank">{entity.website.replace('https://', '')}</a>
                      : summaryPrefill.website
                        ? <><a className="text-[#0E7490] hover:underline" href={summaryPrefill.website} target="_blank">{summaryPrefill.website.replace('https://', '')}</a><MatchDealProfileBadge /></>
                        : '—'}
                      {entity.website && <VerBadge state={entity.website_verified ? 'verified' : 'missing'} label={entity.website_verified ? '' : 'unverified'} />}
                    </div>
                    <div>Email: {entity.email ?? '—'}</div>
                    <div>Phone: {entity.phone ?? '—'}</div>
                    <div>Address: {entity.address ?? '—'}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1">Website: {entity.website
                ? <a className="text-[#0E7490] hover:underline" href={entity.website} target="_blank">{entity.website.replace('https://', '')}</a>
                : summaryPrefill.website
                  ? <><a className="text-[#0E7490] hover:underline" href={summaryPrefill.website} target="_blank">{summaryPrefill.website.replace('https://', '')}</a><MatchDealProfileBadge /></>
                  : '—'}
                {entity.website && <VerBadge state={entity.website_verified ? 'verified' : 'missing'} label={entity.website_verified ? '' : 'unverified'} />}
              </div>
            )}
            <div>Domain: {entity.email_domain ?? '—'} {entity.email_domain_verified && '✓'}</div>
            <div>HQ: {entity.hq_city || entity.hq_country
              ? <>{entity.hq_city ? `${entity.hq_city}, ` : ''}{entity.hq_country ?? '—'}</>
              : summaryPrefill.hqCity || summaryPrefill.hqCountry
                ? <>{summaryPrefill.hqCity ? `${summaryPrefill.hqCity}, ` : ''}{summaryPrefill.hqCountry ?? '—'}<MatchDealProfileBadge /></>
                : '—'}
            </div>
            <EntityClassificationEditor entity={entity} onUpdate={(patch) => updateEntity(entity.id, patch)}
              sectorsPrefill={summaryPrefill.sectors} stagePrefill={{ min: summaryPrefill.stageMin, max: summaryPrefill.stageMax }} />
            <div>Check: {entity.check_min_eur != null || entity.check_max_eur != null
              ? <>{fmtEur(entity.check_min_eur)}–{fmtEur(entity.check_max_eur)}</>
              : summaryPrefill.checkMinEur != null || summaryPrefill.checkMaxEur != null
                ? <>{fmtEur(summaryPrefill.checkMinEur)}–{fmtEur(summaryPrefill.checkMaxEur)}<MatchDealProfileBadge /></>
                : <>{fmtEur(undefined)}–{fmtEur(undefined)}</>}
            </div>
          </dl>
          <div className="space-y-3">
            {entity.thesis ? (
              <div>
                <div className="text-xs text-gray-500">Thesis — their own words</div>
                <p className="text-sm italic text-gray-600">“{entity.thesis}”</p>
              </div>
            ) : summaryPrefill.thesis ? (
              <div>
                <div className="text-xs text-gray-500">Thesis — their own words <MatchDealProfileBadge /></div>
                <p className="text-sm italic text-gray-600">“{summaryPrefill.thesis}”</p>
              </div>
            ) : null}
            {entity.network_cluster_notes && (
              <div>
                <div className="text-xs text-gray-500">Network notes</div>
                <p className="text-sm text-gray-700">{entity.network_cluster_notes}</p>
              </div>
            )}
            {!entity.thesis && !summaryPrefill.thesis && !entity.network_cluster_notes && <p className="text-sm text-gray-400">No thesis or network notes yet.</p>}
          </div>
        </div>
        <div className="mt-4 border-t border-gray-100 pt-3">
          <ContributionBox subjectType="entity" subjectId={entity.id} orgId={db.org.id} subject={entity as unknown as Record<string, unknown>}
            onApplyValue={(field, value) => updateEntity(entity.id, { [field]: value } as Partial<typeof entity>)} refreshKey={contributionsRefreshKey}
            keyPeopleShownElsewhere={keyPeopleShownInTeam} />
        </div>
        <CommunityConsensusPanel entityId={entity.id}
          onApplyValue={(field, value) => updateEntity(entity.id, { [field]: value } as Partial<typeof entity>)} />
      </Card>
      )}

      {activeSection === 'people' && (
        <div className="space-y-4">
          <EntityPeoplePanel entityId={entity.id} onShowsKeyPeopleFallback={setKeyPeopleShownInTeam} onPersonAdded={setJustAddedPersonId} />

          {/* Prompt 255 — "People (contact order enforced)" didn't explain
              itself even to the person who wrote the rule. The doctrine
              (one person at a time, most senior first — preflight's own
              seniority check enforces this, see rules.ts §5) is now in the
              title AND spelled out below it, not just implied by jargon. */}
          <Card title="People — one at a time, senior first">
            <p className="mb-2 text-xs text-gray-500">
              Approach one person per firm at a time, starting with the most senior. Parallel approaches to the
              same fund read as spraying.
            </p>
            <ul className="divide-y divide-gray-100">
              {people.map((p) => {
                const s = preflightSummary(preflight(db, p, null));
                return (
                  <li key={p.id} ref={(el) => { personRowRefs.current[p.id] = el; }}
                    className={`flex items-center gap-3 py-2 ${justAddedPersonId === p.id ? 'person-added-highlight' : ''}`}>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">{p.seniority_rank}</span>
                    <div className="min-w-0 flex-1">
                      <PersonLink id={p.id}><span className="font-medium">{p.full_name}</span></PersonLink>
                      <span className="ml-2 text-xs text-gray-500">{p.role}</span>
                      {p.do_not_contact && <span className="ml-2 rounded bg-red-100 px-1.5 text-[10px] font-bold text-red-700">DO NOT CONTACT</span>}
                      <div className="mt-0.5 flex gap-3">
                        <VerBadge state={p.linkedin_verified ? 'verified' : 'missing'} label={p.linkedin_verified ? 'LinkedIn ✓' : 'LinkedIn ?'} />
                        <VerBadge state={p.bounce_count > 0 ? 'bounced' : p.email_verified ? 'verified' : p.email_guess ? 'guessed' : 'missing'}
                          label={p.bounce_count > 0 ? `Email bounced ×${p.bounce_count}` : p.email_verified ? 'Email ✓' : p.email_guess ? 'Email guessed' : 'No email'} />
                        {p.hook_status !== 'researched' && <span className="text-xs text-gray-400">no researched hook</span>}
                      </div>
                    </div>
                    <span title={s.green ? 'Pre-flight green' : 'Pre-flight failing'} className={s.green ? 'text-green-600' : 'text-[#B00000]'}>●</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-gray-400">Rank 2 unlocks only after rank 1 replies or goes dormant.</p>
          </Card>

          {alsoConnected.length > 0 && (
            <Card title="Also connected (other affiliations)" tint="amber">
              <ul className="space-y-1.5 text-sm">
                {alsoConnected.map((r) => (
                  <li key={r.person.id}>
                    <PersonLink id={r.person.id}>{r.person.full_name}</PersonLink>
                    {r.entity && <span className="text-gray-500"> — primarily at {r.entity.name}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-gray-400">
                Not part of this entity&apos;s contact order — a separate, informational affiliation.
              </p>
            </Card>
          )}
        </div>
      )}

      {activeSection === 'approach' && (
        <div className="space-y-4">
          <Card title="Approach" tint="blue">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-gray-500">Our angle</dt><dd>{entity.our_angle ?? '—'}</dd></div>
              <div><dt className="text-xs text-gray-500">The ask (one, small)</dt><dd className="font-medium">{entity.the_ask ?? '—'}</dd></div>
              {entity.submission_channel && (
                <div><dt className="text-xs text-gray-500">Official channel — use first</dt>
                  <dd className="font-mono text-xs">
                    {entity.submission_channel_type === 'form' ? (
                      <a href={entity.submission_channel} target="_blank" rel="noopener noreferrer" className="text-[#0E7490] hover:underline">
                        {entity.submission_channel}
                      </a>
                    ) : entity.submission_channel}
                  </dd>
                  {entity.submission_channel_type === 'form' && (
                    <button onClick={() => setShowFormAssist(true)}
                      className="mt-1.5 rounded-lg border border-cyan-200 px-2.5 py-1 text-xs font-medium text-cyan-800 hover:bg-cyan-50">
                      ✨ Prepare form answers
                    </button>
                  )}
                </div>
              )}
              {/* Prompt 396 §6 — this used to be its own "Round" card;
                  nobody understood the name ("ninguém entende", direct
                  feedback). It's the one thing it always was: the € THIS
                  investor soft-circled/committed, feeding the round's
                  progress on the dashboard — folded into Approach, with a
                  label that says that plainly. Same field, same Save,
                  same "Current: X" — only the home and the name changed. */}
              <div>
                <dt className="flex items-center gap-1 text-xs text-gray-500">
                  Committed by this investor
                  <TermHint text="The amount THIS investor soft-circled or committed. It counts toward your round's progress on the dashboard." />
                </dt>
                <dd className="mt-1">
                  <div className="flex gap-2">
                    <input value={interest || (entity.interest_eur ?? '')} onChange={(e) => setInterestLocal(e.target.value)}
                      placeholder="e.g. 250000" className="w-28 rounded border border-gray-300 px-2 py-1 text-sm" />
                    <button onClick={() => setInterest(entity.id, interest ? Number(interest) : undefined)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Save</button>
                  </div>
                  <div className="mt-1 text-xs text-gray-400">Current: {fmtEur(entity.interest_eur)}</div>
                </dd>
              </div>
            </dl>
          </Card>
          {showFormAssist && <FormAssistModal db={db} entityId={entity.id} onClose={() => setShowFormAssist(false)} />}
          <TicketSignalCard orgId={db.org.id} people={people} />
        </div>
      )}
        </div>

        {/* Prompt 397 §B.1 — the conversation panel: two mini cards (data
            from relationshipSummary, already computed above) + the
            History/Log/Message segmented card. */}
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="flex gap-3">
            <div className="min-w-0 flex-1 rounded-2xl bg-white px-4 py-3 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
              <div className="text-[11.5px] text-gray-500">First contact</div>
              <div className="mt-0.5 truncate text-sm font-bold text-[#0E7490]">{relSummary.firstContactAt?.slice(0, 10) ?? '—'}</div>
              <div className="mt-0.5 text-[11.5px] text-gray-500">{relSummary.touchCount} touches</div>
            </div>
            <div className="min-w-0 flex-1 rounded-2xl bg-white px-4 py-3 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
              <div className="text-[11.5px] text-gray-500">Last touch</div>
              <div className="mt-0.5 truncate text-sm font-bold text-[#0E7490]">{relSummary.lastTouchAt?.slice(0, 10) ?? '—'}</div>
              <div className="mt-0.5 text-[11.5px] font-semibold text-[#0E7490]">
                {relSummary.daysSinceLastTouch != null ? `${relSummary.daysSinceLastTouch}d ago` : ' '}
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
            <div className="flex gap-1 rounded-xl bg-[#F1F5F9] p-1">
              {([
                { key: 'history' as const, label: 'History', icon: (
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5"><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) },
                { key: 'log' as const, label: 'Log', icon: (
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5"><path d="M10 5v10M5 10h10" strokeLinecap="round" /></svg>
                ) },
                { key: 'message' as const, label: 'Message', icon: (
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5"><path d="M3 4h14v9H8l-3 3v-3H3z" strokeLinejoin="round" /></svg>
                ) },
              ]).map((m) => {
                const disabled = m.key === 'message' && !canMessagePanel;
                return (
                  <button key={m.key} disabled={disabled}
                    title={disabled ? 'Messaging opens once this investor is connected' : undefined}
                    onClick={() => setPanelMode(m.key)}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] font-semibold ${
                      panelMode === m.key ? 'bg-white text-[#0E7490] shadow-[0_1px_4px_rgba(15,23,42,0.15)]'
                      : disabled ? 'cursor-not-allowed text-gray-300' : 'text-gray-500 hover:text-gray-700'}`}>
                    {m.icon}{m.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-3">
              {panelMode === 'history' && (
                <RecentInteractions entity={entity} onOpenFull={() => setDrawerOpen(true)} focusClassifyNonce={classifyNonce}
                  focusInteraction={focusInteraction} dealMessages={messaging.messages} />
              )}
              {panelMode === 'log' && (
                <RailLogForm entity={entity} defaultPersonId={logPrefill.personId} prefillNonce={logPrefill.nonce}
                  defaultDraft={logDraftPrefill} draftNonce={logDraftPrefill.nonce}
                  onSaved={() => setPanelMode('history')} />
              )}
              {panelMode === 'message' && messaging.canMessage && messaging.investorCatalogEntityId && (
                <MessageThreadCore entityId={entity.id} investorCatalogEntityId={messaging.investorCatalogEntityId}
                  initialBody={ndaDraft ?? undefined} />
              )}
            </div>
          </div>
        </div>
      </div>

      <ThreadDrawer entity={entity} open={drawerOpen} onClose={() => setDrawerOpen(false)}
        dealMessageTouches={dealMessageTouches} dealMessages={messaging.messages} />

      {/* Prompt 396 §2.2 — moved from a floating line at the very top (a
          visual band right above the content, even when small) to the
          bottom of the page. Same discreet styling, same condition, same
          modal — Prompt 285's own "reachable, never prominent" is better
          served down here than competing with the header. */}
      {entity.hard_filter_status !== 'resolved_blocked' && (
        <div className="flex justify-end">
          <button onClick={() => setReportingFraud(true)} className="text-xs text-gray-400 hover:text-red-700 hover:underline">
            🚩 Report this investor
          </button>
        </div>
      )}
      {reportingFraud && (
        <ReportFraudModal entityId={entity.id} entityName={entity.name}
          onCancel={() => setReportingFraud(false)}
          onReported={() => { setReportingFraud(false); resolveHardFilter(entity.id, 'resolved_blocked'); }} />
      )}
    </div>
  );
}
