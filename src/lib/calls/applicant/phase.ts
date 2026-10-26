// Prompt 907 (I1) — what the link of a call says about its state, from the applicant's point of view (spec §13.1, §14.4). Pure.
//   scheduled -> "Opens on [date]"
//   open      -> the registration box / the form
//   closed    -> "Applications closed on [date]"
// A call with no form answers 404 (decided by the route, which counts the fields); an archived call too (Prompt 909).
import { effectiveStatus } from '../lifecycle';
import { formatDayInZone } from '../tz';
import { closedBeforeDeadline } from '../closing';
import type { Call } from '../types';

export type ApplicantPhase = 'open' | 'scheduled' | 'closed';

export function applicantPhase(call: Pick<Call, 'status' | 'opensAt' | 'closesAt'>, now: Date = new Date()): ApplicantPhase {
  const s = effectiveStatus(call, now);
  if (s === 'open') return 'open';
  if (s === 'scheduled' || s === 'validated') return 'scheduled';
  return 'closed';
}

/** The sentence under the header while the call cannot receive applications; null while it can. */
export function phaseSentence(call: Pick<Call, 'status' | 'opensAt' | 'closesAt' | 'timezone'> & { closedAt?: string | null }, now: Date = new Date()): string | null {
  const phase = applicantPhase(call, now);
  if (phase === 'open') return null;
  if (phase === 'scheduled') return `Opens on ${formatDayInZone(call.opensAt, call.timezone)}`;
  // A call closed BEFORE its deadline (early, or taken down and restored) says the day it really closed — "closed on 31 Dec" would be a date still to come (Prompt 918, Adenda 3).
  return `Applications closed on ${formatDayInZone(closedBeforeDeadline(call) ? call.closedAt : call.closesAt, call.timezone)}`;
}
