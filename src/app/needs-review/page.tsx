'use client';
// Needs-review redesign (founder feedback after real use, 23 Jul): the
// original one-card-at-a-time flow (~380 cards) was unworkable — the real
// unit of work is the entity DOSSIER, not the interaction. This view groups
// by entity (left rail, pending counts), shows the FULL chronological
// imported thread per entity (reviewed or not, for context), lets text be
// edited inline, and — capability-gated on migration 0021
// (interactions.classified_by, entities.notes) — runs an AI/mechanical
// pre-classification pass that auto-applies high-confidence proposals and
// only leaves genuinely ambiguous items in the human queue.
//
// Auto-apply rule (see src/lib/needs-review-logic.ts, the single source of
// truth for this): a metadata_card (a contact-details dump, not a real
// outreach signal) fills empty entity fields + files a note, once the regex
// can back up an actual email/website — never on the model's say-so alone.
// A real interaction only auto-applies at high confidence. Everything else
// stays queued, proposal + reason shown alongside, one click to accept.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, EntityLink, Tooltip } from '@/components/ui';
import type { Classification, Interaction } from '@/lib/types';
import {
  classifyMechanically, decideAutoApply, looksLikeMetadataCard, parseMetadataCard,
  type AiClassificationProposal,
} from '@/lib/needs-review-logic';

const CLASSIFY_KEYS: { key: string; classification: Classification; label: string }[] = [
  { key: '1', classification: 'interested', label: 'Interested' },
  { key: '2', classification: 'meeting_request', label: 'Meeting request' },
  { key: '3', classification: 'question', label: 'Question' },
];

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

export default function NeedsReviewPage() {
  const {
    db, classifyInteraction, clearNeedsReview, updateInteractionContent,
    revertToNeedsReview, applyMetadataCard,
  } = useStore();

  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((me) => setAiAvailable(!!me.capabilities?.needsReviewAi)).catch(() => setAiAvailable(false));
  }, []);

  const [railMode, setRailMode] = useState<'pending' | 'ai_classified'>('pending');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [itemIndex, setItemIndex] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [proposalsById, setProposalsById] = useState<Record<string, Proposal>>({});
  const [passRunning, setPassRunning] = useState(false);
  const [passProgress, setPassProgress] = useState<{ done: number; total: number } | null>(null);
  const [passSummary, setPassSummary] = useState<PassSummary | null>(null);

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
    return db.entities
      .filter((e) => countsForRail.has(e.id))
      .sort((a, b) => a.name.localeCompare(b.name));
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
    return db.interactions
      .filter((i) => i.entity_id === selectedEntityId)
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  }, [db.interactions, selectedEntityId]);

  const pendingItems = useMemo(() => thread.filter((i) => i.needs_review), [thread]);

  useEffect(() => {
    if (itemIndex >= pendingItems.length && pendingItems.length > 0) setItemIndex(pendingItems.length - 1);
    if (pendingItems.length === 0) setItemIndex(0);
  }, [pendingItems.length, itemIndex]);

  const focused = pendingItems[itemIndex];
  const entity = selectedEntityId ? db.entities.find((e) => e.id === selectedEntityId) : undefined;

  function selectEntity(id: string) {
    setSelectedEntityId(id);
    setItemIndex(0);
  }

  function switchEntity(delta: 1 | -1) {
    if (!railEntities.length) return;
    const idx = railEntities.findIndex((e) => e.id === selectedEntityId);
    const next = railEntities[(idx + delta + railEntities.length) % railEntities.length];
    selectEntity(next.id);
  }

  function classify(target: Interaction, classification: Classification) {
    classifyInteraction(target.id, classification);
    clearNeedsReview(target.id);
  }

  function confirmNoSignal(target: Interaction) {
    clearNeedsReview(target.id);
  }

  function startEdit(item: Interaction) {
    setEditingId(item.id);
    setEditText(item.content);
  }

  function saveEdit() {
    if (!editingId) return;
    updateInteractionContent(editingId, editText);
    setEditingId(null);
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

    // Deterministic pass first — free, instant, no AI call. Only what's left
    // afterward ever reaches the model (the cost guard).
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
          body: JSON.stringify({
            entityId,
            interactions: items.map((it) => ({ id: it.id, direction: it.direction, channel: it.channel, content: it.content, occurredAt: it.occurred_at })),
          }),
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
        // A single entity's AI call failing shouldn't stop the pass — its
        // items simply stay in the queue, same as a low-confidence proposal.
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
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      if (e.key === 'j') setItemIndex((i) => Math.min(i + 1, Math.max(pendingItems.length - 1, 0)));
      else if (e.key === 'k') setItemIndex((i) => Math.max(i - 1, 0));
      else if (e.key === 'J' || e.key === 'n') switchEntity(1);
      else if (e.key === 'K' || e.key === 'p') switchEntity(-1);
      else if (e.key === 'e' && focused) startEdit(focused);
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
  }, [focused, pendingItems.length, railEntities, selectedEntityId, proposalsById]);

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

      {aiAvailable === false && (
        <p className="text-xs text-gray-400">AI pre-classification isn’t available in this workspace yet — manual review below works as normal.</p>
      )}
      {passProgress && (
        <p className="text-xs text-gray-500">
          {passProgress.done}/{passProgress.total} entities processed{passRunning ? '…' : ' — done.'}
        </p>
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
        Keyboard: <b>j</b>/<b>k</b> item · <b>J</b>/<b>K</b> (or <b>n</b>/<b>p</b>) entity · <b>1</b>/<b>2</b>/<b>3</b> classify · <b>r</b> no signal · <b>e</b> edit text · <b>a</b> accept all proposals in this dossier.
      </p>

      <div className="flex gap-4">
        <div className="w-64 shrink-0 space-y-1 overflow-y-auto" style={{ maxHeight: '70vh' }}>
          {railEntities.map((e) => (
            <button key={e.id} onClick={() => selectEntity(e.id)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                e.id === selectedEntityId ? 'bg-[#0E7490] text-white' : 'hover:bg-gray-50 text-gray-700'}`}>
              <span className="truncate">{e.name}</span>
              <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                e.id === selectedEntityId ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
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

          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '65vh' }}>
            {thread.map((item) => {
              const isFocused = focused?.id === item.id;
              const proposal = proposalsById[item.id];
              return (
                <Card key={item.id}>
                  <div className={`rounded-lg p-2 ${isFocused ? 'ring-2 ring-[#0E7490]' : ''}`}>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                      <span>{item.occurred_at.slice(0, 10)}</span>
                      <span>· {item.channel.replace('_', ' ')}</span>
                      <span>· {item.direction === 'out' ? 'outbound' : 'inbound'}</span>
                      <span>· classification: {item.classification ?? '—'}</span>
                      {item.classified_by && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CLASSIFIED_BY_STYLE[item.classified_by]}`}>
                          {item.classified_by === 'ai' ? 'AI-classified' : 'mechanical'}
                        </span>
                      )}
                      {item.classified_by && (
                        <button onClick={() => revertToNeedsReview(item.id)} className="text-[10px] text-gray-400 underline hover:text-gray-600">
                          ↩ back to review
                        </button>
                      )}
                      <button onClick={() => (editingId === item.id ? setEditingId(null) : startEdit(item))} className="ml-auto text-[10px] text-cyan-700 hover:underline">
                        {editingId === item.id ? 'cancel' : 'e · edit'}
                      </button>
                    </div>

                    {editingId === item.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3}
                          className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
                        <button onClick={saveEdit} className="rounded-lg bg-[#0E7490] px-3 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">Save</button>
                      </div>
                    ) : (
                      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-sm text-gray-700">{item.content}</p>
                    )}

                    {proposal && item.needs_review && (
                      <p className="mt-2 text-xs italic text-purple-700">
                        AI suggests {proposal.kind === 'metadata_card' ? 'this is a contact card' : (proposal.proposedClassification ?? 'no classification')} ({proposal.confidence} confidence) — {proposal.reason}
                      </p>
                    )}

                    {item.needs_review && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {CLASSIFY_KEYS.map((c) => (
                          <Tooltip key={c.key} text={`Reclassify as ${c.label.toLowerCase()} and clear the review flag. (key: ${c.key})`}>
                            <button onClick={() => classify(item, c.classification)}
                              className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b] ${
                                proposal?.proposedClassification === c.classification ? 'bg-purple-700' : 'bg-[#0E7490]'}`}>
                              {c.key} · {c.label}
                            </button>
                          </Tooltip>
                        ))}
                        <Tooltip text="Leaves the classification as-is — just confirms there was no positive signal here. (key: r)">
                          <button onClick={() => confirmNoSignal(item)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                            r · No real signal
                          </button>
                        </Tooltip>
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
