// Prompt 918 (Adenda 2, C) — deleting a call: what the person is told before, what is kept and for how long, and what the applicants are told. Pure (the dialog, the routes and the tests
// share it), so the screen can never promise something the server does not do.
//
// The rule (Nuno, 20/10/2026): a call can be deleted in any state by whoever may "Configure call". The person sees a summary of what goes and types the call's name. An open call is closed at
// once; its link says "This call is no longer available". The call goes to "Deleted calls" and can be restored for 30 days, by whoever may configure it; after that it is removed for good —
// the call, its applications, drafts and files — and only a minimal record stays (the call's id and name, who deleted it, when, and the counts). Applicants with a draft or a submission are
// told and can still read and download what they submitted until the day it goes. Archiving stays, for hiding a call without deleting it.

export const PURGE_DAYS = 30;
const DAY_MS = 86_400_000;

/** When a call deleted at `now` is removed for good. */
export const purgeDateFrom = (now: Date): Date => new Date(now.getTime() + PURGE_DAYS * DAY_MS);

/** Whole days left to restore (0 = it goes today; never negative). */
export function daysLeft(purgeAfter: string | null | undefined, now: Date = new Date()): number {
  const t = purgeAfter ? Date.parse(purgeAfter) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now.getTime()) / DAY_MS)) : 0;
}

/** What deleting this call would remove, in numbers only (never who). */
export interface DeletionImpact { submitted: number; drafts: number; files: number }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The summary shown before deleting: one line per thing that is there; a call nobody applied to says so. */
export function impactLines(i: DeletionImpact): string[] {
  const out: string[] = [];
  if (i.submitted > 0) out.push(plural(i.submitted, 'submitted application', 'submitted applications'));
  if (i.drafts > 0) out.push(plural(i.drafts, 'applicant with a draft (not submitted yet)', 'applicants with a draft (not submitted yet)'));
  if (i.files > 0) out.push(plural(i.files, 'uploaded file', 'uploaded files'));
  return out.length > 0 ? out : ['Nobody has applied to this call yet.'];
}

/** What is promised, in the dialog: where it goes, for how long, and what happens after. */
export const DELETE_RETENTION_TEXT = `The call moves to “Deleted calls” and can be restored for ${PURGE_DAYS} days. After that it is removed for good, with its applications, drafts and files; only a minimal record stays (the call’s name, who deleted it, when, and the numbers above).`;
export const DELETE_OPEN_TEXT = 'The call is open: deleting it closes it immediately, and its link will say “This call is no longer available”.';
export const DELETE_NOTIFY_TEXT = 'Applicants with a draft or a submission are told by email and in the app. They can read and download what they submitted until the day it is removed.';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
/** The name typed to confirm matches the call's (spaces and case do not matter; an empty name never matches). */
export const nameMatches = (typed: string, name: string): boolean => squash(name) !== '' && squash(typed) === squash(name);

export const CONFIRM_NAME_ERROR = 'Type the name of the call to confirm.';
export const GONE_MESSAGE = 'This call is no longer available';

/** The notice an applicant gets (in the app and by email). `purgeDay` is already formatted, in the call's time zone. */
export function cancelledNoticeText(entity: string, title: string, purgeDay: string): { title: string; body: string } {
  return {
    title: `${entity} has cancelled the call ${title}`,
    body: `${entity} has cancelled the call ${title}. Your application will be deleted on ${purgeDay}. Until then you can read what you submitted and download your files in Calls → My applications.`,
  };
}

/** The sentence under a deleted call in the "Deleted calls" list. */
export function deletedLine(purgeAfter: string | null | undefined, now: Date = new Date()): string {
  const n = daysLeft(purgeAfter, now);
  return n === 0 ? 'Removed for good today' : `${plural(n, 'day', 'days')} left to restore`;
}
