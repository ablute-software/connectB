'use client';
// Prompt 400 §A.2 — replaces the shell's "+ Log interaction": the ONLY
// context-free entry point into /log (confirmed by grep — every other
// caller passes ?entity=&person=), which forced a dropdown search that
// opened on "468 Capital" for no reason. This asks "what should I do right
// now?" instead, computed live and locally (sherlockNext — no AI, no cron;
// cheap enough to recompute every render, same class of client-side pass
// over `db` Pipeline/Today already do).
//
// Only the primary step, no top-3 popover (§A.2.3's own explicit escape
// hatch: "se complicar demasiado a shell, faz só o primário e regista" —
// logged here rather than built, to keep this nav-level component small).
//
// Prompt 415 §2 — the click used to navigate straight to step.target.
// Now it opens a popup first (portal to document.body + SSR guard, per
// CLAUDE.md's root rule on full-viewport overlays) offering "Follow now"
// (identical to the old direct-navigate behavior) or "Leave for later"
// (snoozes this exact candidate — sherlockNextSnoozeKey decides whether
// that option even exists for this kind). all_clear keeps navigating
// directly: there's no real candidate to defer when nothing is pending.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Tooltip } from '@/components/ui';
import { sherlockNext, sherlockNextClueCopy, sherlockNextSnoozeKey } from '@/lib/sherlock-next';
import { useInterestRequests, interestRequestHeadline } from '@/lib/interest-requests-client';
import { SNOOZE_OPTIONS } from '@/lib/snooze-options';

// Prompt 410 §1 — the label used to be step.label itself (truncated to
// LABEL_MAX), which meant this top-shell button could show raw pipeline
// content with no founder in the loop to notice it first — confirmed case:
// "Next: nunomarujo@gmail.com…" (an investor catalog entry whose "name" is
// an email). Fixed text now; the dynamic info moves entirely into the
// tooltip, which is opt-in (hover) rather than always-on in the header.
// Prompt 417 §A/§B — six more kinds (sherlock-next.ts steps 5-8, 10-11):
// onboarding has no single target button to describe (the target IS the
// page — see that file's own §A.3 note), so these read as a plain
// description of what the page is for, same as task_due_today already does.
const KIND_TOOLTIP: Record<string, string> = {
  interest_request: "Opens this investor's dossier, ready to approve or deny their request.",
  // Prompt 423 §B — same featured treatment as interest_request, sherlock-
  // next.ts step 2.
  cap_table_request: 'Opens Settings, ready to add your cap table for the investor who asked.',
  unclassified_reply: "Opens this investor's dossier with the reply ready to classify.",
  follow_up_overdue: 'Opens this investor\'s dossier with a reply pre-filled and ready to log.',
  task_due_today: 'A task on your list is due today.',
  onboarding_profile: 'Opens Settings — a complete profile is what investors see first.',
  onboarding_dataroom: 'Opens the Vault — add your first document.',
  onboarding_pipeline: 'Opens Pipeline — add your first investor.',
  onboarding_first_message: "Opens this investor's dossier, ready to log your first message.",
  ready_to_contact: "Opens this investor's dossier ready to log the first outreach.",
  // Prompt 564 §C — same register as ready_to_contact above: what the click
  // does, in one sentence. The clue's own label already names the firm and
  // the step, so this must not repeat it.
  next_approach: "Opens this investor's dossier — the next firm on your list nobody has approached yet.",
  pitch_review: 'Opens the Dashboard — several investors passed for the same reason.',
  readiness_nudge: "Opens Readiness & Train's action plan to strengthen your Vault.",
  all_clear: 'Nothing urgent right now — see the full picture on Today.',
};

export function SherlockNextButton() {
  const { db, snoozeSherlockClue } = useStore();
  const interestRequests = useInterestRequests();
  const [open, setOpen] = useState(false);
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);
  const step = sherlockNext(db, new Date());
  const isAllClear = step.kind === 'all_clear';
  // all_clear's own step.label IS just "All clear" — concatenating it after
  // the kind phrase below would repeat itself, so it short-circuits to the
  // plain phrase instead. Every other kind's step.label carries real,
  // specific info (a name, a task title) the kind phrase alone doesn't.
  const tooltipText = isAllClear
    ? 'All clear'
    : `${KIND_TOOLTIP[step.kind] ?? 'Your next best action, picked live from the pipeline.'} ${step.label}`;

  const entityName = step.entityId ? db.entities.find((e) => e.id === step.entityId)?.name : undefined;
  const pendingInterestReq = step.kind === 'interest_request' && step.entityId
    ? interestRequests.find((r) => r.status === 'pending' && r.entityId === step.entityId) : undefined;
  const clueText = pendingInterestReq
    ? interestRequestHeadline(pendingInterestReq.investorName)
    : sherlockNextClueCopy(step, db);
  const snoozeKey = sherlockNextSnoozeKey(step);

  function closePopup() { setOpen(false); setSnoozeMenuOpen(false); }
  function snooze(days: number) {
    if (!snoozeKey) return;
    const until = new Date(Date.now() + days * 86_400_000).toISOString();
    snoozeSherlockClue(step.kind, snoozeKey, until);
    closePopup();
  }

  const buttonClass = `flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-semibold shadow-sm transition ${
    isAllClear
      ? 'border border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
      : 'bg-[#0E7490] text-white hover:bg-[#0c637b]'}`;
  const buttonContent = (
    <>
      <span aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          isAllClear ? 'bg-gray-100 text-gray-500' : 'bg-white/20 text-white'}`}>
        S
      </span>
      <span>Sherlock&apos;s Next Clue</span>
    </>
  );

  return (
    <>
      <Tooltip text={tooltipText} side="bottom">
        {isAllClear ? (
          <Link href={step.target} className={buttonClass}>{buttonContent}</Link>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className={buttonClass}>{buttonContent}</button>
        )}
      </Tooltip>

      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={closePopup}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#0E7490]">Sherlock&apos;s Next Clue</div>
              <button onClick={closePopup} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            {entityName && <div className="text-sm font-semibold text-gray-900">{entityName}</div>}
            <p className="mt-1 text-sm text-gray-700">{clueText}</p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link href={step.target} onClick={closePopup}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b]">
                Follow now
              </Link>
              {snoozeKey && (
                <div className="relative">
                  <button type="button" onClick={() => setSnoozeMenuOpen((o) => !o)}
                    aria-haspopup="menu" aria-expanded={snoozeMenuOpen}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
                    Leave for later ▾
                  </button>
                  {snoozeMenuOpen && (
                    <div role="menu"
                      className="absolute left-0 top-[calc(100%+6px)] z-10 min-w-[150px] rounded-[10px] border border-gray-200 bg-white p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,.18)]">
                      {SNOOZE_OPTIONS.map((o) => (
                        <button key={o.days} role="menuitem" onClick={() => snooze(o.days)}
                          className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-gray-800 hover:bg-gray-100">
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
