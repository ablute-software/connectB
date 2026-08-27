'use client';
// Prompt 397 §A.4 — "Sherlock Tip" used to be a small card in the left
// column of RelationshipSummaryCard's own two-column layout (Prompt 240).
// That two-column layout is gone (Prompt 397 §A.3/§B moved dates+history
// elsewhere) — this is its replacement: a full-width banner between the
// journey card and the rest of the page, same advice (nextBestAction,
// UNCHANGED), same button matrix Prompt 396 §7 built, styled per the
// approved study. Extracted to its own file rather than folded back into
// RelationshipSummaryCard.tsx: that file is already large, and this now
// needs its OWN copy of the action/preflight/reopen-trigger computations
// (both cards derive from the same entity+db, but render as two separate,
// independently-positioned pieces on the page — same pattern HealthDot/
// WhoseTurnChip already use, each independently calling relationshipSummary
// rather than threading one shared computation through props).
import { useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Entity } from '@/lib/types';
import { useStore } from '@/lib/store';
import {
  relationshipSummary, nextBestAction, nextBestActionButton, nextContactPerson, needsReopenTrigger,
  type DealMessageTouch,
} from '@/lib/relationship';
import { derivedStage } from '@/lib/derived-stage';
import { LOCK_DAYS, preflight, preflightSummary } from '@/lib/rules';
import { TermHint } from '@/components/ui';
import { useInterestRequests } from '@/lib/interest-requests-client';
import { useDecideInterest } from '@/lib/use-decide-interest';

// Prompt 410 §2.3 — how long the post-decision confirmation stays up. Short
// on purpose ("toast", Nuno's own word) — this isn't an undo window (the
// decision already posted), just an acknowledgment.
const DECISION_TOAST_MS = 4000;

const REOPEN_TRIGGER_MIN_LENGTH = 15;

const NEXT_STEP_GLOSSARY: { pattern: RegExp; explain: string }[] = [
  { pattern: /pre-flight/i, explain: 'An automatic check run just before a first message — flags missing hook research, banned phrases, or reaching out too soon.' },
  { pattern: /^Locked/, explain: `Outreach to this investor is paused for ${LOCK_DAYS} days after your last message, so a reply has time to arrive before you follow up again.` },
];

function annotateNextStep(text: string): ReactNode {
  for (const term of NEXT_STEP_GLOSSARY) {
    const m = text.match(term.pattern);
    if (m?.index === undefined) continue;
    const before = text.slice(0, m.index);
    const match = m[0];
    const after = text.slice(m.index + match.length);
    return <>{before}{match}<TermHint text={term.explain} />{after}</>;
  }
  return text;
}

// Small round translucent icon — a lightbulb, matching the study.
function InsightIcon() {
  return (
    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 text-white">
        <path d="M10 2.5a5 5 0 0 0-3 9v1.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V11.5a5 5 0 0 0-3-9Z" strokeLinejoin="round" />
        <path d="M8.3 17h3.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

// Prompt 410 §2.4 — a discreet "look here" cue for a founder who arrived via
// a Sherlock Next Clue deep-link that names a specific action (?focus=
// interest, today's only case). Settles once onto the action-button corner
// via a CSS animation (globals.css: sherlock-focus-in) rather than looping —
// an attention guide, not an alarm. prefers-reduced-motion drops the
// animation and renders it already settled (same stylesheet).
function FocusLupa() {
  return (
    <span aria-hidden
      className="sherlock-focus-lupa pointer-events-none absolute -right-2 -top-3 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[#0E7490] shadow-[0_2px_8px_rgba(15,23,42,0.35)] ring-2 ring-[#0E7490]/25">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
        <circle cx="8.3" cy="8.3" r="5.3" />
        <path d="m16.3 16.3-3.4-3.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function SherlockInsightBanner({
  entity, dealMessageTouches = [], onClassifyRequest,
  canMessage, onSwitchToMessage, onSwitchToLog, focusInterest = false,
}: {
  entity: Entity;
  dealMessageTouches?: DealMessageTouch[];
  onClassifyRequest?: () => void;
  canMessage?: boolean;
  // Prompt 397 §B — both re-point at the conversation panel (Phase A kept
  // the pre-397 targets: a /log Link, and MessageInvestorDrawer via
  // onOpenMessage). onSwitchToLog optionally carries the target person, so
  // "Log the first interaction"/"Reply now" land pre-filled.
  onSwitchToMessage?: () => void;
  onSwitchToLog?: (personId?: string) => void;
  // Prompt 410 §2.4 — true when the entity page was reached via
  // ?focus=interest (the Sherlock Next Clue button's own deep-link, §2.1).
  // Drives the magnifying-glass cue on the pending-interest action below;
  // has no effect on any other case (§2.5 — audited, not built, this pass).
  focusInterest?: boolean;
}) {
  const { db, updateEntity } = useStore();
  const [reopenTriggerDraft, setReopenTriggerDraft] = useState<string | null>(null);
  // Prompt 410 §2.3 — this banner's own copy of "is there a pending L3
  // interest request for this entity", same source (useInterestRequests)
  // the entity page already reads independently for its own small banner
  // above this one — same "each caller computes its own" pattern as
  // relationshipSummary throughout this file, not a prop threaded down.
  const interestRequests = useInterestRequests();
  const pendingInterestReq = interestRequests.find((r) => r.status === 'pending' && r.entityId === entity.id);
  // The task this decision closes (Today's own match, by entity_id — see
  // TodayPanel's pendingInterestByEntity). Absent only in the narrow window
  // before the local store has synced it; the Link fallback below covers
  // that rather than rendering buttons with nothing to close.
  const pendingInterestTask = db.tasks.find((t) => !t.done && t.source === 'interest_level_request' && t.entity_id === entity.id);
  const { decideInterest, busyTaskId } = useDecideInterest();
  const [decisionToast, setDecisionToast] = useState<string | null>(null);

  async function handleDecideInterest(decision: 'granted' | 'denied') {
    if (!pendingInterestReq || !pendingInterestTask) return;
    const investorName = pendingInterestReq.investorName;
    await decideInterest(pendingInterestTask.id, pendingInterestReq.id, decision);
    setDecisionToast(decision === 'granted'
      ? `Access approved — ${investorName} can now see your contact.`
      : `Access denied for ${investorName}.`);
    window.setTimeout(() => setDecisionToast(null), DECISION_TOAST_MS);
  }

  const s = relationshipSummary(db, entity.id, new Date(), dealMessageTouches);
  const action = nextBestAction(db, entity.id, new Date(), dealMessageTouches);
  const actionButton = nextBestActionButton(db, entity.id, new Date(), dealMessageTouches);
  const nextContact = s.stage === 'not_contacted' ? nextContactPerson(db, entity.id) : undefined;
  const nextContactPreflight = nextContact ? preflightSummary(preflight(db, nextContact, null)) : undefined;
  const ds = derivedStage(db, entity.id);
  const parkedOrClosed = ds.mode !== 'active';
  const lastPassInteraction = db.interactions
    .filter((i) => i.entity_id === entity.id && i.direction === 'in' && i.classification === 'pass')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1);
  const lastPassReason = lastPassInteraction?.pass_reason;

  // Prompt 397 §A.4.4 — no advice, no box. Never an empty banner.
  if (!action) return null;

  return (
    <>
      <div data-tour-id="entity-tip" className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#0E7490] px-5 py-4 text-white shadow-[0_4px_20px_rgba(14,116,144,0.25)]">
        <InsightIcon />
        <div className="min-w-[220px] flex-1">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-white/75">Sherlock Insight</div>
          <div className="mt-0.5 text-[14px] leading-snug">{annotateNextStep(action)}</div>
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          {focusInterest && pendingInterestReq && <FocusLupa />}
          {/* Prompt 396 §7 / 397 §A.4.2 — same button matrix, priority order
              unchanged: pendingInterest wins if somehow more than one
              applies. Prompt 397 §B — "Log the first interaction"/"Reply
              now" now switch the conversation panel to Log (pre-filled with
              the target person) instead of navigating to /log; "Reply now"
              switches to Message when canMessage, same as before. Prompt
              410 §2.3 — pendingInterest now decides inline (Approve/Deny)
              instead of only linking to Today; the Link survives as the
              fallback for the narrow window before pendingInterestTask has
              synced locally. */}
          {pendingInterestReq ? (
            pendingInterestTask ? (
              <span className="flex items-center gap-1.5">
                <button onClick={() => handleDecideInterest('granted')} disabled={busyTaskId === pendingInterestTask.id}
                  className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#0E7490] hover:bg-white/90 disabled:opacity-40">
                  Approve
                </button>
                <button onClick={() => handleDecideInterest('denied')} disabled={busyTaskId === pendingInterestTask.id}
                  className="rounded-lg border border-white/55 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/10 disabled:opacity-40">
                  Deny
                </button>
              </span>
            ) : (
              <Link href="/today" className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#0E7490] hover:bg-white/90">
                Decide in Today →
              </Link>
            )
          ) : nextContactPreflight?.green && nextContact ? (
            <button onClick={() => onSwitchToLog?.(nextContact.id)} className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#0E7490] hover:bg-white/90">
              Log the first interaction
            </button>
          ) : actionButton?.kind === 'follow_up' ? (
            canMessage && onSwitchToMessage ? (
              <button onClick={onSwitchToMessage} className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#0E7490] hover:bg-white/90">
                Reply now
              </button>
            ) : (
              <button onClick={() => onSwitchToLog?.(actionButton?.personId)} className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#0E7490] hover:bg-white/90">
                Reply now
              </button>
            )
          ) : null}
          {ds.unclassifiedReplies > 0 && onClassifyRequest && (
            <button onClick={onClassifyRequest}
              className="rounded-lg border border-white/55 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/10">
              Classify {ds.unclassifiedReplies} {ds.unclassifiedReplies === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>
      </div>

      {/* Prompt 410 §2.3 — the decision toast. Lives outside the button
          branches above (which swap to the next best action as soon as
          pendingInterestReq clears) so the confirmation survives that
          swap instead of vanishing with the buttons that triggered it. */}
      {decisionToast && (
        <div className="-mt-1 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[12px] font-medium text-emerald-800 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
          {decisionToast}
        </div>
      )}

      {/* Prompt 397 §A.4.2 (parked/closed) — the reopen-trigger editor needs
          real contrast to stay legible; inside the solid teal banner it
          wouldn't have any, so it opens in its own small white card right
          below instead. */}
      {parkedOrClosed && (
        reopenTriggerDraft === null ? (
          entity.reopen_trigger ? (
            <div className="-mt-1 flex items-start gap-1.5 rounded-2xl bg-white px-4 py-2.5 text-[12px] text-gray-600 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
              <span>Your note when freezing: &ldquo;{entity.reopen_trigger}&rdquo;</span>
              <button onClick={() => setReopenTriggerDraft(entity.reopen_trigger ?? '')} title="Edit your note"
                className="shrink-0 text-[11px] text-gray-300 hover:text-[#0f5132]">
                ✎
              </button>
            </div>
          ) : needsReopenTrigger(entity) ? (
            <div className="-mt-1 rounded-2xl bg-white px-4 py-2.5 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
              <button onClick={() => setReopenTriggerDraft('')} className="text-[11px] font-semibold text-[#0f5132] hover:underline">
                + Set reopen trigger
              </button>
            </div>
          ) : null
        ) : (
          <div className="-mt-1 space-y-1.5 rounded-2xl bg-white px-4 py-3 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
            <textarea value={reopenTriggerDraft} onChange={(e) => setReopenTriggerDraft(e.target.value)} rows={2} autoFocus
              placeholder="What would have to change for a re-approach to be legitimate?"
              className="w-full rounded border border-[#cdeadb] p-2 text-xs text-gray-900" />
            {reopenTriggerDraft.trim().length > 0 && reopenTriggerDraft.trim().length < REOPEN_TRIGGER_MIN_LENGTH && (
              <p className="text-[11px] text-amber-700">A few more words help — this reads as cut off.</p>
            )}
            <div className="flex gap-1.5">
              <button
                disabled={reopenTriggerDraft.trim().length < REOPEN_TRIGGER_MIN_LENGTH}
                onClick={() => { updateEntity(entity.id, { reopen_trigger: reopenTriggerDraft.trim() }); setReopenTriggerDraft(null); }}
                className="rounded-full bg-[#0f5132] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
                Save
              </button>
              <button onClick={() => setReopenTriggerDraft(null)}
                className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] text-gray-600">
                Cancel
              </button>
            </div>
          </div>
        )
      )}

      {/* Prompt 397 §A.4.2 — pass reason keeps its own card below the
          banner, same content as before (Prompt 240). */}
      {parkedOrClosed && lastPassReason && (
        <div className="-mt-1 rounded-2xl border border-[#f0d5d5] bg-[#FCF4F4] px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.03em] text-[#7a1f1f]">
            Pass reason
            {lastPassInteraction?.pass_reason_category && (
              <span className="font-normal normal-case tracking-normal text-gray-500">
                · {lastPassInteraction.pass_reason_category.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <div className="mt-1.5 text-[13px] italic leading-relaxed text-gray-800">&ldquo;{lastPassReason}&rdquo;</div>
          {lastPassInteraction && (
            <div className="mt-2 text-[11px] text-gray-500">
              Recorded {lastPassInteraction.occurred_at.slice(0, 10)}, from the classified reply.
            </div>
          )}
        </div>
      )}

      {nextContactPreflight && !nextContactPreflight.green && (
        <div className="-mt-1 rounded-2xl bg-white px-4 py-3 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
          <ul className="space-y-0.5 text-[12px] text-gray-700">
            {nextContactPreflight.failed.map((f) => (
              <li key={f.key} className="flex gap-1.5">
                <span aria-hidden className="text-[#0E7490]">·</span>
                <span>{f.reason ?? f.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
