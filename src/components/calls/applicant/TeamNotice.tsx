'use client';
// Prompt 918 (Adenda 3) — what the link of a call says to someone who is on that call's team: they do not apply to it. No "Applying as…", no form, no button to start.
import { ON_CALL_TEAM_MESSAGE } from '@/lib/calls/applicant/team-rule';

export function TeamNotice() {
  return (
    <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status" data-testid="team-notice">{ON_CALL_TEAM_MESSAGE}</p>
  );
}
