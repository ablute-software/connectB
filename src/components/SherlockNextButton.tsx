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
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Tooltip } from '@/components/ui';
import { sherlockNext } from '@/lib/sherlock-next';

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
  unclassified_reply: "Opens this investor's dossier with the reply ready to classify.",
  follow_up_overdue: 'Opens this investor\'s dossier with a reply pre-filled and ready to log.',
  task_due_today: 'A task on your list is due today.',
  onboarding_profile: 'Opens Settings — a complete profile is what investors see first.',
  onboarding_dataroom: 'Opens the Vault — add your first document.',
  onboarding_pipeline: 'Opens Pipeline — add your first investor.',
  onboarding_first_message: "Opens this investor's dossier, ready to log your first message.",
  ready_to_contact: "Opens this investor's dossier ready to log the first outreach.",
  pitch_review: 'Opens the Dashboard — several investors passed for the same reason.',
  readiness_nudge: "Opens Readiness & Train's action plan to strengthen your Vault.",
  all_clear: 'Nothing urgent right now — see the full picture on Today.',
};

export function SherlockNextButton() {
  const { db } = useStore();
  const step = sherlockNext(db, new Date());
  const isAllClear = step.kind === 'all_clear';
  // all_clear's own step.label IS just "All clear" — concatenating it after
  // the kind phrase below would repeat itself, so it short-circuits to the
  // plain phrase instead. Every other kind's step.label carries real,
  // specific info (a name, a task title) the kind phrase alone doesn't.
  const tooltipText = isAllClear
    ? 'All clear'
    : `${KIND_TOOLTIP[step.kind] ?? 'Your next best action, picked live from the pipeline.'} ${step.label}`;

  return (
    <Tooltip text={tooltipText} side="bottom">
      <Link href={step.target}
        className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-semibold shadow-sm transition ${
          isAllClear
            ? 'border border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
            : 'bg-[#0E7490] text-white hover:bg-[#0c637b]'}`}>
        <span aria-hidden
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
            isAllClear ? 'bg-gray-100 text-gray-500' : 'bg-white/20 text-white'}`}>
          S
        </span>
        <span>Sherlock&apos;s Next Clue</span>
      </Link>
    </Tooltip>
  );
}
