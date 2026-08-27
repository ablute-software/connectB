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

export function SherlockInsightBanner({
  entity, dealMessageTouches = [], onClassifyRequest,
  pendingInterest, canMessage, onSwitchToMessage, onSwitchToLog,
}: {
  entity: Entity;
  dealMessageTouches?: DealMessageTouch[];
  onClassifyRequest?: () => void;
  pendingInterest?: boolean;
  canMessage?: boolean;
  // Prompt 397 §B — both re-point at the conversation panel (Phase A kept
  // the pre-397 targets: a /log Link, and MessageInvestorDrawer via
  // onOpenMessage). onSwitchToLog optionally carries the target person, so
  // "Log the first interaction"/"Reply now" land pre-filled.
  onSwitchToMessage?: () => void;
  onSwitchToLog?: (personId?: string) => void;
}) {
  const { db, updateEntity } = useStore();
  const [reopenTriggerDraft, setReopenTriggerDraft] = useState<string | null>(null);

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
        <div className="flex flex-wrap items-center gap-2">
          {/* Prompt 396 §7 / 397 §A.4.2 — same button matrix, priority order
              unchanged: pendingInterest wins if somehow more than one
              applies. Prompt 397 §B — "Log the first interaction"/"Reply
              now" now switch the conversation panel to Log (pre-filled with
              the target person) instead of navigating to /log; "Reply now"
              switches to Message when canMessage, same as before. */}
          {pendingInterest ? (
            <Link href="/today" className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#0E7490] hover:bg-white/90">
              Decide in Today →
            </Link>
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
