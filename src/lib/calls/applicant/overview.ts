// Prompt 907 (I4) — the applicant's area (spec §20): "Open calls", "My applications" and "Past applications", decided here in pure functions
// (the route only gathers the rows, the page only draws the result).
//
//   Open calls            cards of the calls that are open and LISTED, plus the "closed — link only" ones this startup reached by their link
//                         (calls of a test organisation are hidden from real startups: Prompt 909's rule), each with the button that fits:
//                         Apply / Continue application / View application.
//   My applications       In progress · Submitted · Under review · Result available. Order: in progress by the nearest deadline first, then the
//                         submitted ones, newest first.
//   Past applications     calls that ended with no submission (an unfinished draft goes to the archive) and applications of archived calls.
import { effectiveStatus } from '../lifecycle';
import { appearsInOpenCalls } from '../visibility';
import type { CallStatus, CallVisibility } from '../types';

export type ApplicationStage = 'in_progress' | 'submitted' | 'under_review' | 'result_available';
export type CardAction = 'apply' | 'continue' | 'view';

export interface CallFacts {
  id: string; token: string | null; name: string; promoter: string; status: CallStatus; opensAt: string | null; closesAt: string | null; timezone: string;
  description: string | null; visibility: CallVisibility; promoterIsTest: boolean; hasForm: boolean; allowMultiple: boolean;
}
export interface ApplicationFacts { id: string; callId: string; status: 'draft' | 'submitted' | 'withdrawn'; reference: string | null; updatedAt: string; submittedAt: string | null }

export interface OpenCallCard {
  callId: string; token: string; name: string; promoter: string; closesAt: string | null; timezone: string; description: string | null;
  linkOnly: boolean; action: CardAction; applicationStage: ApplicationStage | null; reference: string | null; applications: number;
}
export interface ApplicationItem {
  applicationId: string; callId: string; token: string | null; name: string; promoter: string; reference: string | null; stage: ApplicationStage;
  closesAt: string | null; timezone: string; submittedAt: string | null;
}
export interface PastItem {
  applicationId: string | null; callId: string; token: string | null; name: string; promoter: string; reference: string | null;
  reason: 'closed_without_submission' | 'archived'; closesAt: string | null; timezone: string;
}
export interface Overview { openCalls: OpenCallCard[]; mine: ApplicationItem[]; past: PastItem[] }

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  in_progress: 'In progress', submitted: 'Submitted', under_review: 'Under review', result_available: 'Result available',
};

/** The stage of a SUBMITTED or in-progress application from the call's own state. Review and results arrive in later stages. */
export function stageOf(app: Pick<ApplicationFacts, 'status'>, callStatus: CallStatus): ApplicationStage {
  if (app.status === 'draft') return 'in_progress';
  if (callStatus === 'results_published') return 'result_available';
  if (callStatus === 'evaluating') return 'under_review';
  return 'submitted';
}

export function cardAction(apps: ApplicationFacts[], accepting: boolean): CardAction {
  if (apps.some((a) => a.status === 'draft')) return 'continue';
  if (apps.some((a) => a.status === 'submitted')) return 'view';
  return accepting ? 'apply' : 'view';
}

/** In progress by the nearest deadline first (no deadline last), then everything else newest first. */
export function sortMine(items: ApplicationItem[], updatedAt: Map<string, string>): ApplicationItem[] {
  const time = (s: string | null) => (s ? Date.parse(s) : Number.POSITIVE_INFINITY);
  return [...items].sort((a, b) => {
    const ad = a.stage === 'in_progress'; const bd = b.stage === 'in_progress';
    if (ad !== bd) return ad ? -1 : 1;
    if (ad && bd) return time(a.closesAt) - time(b.closesAt);
    return (updatedAt.get(b.applicationId) ?? '').localeCompare(updatedAt.get(a.applicationId) ?? '');
  });
}

export function buildOverview(input: {
  calls: CallFacts[]; apps: ApplicationFacts[]; linkAccess: Set<string>; viewerIsTestAccount: boolean; now?: Date;
}): Overview {
  const now = input.now ?? new Date();
  const byCall = new Map(input.calls.map((c) => [c.id, c]));
  const appsOfCall = (id: string) => input.apps.filter((a) => a.callId === id && a.status !== 'withdrawn');
  const eff = (c: CallFacts) => effectiveStatus({ status: c.status, opensAt: c.opensAt, closesAt: c.closesAt }, now);

  // Open calls: listed and open (to this viewer), plus the link-only ones this startup reached, as long as there is something to do there.
  const open: OpenCallCard[] = [];
  for (const c of input.calls) {
    if (!c.token || !c.hasForm) continue;
    const status = eff(c);
    const accepting = status === 'open';
    const mine = appsOfCall(c.id);
    const listed = appearsInOpenCalls({ visibility: c.visibility, promoterIsTest: c.promoterIsTest }, { isTestAccount: input.viewerIsTestAccount });
    const reached = input.linkAccess.has(c.id);
    // Seen: listed and open (to this viewer); or reached by its link while it is open; or one the startup has an application on (whatever its state:
    // the card says "View application" / "Continue application"). A draft or archived call is never advertised.
    const visible = (listed && accepting) || (reached && accepting) || mine.length > 0;
    if (!visible || status === 'archived' || status === 'draft') continue;
    const apps = mine;
    const top = apps.find((a) => a.status === 'draft') ?? apps.find((a) => a.status === 'submitted') ?? null;
    open.push({
      callId: c.id, token: c.token, name: c.name, promoter: c.promoter, closesAt: c.closesAt, timezone: c.timezone, description: c.description,
      linkOnly: c.visibility === 'unlisted', action: cardAction(apps, accepting), applicationStage: top ? stageOf(top, status) : null, reference: top?.reference ?? null, applications: apps.length,
    });
  }
  open.sort((a, b) => (a.closesAt ? Date.parse(a.closesAt) : Infinity) - (b.closesAt ? Date.parse(b.closesAt) : Infinity));

  // Mine / past: every application of this startup.
  const mine: ApplicationItem[] = [];
  const past: PastItem[] = [];
  for (const a of input.apps) {
    const c = byCall.get(a.callId);
    if (!c || a.status === 'withdrawn') continue;
    const status = eff(c);
    const base = { callId: c.id, token: c.token, name: c.name, promoter: c.promoter, reference: a.reference, closesAt: c.closesAt, timezone: c.timezone };
    if (status === 'archived') { past.push({ ...base, applicationId: a.id, reason: 'archived' }); continue; }
    if (a.status === 'draft' && status !== 'open') { past.push({ ...base, applicationId: a.id, reason: 'closed_without_submission' }); continue; }
    mine.push({ ...base, applicationId: a.id, stage: stageOf(a, status), submittedAt: a.submittedAt });
  }
  const updated = new Map(input.apps.map((a) => [a.id, a.submittedAt ?? a.updatedAt]));
  return { openCalls: open, mine: sortMine(mine, updated), past };
}
