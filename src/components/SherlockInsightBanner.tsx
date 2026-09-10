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
import {
  useInterestRequests, interestRequestHeadline, interestRequestConsequence,
  INTEREST_REQUEST_APPROVE_LABEL, INTEREST_REQUEST_DENY_LABEL,
} from '@/lib/interest-requests-client';
import { useDecideInterest } from '@/lib/use-decide-interest';
import { DecisionNotesCards, type DecisionNote } from './DecisionNotesCards';
import { DECISION_NOTE_MAX, REOPEN_TRIGGER_MIN_LENGTH } from '@/lib/startup-investor-decision';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useConfirm } from '@/lib/confirm';

// Prompt 410 §2.3 — how long the post-decision confirmation stays up. Short
// on purpose ("toast", Nuno's own word) — this isn't an undo window (the
// decision already posted), just an acknowledgment.
const DECISION_TOAST_MS = 4000;

// Prompt 879/880 §4 — "pre-flight" appears mid-sentence ("Ready for first
// contact — pre-flight clear for {name}."), and splicing the hint icon in
// right after the matched word landed it awkwardly mid-phrase. `hintAt:
// 'end'` moves it to the end of the sentence instead; 'match' (the
// default) keeps the original inline placement, which is still right for
// "Locked" (matches at the very start of the string already).
const NEXT_STEP_GLOSSARY: { pattern: RegExp; explain: string; hintAt?: 'match' | 'end' }[] = [
  { pattern: /pre-flight/i, explain: 'An automatic check run just before a first message — flags missing hook research, banned phrases, or reaching out too soon.', hintAt: 'end' },
  { pattern: /^Locked/, explain: `Outreach to this investor is paused for ${LOCK_DAYS} days after your last message, so a reply has time to arrive before you follow up again.` },
];

function annotateNextStep(text: string): ReactNode {
  for (const term of NEXT_STEP_GLOSSARY) {
    const m = text.match(term.pattern);
    if (m?.index === undefined) continue;
    if (term.hintAt === 'end') {
      return <>{text}<TermHint text={term.explain} /></>;
    }
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
// Prompt 415 §3 — exported: RecentInteractions.tsx now renders this same
// cue for the unclassified_reply case, which has no button in THIS
// banner to attach to.
export function FocusLupa() {
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
  canMessage, onSwitchToMessage, onSwitchToLog, focus = null,
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
  // Prompt 410 §2.4 / Prompt 415 §3 — the raw ?focus= value from the
  // Sherlock Next Clue deep-link (sherlock-next.ts's own target strings).
  // 'interest' (kept as this literal value, not 'interest_request', for
  // backward compat with anything already saved/bookmarked — 415 §3.1's
  // own instruction) drives the cue on the pending-interest action;
  // 'follow_up_overdue' drives it on Reply now below. Any other value
  // (or the 5 kinds with no single obvious button, or null) has no
  // effect here.
  focus?: string | null;
}) {
  const focusInterest = focus === 'interest';
  const focusOverdue = focus === 'follow_up_overdue';
  const { db, updateEntity, revertInvestorDecision, revertPass } = useStore();
  const [reopenTriggerDraft, setReopenTriggerDraft] = useState<string | null>(null);
  // Prompt 853 §2c — both the pass and the "not a fit for us" decision are
  // revertible from the card that shows them, gated on the same capability
  // NotAFitAction already gates its own Revert on (852 §B).
  const canRevertDecisions = useOrgCapability('investor_decisions');
  const confirm = useConfirm();
  const [revertError, setRevertError] = useState<string | null>(null);
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

  // Prompt 853 §2c — one sentence naming what returns, then the write. Both
  // reverts share this: the confirm is the only friction, no separate undo
  // window afterwards (the write already happened).
  async function handleRevertNotAFit(decisionId: string) {
    setRevertError(null);
    if (!(await confirm({ message: 'This puts the investor back in your active pipeline. Continue?' }))) return;
    const { error } = await revertInvestorDecision(decisionId);
    if (error) setRevertError(error);
  }
  async function handleRevertPass(interactionId: string) {
    setRevertError(null);
    if (!(await confirm({ message: 'This puts the investor back in your active pipeline and restores where things stood before the pass. Continue?' }))) return;
    const { error } = await revertPass(interactionId);
    if (error) setRevertError(error);
  }

  const s = relationshipSummary(db, entity.id, new Date(), dealMessageTouches);
  const action = nextBestAction(db, entity.id, new Date(), dealMessageTouches);
  const actionButton = nextBestActionButton(db, entity.id, new Date(), dealMessageTouches);
  const nextContact = s.stage === 'not_contacted' ? nextContactPerson(db, entity.id) : undefined;
  const nextContactPreflight = nextContact ? preflightSummary(preflight(db, nextContact, null)) : undefined;
  const ds = derivedStage(db, entity.id);
  const parkedOrClosed = ds.mode !== 'active';
  // Prompt 853 §2b — a reverted pass is no longer live: skip it so the card
  // and the "they passed" logic both fall back to "no pass on record" rather
  // than showing a reason the founder already took back.
  const lastPassInteraction = db.interactions
    .filter((i) => i.entity_id === entity.id && i.direction === 'in' && i.classification === 'pass' && !i.reverted_at)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1);
  const lastPassReason = lastPassInteraction?.pass_reason;
  // Prompt 852 §A/§D — what the two (or three) cards below the banner show.
  // Every field is real or absent: no card is rendered for a note that was
  // never written, and the date is the record's own, never invented.
  const liveOwnDecision = (db.startupInvestorDecisions ?? [])
    .find((d) => d.entity_id === entity.id && !d.reverted_at);
  const decisionNotes: DecisionNote[] = [];
  if (liveOwnDecision) {
    decisionNotes.push({
      kind: 'not_a_fit', category: liveOwnDecision.reason_category ?? null,
      text: liveOwnDecision.note, recordedAt: liveOwnDecision.decided_at,
      onRevert: canRevertDecisions ? () => void handleRevertNotAFit(liveOwnDecision.id) : undefined,
    });
  }
  if (lastPassReason && lastPassInteraction) {
    decisionNotes.push({
      kind: 'pass', category: lastPassInteraction.pass_reason_category ?? null,
      text: lastPassReason, recordedAt: lastPassInteraction.occurred_at,
      // Prompt 853 §1 — only true when this pass really came from a
      // classified inbound reply (classified_by is set by classifyInteraction
      // alone, never by the pass form below). A typed "No interest / over"
      // pass has no classified_by, so the card just prints the date.
      source: lastPassInteraction.classified_by ? 'from the classified reply' : null,
      onRevert: canRevertDecisions ? () => void handleRevertPass(lastPassInteraction.id) : undefined,
    });
  }
  if (entity.reopen_trigger) {
    decisionNotes.push({
      kind: 'restart', text: entity.reopen_trigger,
      // No date of its own: reopen_trigger is a column on the entity, not a
      // record with its own timestamp. Saying "Recorded —" would be worse
      // than saying nothing, so the card simply omits the line.
      recordedAt: null,
      onEdit: () => setReopenTriggerDraft(entity.reopen_trigger ?? ''),
    });
  }
  // Prompt 415 §3 — named so the lupa below (focusOverdue) can check the
  // exact same condition that decides which button the ternary renders.
  // Checking actionButton?.kind === 'follow_up' alone isn't enough: it can
  // be true even while showFirstInteractionButton also is, and that branch
  // wins the ternary — a bare kind check would then attach the lupa to
  // "Log the first interaction" (a different, not-yet-contacted person)
  // instead of the "Reply now" button it's actually meant to mark.
  const showFirstInteractionButton = !pendingInterestReq && !!nextContactPreflight?.green && !!nextContact;
  const showReplyNowButton = !pendingInterestReq && !showFirstInteractionButton && actionButton?.kind === 'follow_up';

  // Prompt 397 §A.4.4 — no advice, no box. Never an empty banner.
  if (!action) return null;

  return (
    <>
      <div data-tour-id="entity-tip" className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#0E7490] px-5 py-4 text-white shadow-[0_4px_20px_rgba(14,116,144,0.25)]">
        <InsightIcon />
        <div className="min-w-[220px] flex-1">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-white/75">Sherlock Insight</div>
          {/* Prompt 413 §2.1 — a pending interest request overrides the
              generic advice text here too, not just the button below: real
              tester feedback on the 410 version was that the headline could
              say something unrelated (e.g. "Recently contacted…") while the
              button underneath was actually about approving/denying a
              contact request — confusing on its own even before "contact
              access" jargon made it worse. */}
          {pendingInterestReq ? (
            <>
              <div className="mt-0.5 text-[14px] leading-snug">{interestRequestHeadline(pendingInterestReq.investorName)}</div>
              <div className="mt-0.5 text-[12px] text-white/75">{interestRequestConsequence(pendingInterestReq.shareDirectEmail)}</div>
            </>
          ) : (
            <div className="mt-0.5 text-[14px] leading-snug">{annotateNextStep(action)}</div>
          )}
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          {focusInterest && pendingInterestReq && <FocusLupa />}
          {focusOverdue && showReplyNowButton && <FocusLupa />}
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
                  {INTEREST_REQUEST_APPROVE_LABEL}
                </button>
                <button onClick={() => handleDecideInterest('denied')} disabled={busyTaskId === pendingInterestTask.id}
                  className="rounded-lg border border-white/55 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/10 disabled:opacity-40">
                  {INTEREST_REQUEST_DENY_LABEL}
                </button>
              </span>
            ) : (
              <Link href="/today" className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#0E7490] hover:bg-white/90">
                Decide in Today →
              </Link>
            )
          ) : showFirstInteractionButton && nextContact ? (
            <button onClick={() => onSwitchToLog?.(nextContact.id)} className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#0E7490] hover:bg-white/90">
              Log the first interaction
            </button>
          ) : showReplyNowButton ? (
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
      {/* Prompt 852 §D.2 — the two notes, side by side, directly below the
          banner: PASS REASON (their words, with the category and the date)
          and WHAT'S NEEDED TO RESTART (the founder's own reopen_trigger, the
          field the reawakening engine requires). §B's own decision joins
          them in the same card family, so the dossier says it once and in
          one voice. Rendered outside the parkedOrClosed gate below: a
          status='passed' entity that never went dormant has a pass reason
          worth showing, and a live "not a fit for us" decision is worth
          showing on any row at all. */}
      {decisionNotes.length > 0 && <DecisionNotesCards notes={decisionNotes} />}
      {revertError && (
        <p className="-mt-1 text-[11px] text-[#B00000]">{revertError}</p>
      )}

      {parkedOrClosed && (
        reopenTriggerDraft === null ? (
          // Prompt 852 §D.2 — the read-only "Your note when freezing" line
          // that used to live here is gone: DecisionNotesCards above shows
          // that same reopen_trigger, and two differently-worded copies of
          // one note is exactly what §B forbids. What stays here is the
          // WRITE path — the offer when there is no note yet, and the
          // editor, which the card's own ✎ opens.
          !entity.reopen_trigger && needsReopenTrigger(entity) ? (
            // Prompt 414 §3.1 — "Your note" made explicit here too, not
            // just once the note is saved (below): sitting directly under
            // the teal Sherlock-voiced banner, a bare "+ Set reopen
            // trigger" could read as Sherlock offering ITS OWN answer to
            // "why reopen" rather than what it actually is — a free-text
            // box for the founder's own thinking, which Sherlock cannot
            // yet derive on its own (see the honest fallback copy above).
            <div className="-mt-1 rounded-2xl bg-white px-4 py-2.5 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Your note</div>
              <button onClick={() => setReopenTriggerDraft('')} className="mt-0.5 text-[11px] font-semibold text-[#0f5132] hover:underline">
                + Set reopen trigger
              </button>
            </div>
          ) : null
        ) : (
          <div className="-mt-1 space-y-1.5 rounded-2xl bg-white px-4 py-3 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Your note</div>
            <textarea value={reopenTriggerDraft} onChange={(e) => setReopenTriggerDraft(e.target.value)} rows={2} autoFocus
              placeholder="What would have to change for a re-approach to be legitimate?"
              className="w-full rounded border border-[#cdeadb] p-2 text-xs text-gray-900" />
            {/* Prompt 852 §D.1 — the same 220 cap the pass form and §A's note
                carry, with a live counter, and the same 15-character floor
                as before (now the shared constant, not a second copy). */}
            <p className={`text-right text-[10px] ${DECISION_NOTE_MAX - reopenTriggerDraft.trim().length < 0 ? 'font-semibold text-[#B00000]' : 'text-gray-400'}`}>
              {DECISION_NOTE_MAX - reopenTriggerDraft.trim().length}
            </p>
            {reopenTriggerDraft.trim().length > 0 && reopenTriggerDraft.trim().length < REOPEN_TRIGGER_MIN_LENGTH && (
              <p className="text-[11px] text-amber-700">A few more words help — this reads as cut off.</p>
            )}
            <div className="flex gap-1.5">
              <button
                disabled={reopenTriggerDraft.trim().length < REOPEN_TRIGGER_MIN_LENGTH
                  || reopenTriggerDraft.trim().length > DECISION_NOTE_MAX}
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
