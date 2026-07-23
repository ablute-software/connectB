'use client';
// Needs-review dossier + triage toolkit. The dossier groups imported
// interactions by entity (left rail, pending counts) and shows the full
// chronological thread per entity for context. On top of the original
// classify-or-clear flow, each pending item now carries:
//   1. FULL inline edit — content, date, channel, direction, classification.
//      The import's placeholder date (2018-01-01 on "(sem data)" rows) shows
//      as "data por confirmar", and a date parsed from the item's own text
//      is offered as a one-click correction (the Alantra case).
//   2. ROUTE-TO actions — create a person from the item's text, save the
//      item's contact details onto the entity, or add a remembered
//      interaction the import never captured.
//   3. UNDO — a single-step, session-scoped stack: every triage action can be
//      reverted, including un-creating a routed person and un-filling entity
//      fields. Inverse logic lives (and is tested) in needs-review-logic.ts.
//
// All manual triage goes through the generic updateInteraction patch, NOT
// classifyInteraction — deliberately: these are historical imported memories,
// and one old "interested" reply shouldn't flip the entity's live pipeline
// status. That also makes every action cleanly reversible.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, EntityLink, Tooltip } from '@/components/ui';
import { QuickCreatePerson } from '@/components/QuickCreatePerson';
import type { Channel, Classification, Direction, Interaction } from '@/lib/types';
import {
  classifyMechanically, decideAutoApply, invertTriageAction, isPlaceholderDate,
  looksLikeMetadataCard, parseMetadataCard, parsePersonHint, suggestDateFromContent,
  type AiClassificationProposal, type TriageAction, type UndoOp,
} from '@/lib/needs-review-logic';

const CLASSIFY_KEYS: { key: string; classification: Classification; label: string }[] = [
  { key: '1', classification: 'interested', label: 'Interested' },
  { key: '2', classification: 'meeting_request', label: 'Meeting request' },
  { key: '3', classification: 'question', label: 'Question' },
];

const CHANNELS: { v: Channel; l: string }[] = [
  { v: 'linkedin_dm', l: 'LinkedIn DM' }, { v: 'linkedin_note', l: 'LinkedIn note' },
  { v: 'email', l: 'Email' }, { v: 'web_form', l: 'Web form' }, { v: 'call', l: 'Call' },
  { v: 'meeting', l: 'Meeting' }, { v: 'event', l: 'Event' }, { v: 'intro', l: 'Intro' },
];
const CLASSIFICATIONS: Classification[] = ['awaiting', 'interested', 'meeting_request', 'question', 'pass', 'out_of_office', 'bounce', 'unclear'];

interface Proposal {
  kind: 'metadata_card' | 'interaction';
  proposedClassification?: Classification;
  confidence: 'high' | 'low';
  reason: string;
  classifiedBy: 'ai' | 'mechanical';
}

interface PassSummary { metadata: number; mechanical: number; aiHigh: number; queued: number }

const CLASSIFIED_BY_STYLE: Record<'ai' | 'mechanical', string> = {
  ai: 'bg-purple-100 text-purple-800',
  mechanical: 'bg-gray-100 text-gray-600',
};

type PanelKind = 'edit' | 'person' | 'entityData' | 'addInteraction';

export default function NeedsReviewPage() {
  const {
    db, classifyInteraction, clearNeedsReview, revertToNeedsReview, applyMetadataCard,
    updateInteraction, addInteraction, removeInteraction, removePerson, updateEntity,
  } = useStore();

  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [contactFieldsAvailable, setContactFieldsAvailable] = useState(false);
  useEffect(() => {
    // no-store so a just-applied migration 0021 is reflected on the next
    // page load rather than served from a stale cached /api/me response.
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then((me) => {
      setAiAvailable(!!me.capabilities?.needsReviewAi);
      setContactFieldsAvailable(!!me.capabilities?.entityContactFields);
    }).catch(() => setAiAvailable(false));
  }, []);

  const [railMode, setRailMode] = useState<'pending' | 'ai_classified'>('pending');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [itemIndex, setItemIndex] = useState(0);
  const [proposalsById, setProposalsById] = useState<Record<string, Proposal>>({});
  const [passRunning, setPassRunning] = useState(false);
  const [passProgress, setPassProgress] = useState<{ done: number; total: number } | null>(null);
  const [passSummary, setPassSummary] = useState<PassSummary | null>(null);

  // Triage toolkit state
  const [panel, setPanel] = useState<{ itemId: string; kind: PanelKind } | null>(null);
  const [editDraft, setEditDraft] = useState({ content: '', date: '', channel: 'email' as Channel, direction: 'out' as Direction, classification: '' as Classification | '' });
  const [addDraft, setAddDraft] = useState({ date: '', channel: 'meeting' as Channel, direction: 'out' as Direction, content: '', personId: '' });
  const [linkMore, setLinkMore] = useState<{ personId: string; personName: string; candidateIds: string[] } | null>(null);
  const [lastAction, setLastAction] = useState<TriageAction | null>(null);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);

  function pushUndo(action: TriageAction, label: string) {
    setLastAction(action);
    setUndoLabel(label);
  }
  function dispatchUndoOp(op: UndoOp) {
    if (op.kind === 'updateInteraction') updateInteraction(op.id, op.patch);
    else if (op.kind === 'removeInteraction') removeInteraction(op.id);
    else if (op.kind === 'removePerson') removePerson(op.id);
    else if (op.kind === 'updateEntity') updateEntity(op.id, op.patch);
  }
  function performUndo() {
    if (!lastAction) return;
    for (const op of invertTriageAction(lastAction)) dispatchUndoOp(op);
    setLastAction(null); setUndoLabel(null); setLinkMore(null); setPanel(null);
  }

  const pendingByEntity = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of db.interactions) if (i.needs_review) map.set(i.entity_id, (map.get(i.entity_id) ?? 0) + 1);
    return map;
  }, [db.interactions]);

  const aiClassifiedByEntity = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of db.interactions) if (i.classified_by) map.set(i.entity_id, (map.get(i.entity_id) ?? 0) + 1);
    return map;
  }, [db.interactions]);

  const countsForRail = railMode === 'pending' ? pendingByEntity : aiClassifiedByEntity;
  const railEntities = useMemo(() => {
    return db.entities.filter((e) => countsForRail.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [db.entities, countsForRail]);

  useEffect(() => {
    if (selectedEntityId && railEntities.some((e) => e.id === selectedEntityId)) return;
    setSelectedEntityId(railEntities[0]?.id ?? null);
    setItemIndex(0);
  }, [railEntities, selectedEntityId]);

  const totalPending = pendingByEntity.size ? [...pendingByEntity.values()].reduce((s, n) => s + n, 0) : 0;
  const totalAiClassified = [...aiClassifiedByEntity.values()].reduce((s, n) => s + n, 0);

  const thread = useMemo(() => {
    if (!selectedEntityId) return [];
    return db.interactions.filter((i) => i.entity_id === selectedEntityId).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  }, [db.interactions, selectedEntityId]);

  const pendingItems = useMemo(() => thread.filter((i) => i.needs_review), [thread]);

  useEffect(() => {
    if (itemIndex >= pendingItems.length && pendingItems.length > 0) setItemIndex(pendingItems.length - 1);
    if (pendingItems.length === 0) setItemIndex(0);
  }, [pendingItems.length, itemIndex]);

  const focused = pendingItems[itemIndex];
  const entity = selectedEntityId ? db.entities.find((e) => e.id === selectedEntityId) : undefined;
  const people = useMemo(() => db.people.filter((p) => p.entity_id === selectedEntityId), [db.people, selectedEntityId]);

  function selectEntity(id: string) { setSelectedEntityId(id); setItemIndex(0); setPanel(null); setLinkMore(null); }
  function switchEntity(delta: 1 | -1) {
    if (!railEntities.length) return;
    const idx = railEntities.findIndex((e) => e.id === selectedEntityId);
    selectEntity(railEntities[(idx + delta + railEntities.length) % railEntities.length].id);
  }

  // ---- triage actions (all undoable) ----
  function classify(item: Interaction, classification: Classification) {
    const prev = { classification: item.classification, needs_review: item.needs_review };
    updateInteraction(item.id, { classification, needs_review: false });
    pushUndo({ type: 'editInteraction', interactionId: item.id, prev }, `Classificado: ${classification}`);
  }
  function confirmNoSignal(item: Interaction) {
    const prev = { needs_review: item.needs_review };
    updateInteraction(item.id, { needs_review: false });
    pushUndo({ type: 'editInteraction', interactionId: item.id, prev }, 'Sem sinal — resolvido');
  }

  function openEdit(item: Interaction) {
    setEditDraft({
      content: item.content,
      date: isPlaceholderDate(item.occurred_at) ? '' : item.occurred_at.slice(0, 10),
      channel: item.channel, direction: item.direction,
      classification: item.classification ?? '',
    });
    setPanel({ itemId: item.id, kind: 'edit' });
  }
  function saveEdit(item: Interaction) {
    const patch: Partial<Interaction> = {};
    const prev: Partial<Interaction> = {};
    if (editDraft.content !== item.content) { patch.content = editDraft.content; prev.content = item.content; }
    if (editDraft.date && `${editDraft.date}T12:00:00.000Z` !== item.occurred_at) { patch.occurred_at = `${editDraft.date}T12:00:00.000Z`; prev.occurred_at = item.occurred_at; }
    if (editDraft.channel !== item.channel) { patch.channel = editDraft.channel; prev.channel = item.channel; }
    if (editDraft.direction !== item.direction) { patch.direction = editDraft.direction; prev.direction = item.direction; }
    const newClass = editDraft.classification || undefined;
    if (newClass !== item.classification) { patch.classification = newClass; prev.classification = item.classification; }
    if (Object.keys(patch).length) {
      updateInteraction(item.id, patch);
      pushUndo({ type: 'editInteraction', interactionId: item.id, prev }, 'Item editado');
    }
    setPanel(null);
  }
  function acceptDateSuggestion(item: Interaction, isoDate: string) {
    const prev = { occurred_at: item.occurred_at };
    updateInteraction(item.id, { occurred_at: `${isoDate}T12:00:00.000Z` });
    pushUndo({ type: 'editInteraction', interactionId: item.id, prev }, `Data corrigida: ${isoDate}`);
  }

  function onPersonCreated(item: Interaction, personId: string, personName: string) {
    const prevPersonId = item.person_id;
    updateInteraction(item.id, { person_id: personId });
    pushUndo({ type: 'routePerson', personId, links: [{ interactionId: item.id, prevPersonId }] }, `Pessoa criada: ${personName}`);
    const candidateIds = thread.filter((i) => i.channel !== 'stage_change' && !i.person_id && i.id !== item.id).map((i) => i.id);
    setPanel(null);
    if (candidateIds.length) setLinkMore({ personId, personName, candidateIds });
  }
  function linkRestToPerson() {
    if (!linkMore) return;
    // Rebuild the full link set for undo: the original source (captured in
    // lastAction) plus every item we're now linking. The rest were
    // unassigned (prevPersonId undefined).
    const sourceLinks = (lastAction && lastAction.type === 'routePerson') ? lastAction.links : [];
    for (const id of linkMore.candidateIds) updateInteraction(id, { person_id: linkMore.personId });
    const allLinks = [...sourceLinks, ...linkMore.candidateIds.map((id) => ({ interactionId: id, prevPersonId: undefined }))];
    pushUndo({ type: 'routePerson', personId: linkMore.personId, links: allLinks }, `Pessoa criada + ${linkMore.candidateIds.length} itens vinculados`);
    setLinkMore(null);
  }

  function saveEntityData(item: Interaction) {
    if (!entity) return;
    // Card-format fields ("Email: X / Telefone: Y / …") first, then a bare
    // email out of prose as a fallback — this action can be invoked on ANY
    // item, not just a detected contact card (Alantra's email lives in a
    // sentence, not a labelled card).
    const parsed = parseMetadataCard(item.content);
    const email = parsed.email ?? parsePersonHint(item.content).email;
    const domain = email?.match(/@([^@\s]+)$/)?.[1]?.toLowerCase();
    const entityRec = entity as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const prevEntity: Record<string, unknown> = {};
    const fill = (field: 'email' | 'phone' | 'address' | 'website' | 'email_domain', value?: string) => {
      if (value && !entityRec[field]) {
        patch[field] = value;
        prevEntity[field] = entityRec[field];
      }
    };
    // email/phone/address are migration-0024 columns — only fill them when
    // the workspace has them; website/email_domain/notes predate 0024.
    if (contactFieldsAvailable) {
      fill('email', email);
      fill('phone', parsed.telefone);
      fill('address', parsed.endereco);
    }
    fill('website', parsed.website);
    fill('email_domain', parsed.emailDomain ?? domain);
    const dateStr = new Date().toISOString().slice(0, 10);
    const noteBlock = `Ficha de contacto (importada) — ${dateStr}\n${item.content}`;
    patch.notes = entity.notes ? `${entity.notes}\n\n${noteBlock}` : noteBlock;
    prevEntity.notes = entity.notes;

    updateEntity(entity.id, patch as Partial<typeof entity>);
    const prevNeedsReview = item.needs_review ?? false;
    updateInteraction(item.id, { needs_review: false });
    pushUndo({ type: 'routeEntityData', entityId: entity.id, interactionId: item.id, prevEntity: prevEntity as Partial<typeof entity>, prevNeedsReview }, 'Dados guardados na entidade');
    setPanel(null);
  }

  function openAddInteraction(item: Interaction) {
    setAddDraft({ date: '', channel: 'meeting', direction: 'out', content: '', personId: item.person_id ?? '' });
    setPanel({ itemId: item.id, kind: 'addInteraction' });
  }
  function saveAddInteraction() {
    if (!entity || !addDraft.content.trim() || !addDraft.date) return;
    const created = addInteraction({
      entity_id: entity.id, person_id: addDraft.personId || undefined,
      occurred_at: `${addDraft.date}T12:00:00.000Z`, direction: addDraft.direction,
      channel: addDraft.channel, content: addDraft.content.trim(),
    });
    pushUndo({ type: 'addInteraction', interactionId: created.id }, 'Interação adicionada ao fio');
    setPanel(null);
  }

  function acceptAllProposals() {
    for (const item of pendingItems) {
      const p = proposalsById[item.id];
      if (!p) continue;
      if (p.kind === 'metadata_card') {
        const parsed = parseMetadataCard(item.content);
        if (parsed.emailDomain || parsed.website) applyMetadataCard(item.entity_id, item.id, parsed, item.content, 'ai');
      } else if (p.proposedClassification) {
        classifyInteraction(item.id, p.proposedClassification, undefined, undefined, 'ai');
        clearNeedsReview(item.id);
      }
    }
  }

  async function runClassificationPass() {
    setPassRunning(true);
    setPassSummary(null);
    const summary: PassSummary = { metadata: 0, mechanical: 0, aiHigh: 0, queued: 0 };
    const nextProposals: Record<string, Proposal> = {};
    const stillPendingByEntity = new Map<string, Interaction[]>();

    for (const it of db.interactions.filter((i) => i.needs_review)) {
      if (looksLikeMetadataCard(it.content)) {
        const parsed = parseMetadataCard(it.content);
        applyMetadataCard(it.entity_id, it.id, parsed, it.content, 'mechanical');
        nextProposals[it.id] = { kind: 'metadata_card', confidence: 'high', reason: 'Detected a contact-details card (email + phone/address/source URL) — not a real outreach signal.', classifiedBy: 'mechanical' };
        summary.metadata++;
        continue;
      }
      const mech = classifyMechanically(it, db.interactions.filter((x) => x.entity_id === it.entity_id));
      if (mech) {
        classifyInteraction(it.id, mech.classification, undefined, undefined, 'mechanical');
        clearNeedsReview(it.id);
        nextProposals[it.id] = { kind: 'interaction', proposedClassification: mech.classification, confidence: 'high', reason: mech.reason, classifiedBy: 'mechanical' };
        summary.mechanical++;
        continue;
      }
      stillPendingByEntity.set(it.entity_id, [...(stillPendingByEntity.get(it.entity_id) ?? []), it]);
    }
    setProposalsById((prev) => ({ ...prev, ...nextProposals }));

    const entityIds = [...stillPendingByEntity.keys()];
    setPassProgress({ done: 0, total: entityIds.length });

    for (let i = 0; i < entityIds.length; i++) {
      const entityId = entityIds[i];
      const items = stillPendingByEntity.get(entityId)!;
      try {
        const res = await fetch('/api/needs-review/classify-entity', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entityId, interactions: items.map((it) => ({ id: it.id, direction: it.direction, channel: it.channel, content: it.content, occurredAt: it.occurred_at })) }),
        });
        const body = await res.json();
        if (body.ok && body.proposals) {
          const applied: Record<string, Proposal> = {};
          for (const p of body.proposals as AiClassificationProposal[]) {
            const target = items.find((it) => it.id === p.interactionId);
            if (!target) continue;
            const parsedCard = p.kind === 'metadata_card' ? parseMetadataCard(target.content) : undefined;
            const decision = decideAutoApply(p, parsedCard);
            if (decision === 'metadata' && parsedCard) {
              applyMetadataCard(target.entity_id, target.id, parsedCard, target.content, 'ai');
              summary.aiHigh++;
            } else if (decision === 'classify' && p.proposedClassification) {
              classifyInteraction(target.id, p.proposedClassification, undefined, undefined, 'ai');
              clearNeedsReview(target.id);
              summary.aiHigh++;
            } else {
              summary.queued++;
            }
            applied[p.interactionId] = { kind: p.kind, proposedClassification: p.proposedClassification, confidence: p.confidence, reason: p.reason, classifiedBy: 'ai' };
          }
          setProposalsById((prev) => ({ ...prev, ...applied }));
        }
      } catch {
        summary.queued += items.length;
      }
      setPassProgress({ done: i + 1, total: entityIds.length });
    }

    setPassSummary(summary);
    setPassRunning(false);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
      if (e.key === 'u') { performUndo(); return; }
      if (e.key === 'j') setItemIndex((i) => Math.min(i + 1, Math.max(pendingItems.length - 1, 0)));
      else if (e.key === 'k') setItemIndex((i) => Math.max(i - 1, 0));
      else if (e.key === 'J' || e.key === 'n') switchEntity(1);
      else if (e.key === 'K' || e.key === 'p') switchEntity(-1);
      else if (e.key === 'e' && focused) openEdit(focused);
      else if (e.key === 'a') acceptAllProposals();
      else if (e.key === 'r' && focused) confirmNoSignal(focused);
      else {
        const hit = CLASSIFY_KEYS.find((c) => c.key === e.key);
        if (hit && focused) classify(focused, hit.classification);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, pendingItems.length, railEntities, selectedEntityId, proposalsById, lastAction, editDraft, addDraft, linkMore, entity, contactFieldsAvailable]);

  if (railEntities.length === 0 && !passRunning) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Needs review</h1>
          <button onClick={() => setRailMode(railMode === 'pending' ? 'ai_classified' : 'pending')}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
            {railMode === 'pending' ? `AI-classified (${totalAiClassified})` : `Back to pending`}
          </button>
        </div>
        {undoLabel && <UndoBar label={undoLabel} onUndo={performUndo} />}
        <Card><p className="text-sm text-gray-400">
          {railMode === 'pending' ? 'Queue clear — every imported interaction has been confirmed.' : 'No AI-classified interactions yet.'}
        </p></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Needs review</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">{totalPending} pending · {totalAiClassified} AI-classified</span>
          <button onClick={() => setRailMode(railMode === 'pending' ? 'ai_classified' : 'pending')}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
            {railMode === 'pending' ? 'Show AI-classified' : 'Show pending'}
          </button>
          {aiAvailable && (
            <Tooltip text="Runs a deterministic pass first (free), then one AI call per entity that still has ambiguous items. High-confidence proposals auto-apply; the rest stay queued with the AI's reasoning shown.">
              <button disabled={passRunning} onClick={runClassificationPass}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-40">
                {passRunning ? 'Running…' : '✨ Run pre-classification pass'}
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {undoLabel && <UndoBar label={undoLabel} onUndo={performUndo} />}

      {aiAvailable === false && (
        <p className="text-xs text-gray-400">AI pre-classification isn’t available in this workspace yet — manual review below works as normal.</p>
      )}
      {passProgress && (
        <p className="text-xs text-gray-500">{passProgress.done}/{passProgress.total} entities processed{passRunning ? '…' : ' — done.'}</p>
      )}
      {passSummary && (
        <Card>
          <p className="text-sm text-gray-700">
            Auto-applied: <b>{passSummary.metadata}</b> contact cards, <b>{passSummary.mechanical}</b> mechanical (no-reply threads), <b>{passSummary.aiHigh}</b> AI high-confidence.
            {' '}<b>{passSummary.queued}</b> left for human review.
          </p>
        </Card>
      )}

      <p className="text-xs text-gray-400">
        Keyboard: <b>j</b>/<b>k</b> item · <b>J</b>/<b>K</b> entity · <b>1</b>/<b>2</b>/<b>3</b> classify · <b>r</b> no signal · <b>e</b> edit · <b>a</b> accept proposals · <b>u</b> undo.
      </p>

      <div className="flex gap-4">
        <div className="w-64 shrink-0 space-y-1 overflow-y-auto" style={{ maxHeight: '70vh' }}>
          {railEntities.map((e) => (
            <button key={e.id} onClick={() => selectEntity(e.id)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${e.id === selectedEntityId ? 'bg-[#0E7490] text-white' : 'hover:bg-gray-50 text-gray-700'}`}>
              <span className="truncate">{e.name}</span>
              <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${e.id === selectedEntityId ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                {countsForRail.get(e.id)}
              </span>
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-3">
          {entity && (
            <div className="flex items-center justify-between">
              <EntityLink id={entity.id}><span className="text-base font-semibold">{entity.name}</span></EntityLink>
              {pendingItems.some((i) => proposalsById[i.id]) && (
                <button onClick={acceptAllProposals} className="rounded-lg border border-cyan-200 px-3 py-1.5 text-xs text-cyan-800 hover:bg-cyan-50">
                  a · Accept all proposals in this dossier
                </button>
              )}
            </div>
          )}

          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '70vh' }}>
            {thread.map((item) => {
              const isFocused = focused?.id === item.id;
              const proposal = proposalsById[item.id];
              const placeholder = isPlaceholderDate(item.occurred_at);
              const suggestion = placeholder ? suggestDateFromContent(item.content) : undefined;
              const person = item.person_id ? db.people.find((p) => p.id === item.person_id) : undefined;
              const editing = panel?.itemId === item.id && panel.kind === 'edit';
              return (
                <Card key={item.id}>
                  <div className={`rounded-lg p-2 ${isFocused ? 'ring-2 ring-[#0E7490]' : ''}`}>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                      {placeholder ? (
                        <Tooltip text="A data original não veio no import (fonte marcada '(sem data)') — ficou com um marcador 2018-01-01. Corrige com a sugestão ou editando.">
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">data por confirmar</span>
                        </Tooltip>
                      ) : (
                        <span>{item.occurred_at.slice(0, 10)}</span>
                      )}
                      {suggestion && (
                        <button onClick={() => acceptDateSuggestion(item, suggestion)}
                          className="rounded bg-cyan-100 px-1.5 py-0.5 font-semibold text-cyan-800 hover:bg-cyan-200">
                          📅 usar {suggestion}
                        </button>
                      )}
                      <span>· {item.channel.replace('_', ' ')}</span>
                      <span>· {item.direction === 'out' ? 'outbound' : 'inbound'}</span>
                      <span>· {item.classification ?? '—'}</span>
                      {person && <span>· 👤 {person.full_name}</span>}
                      {item.classified_by && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CLASSIFIED_BY_STYLE[item.classified_by]}`}>
                          {item.classified_by === 'ai' ? 'AI-classified' : 'mechanical'}
                        </span>
                      )}
                      {item.classified_by && (
                        <button onClick={() => revertToNeedsReview(item.id)} className="text-[10px] text-gray-400 underline hover:text-gray-600">↩ back to review</button>
                      )}
                      <button onClick={() => (editing ? setPanel(null) : openEdit(item))} className="ml-auto text-[10px] text-cyan-700 hover:underline">
                        {editing ? 'cancel' : 'e · edit'}
                      </button>
                    </div>

                    {editing ? (
                      <div className="mt-2 space-y-2 rounded-lg border border-cyan-100 bg-cyan-50/40 p-2">
                        <textarea value={editDraft.content} onChange={(e) => setEditDraft({ ...editDraft, content: e.target.value })} rows={3}
                          className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <label className="flex items-center gap-1">Data
                            <input type="date" value={editDraft.date} onChange={(e) => setEditDraft({ ...editDraft, date: e.target.value })}
                              className="rounded border border-gray-300 px-1.5 py-1" />
                          </label>
                          {suggestion && (
                            <button onClick={() => setEditDraft({ ...editDraft, date: suggestion })} className="rounded bg-cyan-100 px-1.5 py-0.5 font-semibold text-cyan-800 hover:bg-cyan-200">
                              usar {suggestion}
                            </button>
                          )}
                          <select value={editDraft.channel} onChange={(e) => setEditDraft({ ...editDraft, channel: e.target.value as Channel })} className="rounded border border-gray-300 px-1.5 py-1">
                            {CHANNELS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                          </select>
                          <select value={editDraft.direction} onChange={(e) => setEditDraft({ ...editDraft, direction: e.target.value as Direction })} className="rounded border border-gray-300 px-1.5 py-1">
                            <option value="out">outbound</option><option value="in">inbound</option>
                          </select>
                          <select value={editDraft.classification} onChange={(e) => setEditDraft({ ...editDraft, classification: e.target.value as Classification | '' })} className="rounded border border-gray-300 px-1.5 py-1">
                            <option value="">— sem classificação</option>
                            {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                          </select>
                        </div>
                        <button onClick={() => saveEdit(item)} className="rounded-lg bg-[#0E7490] px-3 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">Guardar</button>
                      </div>
                    ) : (
                      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-sm text-gray-700">{item.content}</p>
                    )}

                    {proposal && item.needs_review && (
                      <p className="mt-2 text-xs italic text-purple-700">
                        AI suggests {proposal.kind === 'metadata_card' ? 'this is a contact card' : (proposal.proposedClassification ?? 'no classification')} ({proposal.confidence} confidence) — {proposal.reason}
                      </p>
                    )}

                    {item.needs_review && !editing && (
                      <>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {CLASSIFY_KEYS.map((c) => (
                            <button key={c.key} onClick={() => classify(item, c.classification)}
                              className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b] ${proposal?.proposedClassification === c.classification ? 'bg-purple-700' : 'bg-[#0E7490]'}`}>
                              {c.key} · {c.label}
                            </button>
                          ))}
                          <button onClick={() => confirmNoSignal(item)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">r · No real signal</button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <button onClick={() => setPanel({ itemId: item.id, kind: 'person' })} className="rounded border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50">👤 Criar pessoa daqui</button>
                          <button onClick={() => saveEntityData(item)} className="rounded border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50">🏢 Guardar como dados da entidade</button>
                          <button onClick={() => openAddInteraction(item)} className="rounded border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50">➕ Adicionar interação ao fio</button>
                        </div>
                      </>
                    )}

                    {panel?.itemId === item.id && panel.kind === 'person' && entity && (() => {
                      const hint = parsePersonHint(item.content);
                      return (
                        <QuickCreatePerson entityId={entity.id} initialName={hint.name} initialEmail={hint.email}
                          onCreated={(pid) => onPersonCreated(item, pid, db.people.find((p) => p.id === pid)?.full_name ?? hint.name ?? 'pessoa')}
                          onCancel={() => setPanel(null)} />
                      );
                    })()}

                    {panel?.itemId === item.id && panel.kind === 'addInteraction' && (
                      <div className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <input type="date" value={addDraft.date} onChange={(e) => setAddDraft({ ...addDraft, date: e.target.value })} className="rounded border border-gray-300 px-1.5 py-1" />
                          <select value={addDraft.channel} onChange={(e) => setAddDraft({ ...addDraft, channel: e.target.value as Channel })} className="rounded border border-gray-300 px-1.5 py-1">
                            {CHANNELS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                          </select>
                          <select value={addDraft.direction} onChange={(e) => setAddDraft({ ...addDraft, direction: e.target.value as Direction })} className="rounded border border-gray-300 px-1.5 py-1">
                            <option value="out">outbound</option><option value="in">inbound</option>
                          </select>
                          <select value={addDraft.personId} onChange={(e) => setAddDraft({ ...addDraft, personId: e.target.value })} className="rounded border border-gray-300 px-1.5 py-1">
                            <option value="">— sem pessoa</option>
                            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                          </select>
                        </div>
                        <textarea value={addDraft.content} onChange={(e) => setAddDraft({ ...addDraft, content: e.target.value })} rows={2}
                          placeholder="O que aconteceu — ex. 'Reunião remota, mostraram interesse mas queriam ver tração.'"
                          className="w-full rounded border border-gray-300 p-2" />
                        <div className="flex gap-2">
                          <button disabled={!addDraft.content.trim() || !addDraft.date} onClick={saveAddInteraction}
                            className="rounded bg-[#0E7490] px-2 py-1 font-medium text-white disabled:opacity-40">Adicionar</button>
                          <button onClick={() => setPanel(null)} className="rounded border border-gray-300 px-2 py-1">Cancelar</button>
                        </div>
                      </div>
                    )}

                    {linkMore && lastAction?.type === 'routePerson' && lastAction.links[0]?.interactionId === item.id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
                        <span>{linkMore.candidateIds.length} outros itens neste dossier sem pessoa — vincular a {linkMore.personName}?</span>
                        <button onClick={linkRestToPerson} className="rounded bg-[#0E7490] px-2 py-1 font-medium text-white">Sim, vincular</button>
                        <button onClick={() => setLinkMore(null)} className="rounded border border-gray-300 bg-white px-2 py-1">Não</button>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function UndoBar({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
      <span className="text-gray-600">✔ {label}</span>
      <button onClick={onUndo} className="ml-auto rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100">↩ Desfazer (u)</button>
    </div>
  );
}
