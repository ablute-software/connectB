'use client';
// Prompt 894 — "Terms on the table": replaces TermsOnTheTablePlaceholder.tsx
// in both dossier surfaces (EntityDossierPanel.tsx, entities/[id]/page.tsx)
// and (in a read-only, no-actions mode) in people/[id]/prep/page.tsx.
//
// Founder-privacy audit (CLAUDE.md root rule), stated here because this is
// the one file that could get this wrong: this component's data (ticket
// sizes, valuations, negotiation state) is read directly from db.dealTerms
// and rendered to React — it is NEVER passed into buildComposerContext
// (src/lib/composer.ts) or any /api/compose request body. That matters
// because /api/compose's output is the literal outbound message text sent
// to (and read by) the investor — a single-audience artifact — so handing
// it any deal_terms-derived signal, even a topic label with no amount,
// would be the exact class of leak the root rule prohibits (the 2026-08-16
// investor-visible-SWOT incident it names). §D's "Watson... para não pedir
// de novo o que já foi oferecido" is instead served by
// topicsAlreadyOnTheTable() (deal-terms.ts) rendered as a plain, founder-
// only hint next to RailLogForm's composer — see that file's own wiring —
// never fed to the model. This component is likewise never rendered on any
// investor-facing route (it is only ever mounted from the founder's own
// Pipeline panel, full dossier, and meeting-prep page).
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, fmtEur } from '@/components/ui';
import { buildDealMemoSummary, checkLockPreconditions, currentTermsForEntity, type DealMemoPayload } from '@/lib/deal-terms';
import { DealTimelineChart } from './DealTimelineChart';
import type { DealTerm, DealTermFormality, DealTermKind, DealTermSide } from '@/lib/types';

const KIND_LABEL: Record<DealTermKind, string> = {
  ask: 'Ask', offer: 'Offer', commitment: 'Commitment', valuation: 'Valuation',
  instrument: 'Instrument', lead_role: 'Lead/follower', ticket_range: 'Ticket range',
  timing: 'Timing', other: 'Other',
};
const FORMALITY_LABEL: Record<DealTermFormality, string> = {
  mentioned: 'Mentioned', negotiating: 'Negotiating', agreed: 'Agreed',
};
const FORMALITY_STYLE: Record<DealTermFormality, string> = {
  mentioned: 'bg-gray-100 text-gray-600', negotiating: 'bg-amber-100 text-amber-800', agreed: 'bg-green-100 text-green-800',
};

interface TermsOnTheTableProps {
  entityId: string;
  // Founder-only navigation into the History sub-tab, already owned by both
  // call sites (RelationshipSummaryCard's own onViewInHistory uses the same
  // shape) — optional so a read-only host (the meeting-prep one-pager,
  // which has no History tab of its own) can omit it.
  onViewInteraction?: (interactionId: string) => void;
  // people/[id]/prep/page.tsx renders this without any editing affordance —
  // still with the table and the chart, since "preparação de reunião lê
  // Terms on the table" (§D) is about READING what's already on record.
  readOnly?: boolean;
}

export function TermsOnTheTable({ entityId, onViewInteraction, readOnly }: TermsOnTheTableProps) {
  const { db, addDealTerm, supersedeDealTerm, lockDealTerms, reopenNegotiation } = useStore();
  const entity = db.entities.find((e) => e.id === entityId);
  const people = db.people.filter((p) => p.entity_id === entityId);
  const interactions = db.interactions.filter((i) => i.entity_id === entityId && i.channel !== 'stage_change');
  const memos = db.documents.filter((d) => d.kind === 'deal_memo' && d.entity_id === entityId)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DealTerm | null>(null);
  const [locking, setLocking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [expandedMemo, setExpandedMemo] = useState<string | null>(null);

  if (!entity) return null;
  const current = currentTermsForEntity(db.dealTerms, entityId);
  const locked = !!entity.negotiation_locked_at;
  const lockCheck = checkLockPreconditions(db.dealTerms, entityId);

  // §B — "pessoa (default a última contactada)".
  const lastContactedPersonId = [...interactions].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0]?.person_id;

  async function handleLock() {
    setBusy(true); setErr('');
    const res = await lockDealTerms(entityId);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    setLocking(false);
  }

  async function handleReopen() {
    setBusy(true); setErr('');
    const res = await reopenNegotiation(entityId);
    setBusy(false);
    if (res.error) setErr(res.error);
  }

  async function quickChangeStatus(term: DealTerm, formality: DealTermFormality) {
    setBusy(true); setErr('');
    const res = await supersedeDealTerm(term.id, { formality });
    setBusy(false);
    if (res.error) setErr(res.error);
  }

  return (
    <Card title="Terms on the table" right={locked ? (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">🔒 Locked</span>
    ) : undefined}>
      {err && <div className="mb-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-[#B00000]">{err}</div>}

      {locked && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <span>Negotiation locked since {entity.negotiation_locked_at?.slice(0, 10)} — terms are archived.{' '}
            {memos[0] && <button onClick={() => setExpandedMemo(memos[0].id)} className="font-medium text-cyan-700 hover:underline">View deal memo →</button>}
          </span>
          {!readOnly && (
            <button onClick={handleReopen} disabled={busy}
              className="ml-auto rounded border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Reopen negotiation
            </button>
          )}
        </div>
      )}

      {current.length === 0 ? (
        <p className="text-sm text-gray-400">No terms recorded yet.{!readOnly && !locked && ' Add one below as the conversation moves.'}</p>
      ) : (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400">
                <th className="py-1 pr-2 font-medium">Date</th>
                <th className="py-1 pr-2 font-medium">Side</th>
                <th className="py-1 pr-2 font-medium">Type</th>
                <th className="py-1 pr-2 font-medium">Value</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                <th className="py-1 pr-2 font-medium">Person</th>
                {!readOnly && <th className="py-1 pr-2 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {current.map((t) => {
                const person = t.person_id ? people.find((p) => p.id === t.person_id) : undefined;
                return (
                  <tr key={t.id} className="border-b border-gray-50">
                    <td className="py-1.5 pr-2 text-gray-500">{(t.effective_at ?? t.recorded_at).slice(0, 10)}</td>
                    <td className="py-1.5 pr-2">{t.side === 'ours' ? 'Us' : 'Them'}</td>
                    <td className="py-1.5 pr-2">{KIND_LABEL[t.kind]}</td>
                    <td className="py-1.5 pr-2 font-medium text-gray-800">{t.amount_eur != null ? fmtEur(t.amount_eur) : t.text ?? '—'}</td>
                    <td className="py-1.5 pr-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${FORMALITY_STYLE[t.formality]}`}>{FORMALITY_LABEL[t.formality]}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-gray-500">
                      {person?.full_name ?? '—'}
                      {t.interaction_id && (
                        onViewInteraction ? (
                          <button onClick={() => onViewInteraction(t.interaction_id!)} className="ml-1 text-cyan-700 hover:underline">· from interaction</button>
                        ) : <span className="ml-1 text-gray-400">· from interaction</span>
                      )}
                    </td>
                    {!readOnly && (
                      <td className="py-1.5 pr-2 text-right">
                        {!locked && (
                          <div className="flex justify-end gap-1.5">
                            <button onClick={() => setEditing(t)} className="text-cyan-700 hover:underline">Edit</button>
                            {t.formality !== 'agreed' && (
                              <button onClick={() => quickChangeStatus(t, t.formality === 'mentioned' ? 'negotiating' : 'agreed')} disabled={busy}
                                className="text-cyan-700 hover:underline disabled:opacity-50">
                                Mark {t.formality === 'mentioned' ? 'Negotiating' : 'Agreed'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <DealTimelineChart terms={current} />

      {memos.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Deal memos</div>
          {memos.map((m) => (
            <div key={m.id} className="text-xs">
              <button onClick={() => setExpandedMemo(expandedMemo === m.id ? null : m.id)} className="font-medium text-cyan-700 hover:underline">
                {m.name}
              </button>
              {expandedMemo === m.id && (
                <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 p-2.5 text-[11px] text-gray-700">{m.notes}</pre>
              )}
            </div>
          ))}
        </div>
      )}

      {!readOnly && !locked && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2.5">
          <button onClick={() => setAdding(true)} className="rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 hover:border-[#0E7490] hover:text-[#0E7490]">
            + Add term
          </button>
          <button onClick={() => setLocking(true)} disabled={!lockCheck.canLock || busy}
            title={lockCheck.blockedReason}
            className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">
            Lock terms
          </button>
        </div>
      )}

      {adding && (
        <TermForm entityId={entityId} people={people} interactions={interactions} defaultPersonId={lastContactedPersonId}
          onCancel={() => setAdding(false)}
          onSave={async (draft) => {
            setBusy(true); setErr('');
            const res = await addDealTerm({ entityId, ...draft });
            setBusy(false);
            if (res.error) { setErr(res.error); return; }
            setAdding(false);
          }} />
      )}
      {editing && (
        <TermForm entityId={entityId} people={people} interactions={interactions} existing={editing}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            setBusy(true); setErr('');
            const res = await supersedeDealTerm(editing.id, draft);
            setBusy(false);
            if (res.error) { setErr(res.error); return; }
            setEditing(null);
          }} />
      )}

      {locking && (
        <LockConfirmModal entityName={entity.name} lockCheck={lockCheck} busy={busy}
          onCancel={() => setLocking(false)} onConfirm={handleLock} />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function TermForm({
  entityId, people, interactions, defaultPersonId, existing, onCancel, onSave,
}: {
  entityId: string;
  people: { id: string; full_name: string }[];
  interactions: { id: string; occurred_at: string; channel: string }[];
  defaultPersonId?: string;
  existing?: DealTerm;
  onCancel: () => void;
  onSave: (draft: {
    kind: DealTermKind; side: DealTermSide; formality: DealTermFormality;
    amountEur?: number; text?: string; personId?: string; interactionId?: string; effectiveAt?: string;
  }) => void;
}) {
  const [kind, setKind] = useState<DealTermKind>(existing?.kind ?? 'offer');
  const [side, setSide] = useState<DealTermSide>(existing?.side ?? 'theirs');
  const [formality, setFormality] = useState<DealTermFormality>(existing?.formality ?? 'mentioned');
  const [amount, setAmount] = useState(existing?.amount_eur != null ? String(existing.amount_eur) : '');
  const [text, setText] = useState(existing?.text ?? '');
  const [personId, setPersonId] = useState(existing?.person_id ?? defaultPersonId ?? '');
  const [interactionId, setInteractionId] = useState(existing?.interaction_id ?? '');
  const [effectiveAt, setEffectiveAt] = useState((existing?.effective_at ?? new Date().toISOString().slice(0, 10)));

  const valid = amount.trim() !== '' || text.trim() !== '';

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="grid grid-cols-2 gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as DealTermKind)} disabled={!!existing}
          className="rounded border border-gray-300 px-2 py-1 text-xs disabled:bg-gray-100">
          {(Object.keys(KIND_LABEL) as DealTermKind[]).filter((k) => k !== 'ask').map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select value={side} onChange={(e) => setSide(e.target.value as DealTermSide)} disabled={!!existing}
          className="rounded border border-gray-300 px-2 py-1 text-xs disabled:bg-gray-100">
          <option value="ours">Us</option>
          <option value="theirs">Them</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="number" min="0" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (€, optional)"
          className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <select value={formality} onChange={(e) => setFormality(e.target.value as DealTermFormality)}
          className="rounded border border-gray-300 px-2 py-1 text-xs">
          {(Object.keys(FORMALITY_LABEL) as DealTermFormality[]).map((f) => <option key={f} value={f}>{FORMALITY_LABEL[f]}</option>)}
        </select>
      </div>
      <input autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder="Or a free-text note (e.g. 'SAFE, no cap')"
        className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
      <div className="grid grid-cols-2 gap-2">
        <input type="date" autoComplete="off" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <select value={personId} onChange={(e) => setPersonId(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="">No specific person</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </div>
      {!existing && interactions.length > 0 && (
        <select value={interactionId} onChange={(e) => setInteractionId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="">Not from a specific interaction</option>
          {[...interactions].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).map((i) => (
            <option key={i.id} value={i.id}>{i.occurred_at.slice(0, 10)} · {i.channel.replace('_', ' ')}</option>
          ))}
        </select>
      )}
      <div className="flex gap-1.5">
        <button disabled={!valid} onClick={() => onSave({
          kind, side, formality, amountEur: amount.trim() ? Number(amount) : undefined, text: text.trim() || undefined,
          personId: personId || undefined, interactionId: interactionId || undefined, effectiveAt,
        })} className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs">Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function LockConfirmModal({
  entityName, lockCheck, busy, onCancel, onConfirm,
}: {
  entityName: string;
  lockCheck: ReturnType<typeof checkLockPreconditions>;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-900">
        These terms will be archived as agreed with {entityName} on {new Date().toISOString().slice(0, 10)}. Confirm?
      </p>
      <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800">
        {lockCheck.agreedTerms.map((t) => (
          <li key={t.id}>✓ {KIND_LABEL[t.kind]}: {t.amount_eur != null ? fmtEur(t.amount_eur) : t.text}</li>
        ))}
      </ul>
      {lockCheck.mentionedTerms.length > 0 && (
        <p className="mt-1.5 text-xs text-amber-700">
          {lockCheck.mentionedTerms.length} term{lockCheck.mentionedTerms.length > 1 ? 's are' : ' is'} only Mentioned (not Agreed) and will be left OUT of the memo:{' '}
          {lockCheck.mentionedTerms.map((t) => KIND_LABEL[t.kind]).join(', ')}.
        </p>
      )}
      {lockCheck.agreedTerms.length === 0 ? (
        <p className="mt-1.5 text-xs font-medium text-[#B00000]">
          No terms are marked Agreed yet — there is nothing to archive. Mark at least one term Agreed first.
        </p>
      ) : null}
      <div className="mt-2 flex gap-1.5">
        <button onClick={onConfirm} disabled={busy || lockCheck.agreedTerms.length === 0}
          className="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
          {busy ? 'Locking…' : 'Confirm & lock'}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded-lg border border-amber-400 px-2.5 py-1 text-xs">Cancel</button>
      </div>
    </div>
  );
}

// Re-exported for the delivery report / tests to reference the exact shape
// TermsOnTheTable reads memos as — no runtime use in this file.
export type { DealMemoPayload };
