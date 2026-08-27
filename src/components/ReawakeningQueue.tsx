'use client';
// F — the Pipeline reawakening queue. Surfaces PENDING proposals the AI route
// produced when a canon fact was confirmed. Each cites the entity's prior "no"
// verbatim + the AI's one-line rationale (the delta), with the suggested
// wave/fit editable before approving. Approve → entity back to active + agenda
// task; reject → the pair stays evaluated, never re-proposed. No AI is called
// from here — this only resolves proposals that already exist.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card, Tooltip } from '@/components/ui';
import type { FitScore } from '@/lib/types';

const FITS: FitScore[] = ['high', 'medium_high', 'medium', 'low'];
const FIT_LABEL: Record<FitScore, string> = { high: 'High', medium_high: 'Medium-high', medium: 'Medium', low: 'Low' };

export function ReawakeningQueue() {
  const { db, approveReawakening, rejectReawakening } = useStore();
  const [available, setAvailable] = useState(false);
  // Local per-proposal edits to wave/fit before approval (default = suggested).
  const [edits, setEdits] = useState<Record<string, { wave?: number; fit?: FitScore }>>({});

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      // Prompt 251/253 Bloco B — demo mode has no real Supabase connection
      // for the capability probe to confirm against, so it always reports
      // false there; every other migration-gated feature in this codebase
      // treats demo mode itself as available (AgendaPanel.tsx's
      // taskReminders is the sibling example) — this one had drifted from
      // that convention, hiding the whole queue (including Bloco B's own
      // code-triggered proposals) in demo mode regardless of data.
      .then((me) => setAvailable(!me.authEnabled || !!me.capabilities?.reawakening)).catch(() => {});
  }, []);

  const pending = useMemo(
    () => db.reawakeningProposals.filter((p) => p.status === 'pending' && p.reopens),
    [db.reawakeningProposals],
  );

  if (!available || pending.length === 0) return null;

  function editOf(id: string, suggestedWave?: number, suggestedFit?: FitScore) {
    const e = edits[id] ?? {};
    return { wave: e.wave ?? suggestedWave, fit: e.fit ?? suggestedFit };
  }
  function setEdit(id: string, patch: { wave?: number; fit?: FitScore }) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function approveOne(id: string, suggestedWave?: number, suggestedFit?: FitScore) {
    const { wave, fit } = editOf(id, suggestedWave, suggestedFit);
    approveReawakening(id, { wave, fit });
  }
  function approveAll() {
    for (const p of pending) approveReawakening(p.id, editOf(p.id, p.suggested_wave, p.suggested_fit));
  }

  return (
    <Card tint="amber"
      title={
        <span className="flex items-center gap-2">
          <span>↻ {pending.length} investor{pending.length === 1 ? '' : 's'} may reawaken</span>
          <Tooltip text="A confirmed company fact may have changed the reason behind a “no”. Re-evaluate — nothing moves without your approval.">
            <span className="cursor-help text-xs text-amber-600">?</span>
          </Tooltip>
        </span>
      }
      right={pending.length > 1 ? (
        <button onClick={approveAll} className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0c637b]">
          Approve all
        </button>
      ) : undefined}
    >
      <ul className="divide-y divide-amber-100/70">
        {pending.map((p) => {
          const entity = db.entities.find((e) => e.id === p.entity_id);
          const { wave, fit } = editOf(p.id, p.suggested_wave, p.suggested_fit);
          return (
            <li key={p.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{entity?.name ?? 'Investor'}</span>
                {p.fact_statement && (
                  <span className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] text-gray-600">fact: {p.fact_statement}</span>
                )}
              </div>
              {/* Prompt 272 — the neglect origin's structured adviser
                  breakdown (only ever set when outcome was "reactivate" —
                  the only case that reaches this queue at all, per
                  reopens/status). Rendered as distinct elements, never one
                  merged paragraph — that was the whole point of this
                  prompt. Falls back to the pre-272 flat rationale/prior-
                  pass-reason rendering for the other two origins. */}
              {p.advice ? (
                <div className="mt-1 space-y-1 text-[12px] text-gray-700">
                  {p.advice.acknowledge && <p><span className="font-medium text-amber-800">Acknowledge:</span> {p.advice.acknowledge}</p>}
                  {p.advice.respondTo.length > 0 && (
                    <div>
                      <span className="font-medium text-amber-800">Answer:</span>
                      <ul className="ml-4 list-disc space-y-0.5">
                        {p.advice.respondTo.map((r, i) => (
                          <li key={i}><span className="italic text-gray-600">&ldquo;{r.question}&rdquo;</span> → {r.answer}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {p.advice.newHook && <p><span className="font-medium text-amber-800">Why now:</span> {p.advice.newHook}</p>}
                  {(p.advice.personName || p.advice.channel || p.advice.timing) && (
                    <p className="text-gray-500">
                      {p.advice.personName ? `To ${p.advice.personName}` : 'No contact on file yet'}
                      {p.advice.channel ? ` via ${p.advice.channel}` : ''}{p.advice.timing ? ` — ${p.advice.timing}` : ''}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {p.prior_pass_reason && (
                    <p className="mt-0.5 text-[12px] text-gray-500">
                      <span className="font-medium text-gray-600">Previous &ldquo;no&rdquo;:</span> {p.prior_pass_reason}
                      {p.prior_pass_category ? ` (${p.prior_pass_category})` : ''}
                    </p>
                  )}
                  {p.rationale && <p className="mt-0.5 text-[12px] text-amber-800">{p.rationale}</p>}
                </>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {/* Prompt 272 §5 — handoff to action, not just a read: opens
                    /log pre-filled, reusing the existing compose flow
                    (composer.ts's sherlockBriefing picks this SAME
                    proposal back up automatically — no new plumbing). Only
                    when there's someone to send it to; per Prompt 254's
                    own rule, the instruction left to the founder is only
                    the part that's really theirs — review and send. */}
                {p.advice && (
                  p.advice.personId ? (
                    <Link href={`/entities/${p.entity_id}?rail=log&person=${p.advice.personId}`}
                      className="rounded-lg bg-[#0f5132] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c4028]">
                      Draft this message
                    </Link>
                  ) : (
                    <Link href={`/entities/${p.entity_id}`} className="text-xs font-medium text-amber-800 hover:underline">
                      Add a contact first
                    </Link>
                  )
                )}
                {!p.advice && (
                  <>
                    <label className="text-[11px] text-gray-500">Wave
                      <input type="number" min={1} max={9} value={wave ?? ''} onChange={(e) => setEdit(p.id, { wave: e.target.value ? Number(e.target.value) : undefined })}
                        className="ml-1 w-12 rounded border border-gray-300 px-1 py-0.5 text-xs" />
                    </label>
                    <label className="text-[11px] text-gray-500">Fit
                      <select value={fit ?? ''} onChange={(e) => setEdit(p.id, { fit: (e.target.value || undefined) as FitScore | undefined })}
                        className="ml-1 rounded border border-gray-300 px-1 py-0.5 text-xs">
                        <option value="">—</option>
                        {FITS.map((f) => <option key={f} value={f}>{FIT_LABEL[f]}</option>)}
                      </select>
                    </label>
                  </>
                )}
                <button onClick={() => approveOne(p.id, p.suggested_wave, p.suggested_fit)}
                  className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">
                  Reopen
                </button>
                <button onClick={() => rejectReawakening(p.id)}
                  className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-white">
                  Ignore
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
