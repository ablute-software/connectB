// Prompt 747 §B — pure "who gets what" decision for the daily investor
// notify-digest. Split out from the DB read / email-send side
// (investor-notify-digest-server.ts) precisely so preference-check,
// watermark-comparison, and the 8-line cap can be unit-tested without a
// Supabase connection — same discipline as rules.ts's own header:
// "these are the product's soul — pure functions, keep them".
//
// The trigger-timing hazard this prompt's own spec calls out (mark_
// pipeline_presented / reserve_pipeline_admissions both run when someone at
// the firm OPENS the Pipeline — investor-pipeline.ts ~660-718 — so an email
// fired from inside that same request would tell the person "a startup
// arrived" while they are already looking at it) is handled by the CALLER
// never invoking this from that request path at all: only the daily cron
// (/api/automations) calls the server-side sweep that feeds this function,
// decoupling "when a card becomes visible" from "when the member is told".
// This module has no opinion on that — it only decides, given a list the
// caller has already resolved, whether to send and what the email says.

export interface NewPipelineAdmission {
  orgId: string;
  name: string;
  sector: string | null;
  stage: string | null;
  country: string | null;
}

export interface NotifyDigestMemberInput {
  /** matchdeal_investor_members.notify_new_eligible_startup. */
  notifyEnabled: boolean;
  /**
   * Every admission this firm currently has that is genuinely visible to it
   * (investor_pipeline_admissions.presented_at is not null — see that
   * column's own comment, migration 20260922130000: "First time this
   * candidate was actually returned inside an UNLOCKED wave to any user of
   * the firm") AND became visible since this member's own last digest
   * (presented_at > notify_new_eligible_last_sent_at), or ALL such
   * currently-presented admissions when this member has never been sent a
   * digest before (lastSentAt null — a first-ever run catches the member up
   * on what already exists rather than silently starting the clock with
   * nothing to show). The caller does this filtering against the database;
   * this function only decides what to do with the resulting list, so it
   * takes the already-filtered list rather than lastSentAt directly.
   */
  newAdmissions: NewPipelineAdmission[];
}

const MAX_DIGEST_LINES = 8;

export type NotifyDigestDecision =
  | { send: false }
  | { send: true; subject: string; lines: string[]; overflowText: string | null };

function formatLine(a: NewPipelineAdmission): string {
  const bits = [a.sector, a.stage, a.country].filter((v): v is string => !!v && v.trim().length > 0);
  return bits.length > 0 ? `${a.name} — ${bits.join(', ')}` : a.name;
}

/**
 * Prompt 747 §B — never an empty digest (preference off, or nothing new,
 * both return `{ send: false }`, and the caller must not write a send-log
 * row or call the provider for either). Caps the visible list at 8 lines,
 * exactly as specced ("Máximo 8 linhas; a partir daí 'and N more'").
 */
export function decideNotifyDigestForMember(input: NotifyDigestMemberInput): NotifyDigestDecision {
  if (!input.notifyEnabled) return { send: false };
  if (input.newAdmissions.length === 0) return { send: false };

  const total = input.newAdmissions.length;
  const shown = input.newAdmissions.slice(0, MAX_DIGEST_LINES);
  const overflowCount = total - shown.length;

  return {
    send: true,
    subject: `${total} new startup${total === 1 ? '' : 's'} in your pipeline`,
    lines: shown.map(formatLine),
    overflowText: overflowCount > 0 ? `and ${overflowCount} more` : null,
  };
}
