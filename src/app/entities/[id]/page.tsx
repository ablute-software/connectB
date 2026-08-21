'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card, FitTag, HardFilterBanner, MatchDealProfileBadge, PersonLink, StatusPill, VerBadge, WaveTag, fmtEur } from '@/components/ui';
import { computeEntitySummaryPrefill, matchEntityToCatalog } from '@/lib/entity-catalog-prefill';
import { preflight, preflightSummary } from '@/lib/rules';
import { RelationshipSummaryCard } from '@/components/RelationshipSummaryCard';
import { RecentInteractions } from '@/components/RecentInteractions';
import { ThreadDrawer } from '@/components/ThreadDrawer';
import { MessageInvestorDrawer } from '@/components/MessageInvestorDrawer';
import { ContributionBox } from '@/components/ContributionBox';
import { CommunityConsensusPanel } from '@/components/CommunityConsensusPanel';
import { EnrichmentBadge } from '@/components/EnrichmentBadge';
import { EntityPeoplePanel } from '@/components/EntityPeoplePanel';
import { CompetitorInvestmentCard } from '@/components/CompetitorInvestmentCard';
import { entityCompleteness, qualifiesForContactEnrichment } from '@/lib/completeness';
import { isPersonCandidate, isUnverifiedStub, relatedContacts } from '@/lib/relationship';
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
  const { db, setInterest, markEntityVerified, updateEntity, resolveHardFilter } = useStore();
  const entity = db.entities.find((e) => e.id === id);
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
  const [messagingOpen, setMessagingOpen] = useState(false);

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((me) => setContactAvailable(!!me.capabilities?.entityContactFields)).catch(() => {});
  }, []);

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

  if (!entity) return <div className="text-gray-500">Entity not found.</div>;

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
  const views = db.views.filter((v) => grants.some((g) => g.id === v.grant_id)
    || people.some((p) => p.email_verified && p.email_verified === v.viewer_email));

  return (
    <div className="space-y-4">
      <PageTour pageKey="guide_entity" />
      <div data-tour-id="entity-header" className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {entity.name}
            {isUnverifiedStub(entity) && (
              <span className="ml-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 align-middle text-xs font-semibold text-amber-700" title="No independent proof this entity exists yet — website, domain, phone, address, or a source specific to it.">
                not yet verified
              </span>
            )}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <StatusPill status={entity.status} /> <FitTag fit={entity.fit_score} /> <WaveTag wave={entity.wave} />
            <span>{entity.type.replace('_', ' ')}</span>
            <span>· {entity.hq_city ? `${entity.hq_city}, ` : ''}{entity.hq_country}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/log?entity=${entity.id}`} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Log interaction</Link>
          {messaging.canMessage && messaging.investorCatalogEntityId && (
            <button onClick={() => setMessagingOpen(true)}
              className="rounded-lg border border-[#0E7490] px-3 py-1.5 text-sm font-medium text-[#0E7490] hover:bg-[#E8F4F8]">
              Message investor
            </button>
          )}
          {/* Prompt 233 §A — "Mark dormant" saiu. Era o caminho INCOMPLETO
              dos dois que gravam status:'dormant' — so setEntityStatus, sem
              tocar nas tarefas pendentes — e duplicava uma decisao que ja
              vive em "Something else ▾" > "Frozen / no continuity", que faz
              o mesmo MAIS applyPlan(planPark(...)). Esse trigger sobe para
              fora do banner de saida no cartao (§B), por isso este botao
              deixa de ser o unico caminho para parquear sem sugestao activa. */}
        </div>
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
      {/* Prompt 285 §1 — same modal, same route (POST /api/entities/[id]/
          report-fraud — already org_id/membership-scoped only, no
          hard_filter dependency at all, confirmed by reading the route
          first), just a second, always-visible entry point next to the
          status banner. Hidden once already resolved_blocked — the banner
          above already shows that state there, and a second "report"
          button on an already-reported entity would be confusing, not
          useful (see the banner's own new dispute action for that state
          instead). Discreet on purpose (small, muted text, not a primary
          action like "Add as contact") — reachable, never prominent. */}
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
      <CompetitorInvestmentCard entityId={entity.id} />
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

      {/* Prompt 202 §C — o histórico deixa de viver só atrás do botão.
          Prompt 241 — e deixa de viver DUAS vezes: o RecentInteractions
          (que tem a classificação inline e os saltos) passa a preencher a
          coluna direita do cartão, em vez de ser um segundo bloco por
          baixo a mostrar as mesmas linhas. Continua a receber os mesmos
          nonces daqui — é por isso que o badge "N to classify" e o badge
          de documento do stepper continuam a saltar para a linha certa. */}
      <RelationshipSummaryCard entity={entity} onOpenThread={() => setDrawerOpen(true)}
        onClassifyRequest={() => setClassifyNonce((n) => n + 1)}
        onViewInHistory={(id) => setFocusInteraction((p) => ({ id, nonce: p.nonce + 1 }))}
        dealMessageTouches={dealMessageTouches}
        historySlot={(
          <RecentInteractions entity={entity} onOpenFull={() => setDrawerOpen(true)} focusClassifyNonce={classifyNonce}
            focusInteraction={focusInteraction} dealMessages={messaging.messages} />
        )} />

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

      <Card title={<span data-tour-id="entity-summary">Entity summary</span>} right={
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

      <EntityPeoplePanel entityId={entity.id} onShowsKeyPeopleFallback={setKeyPeopleShownInTeam} onPersonAdded={setJustAddedPersonId} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          {/* Prompt 255 — "People (contact order enforced)" didn't explain
              itself even to the person who wrote the rule. The doctrine
              (one person at a time, most senior first — preflight's own
              seniority check enforces this, see rules.ts §5) is now in the
              title AND spelled out below it, not just implied by jargon. */}
          <Card title={<span data-tour-id="entity-people">People — one at a time, senior first</span>}>
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

        <div className="space-y-4">
          {pendingInterest && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Pending</span>
              <span className="ml-1.5 text-xs text-amber-900">
                This investor requested direct contact (level 3) on {new Date(pendingInterest.requestedAt).toLocaleDateString()}.
              </span>
              <Link href="/today" className="ml-1.5 text-xs font-medium text-[#0E7490] hover:underline">Decide in Today →</Link>
            </div>
          )}
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
            </dl>
          </Card>
          {showFormAssist && <FormAssistModal db={db} entityId={entity.id} onClose={() => setShowFormAssist(false)} />}
          <Card title="Round">
            <div className="text-sm">
              <div className="text-xs text-gray-500">Soft-circled / committed</div>
              <div className="mt-1 flex gap-2">
                <input value={interest || (entity.interest_eur ?? '')} onChange={(e) => setInterestLocal(e.target.value)}
                  placeholder="e.g. 250000" className="w-28 rounded border border-gray-300 px-2 py-1 text-sm" />
                <button onClick={() => setInterest(entity.id, interest ? Number(interest) : undefined)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Save</button>
              </div>
              <div className="mt-1 text-xs text-gray-400">Current: {fmtEur(entity.interest_eur)}</div>
            </div>
          </Card>
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
          <TicketSignalCard orgId={db.org.id} people={people} />
        </div>
      </div>

      <ThreadDrawer entity={entity} open={drawerOpen} onClose={() => setDrawerOpen(false)}
        dealMessageTouches={dealMessageTouches} dealMessages={messaging.messages} />
      {messaging.investorCatalogEntityId && (
        <MessageInvestorDrawer
          entityId={entity.id} investorCatalogEntityId={messaging.investorCatalogEntityId}
          investorName={messaging.investorName ?? entity.name} open={messagingOpen} onClose={() => setMessagingOpen(false)}
        />
      )}
    </div>
  );
}
