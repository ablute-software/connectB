// Prompt 929 (A) — a call that reached its maximum number of applications: the sentence, the places left, and what each person is told. Pure texts and arithmetic (the server counts and decides inside the transaction).
import type { Call } from '../types';

export const FULL_MESSAGE = 'This call has reached its maximum number of applications.';
export const FULL_LABEL = 'Full';

/** Is the call full, for this number of SUBMITTED applications? (Drafts never count.) */
export const isFullFor = (call: Pick<Call, 'maxApplications'>, submitted: number): boolean => call.maxApplications !== null && call.maxApplications !== undefined && submitted >= call.maxApplications;
export const placesLeftFor = (call: Pick<Call, 'maxApplications'>, submitted: number): number | null => (call.maxApplications === null || call.maxApplications === undefined ? null : Math.max(0, call.maxApplications - submitted));
export const placesLeftText = (n: number): string => `${n} place${n === 1 ? '' : 's'} left`;
/** "182 / 200 applications" for the team (or just the count when there is no limit). */
export const applicationsText = (call: Pick<Call, 'maxApplications'>, submitted: number): string => (call.maxApplications ? `${submitted} / ${call.maxApplications} applications` : `${submitted} application${submitted === 1 ? '' : 's'}`);

/** What whoever had a DRAFT is told, once, by the entity, when the call fills up. */
export const fullDraftText = (entity: string, callName: string): { title: string; body: string } => ({
  title: `«${callName}» has reached its maximum number of applications`,
  body: `${entity} is no longer accepting submissions on this call, so your draft can no longer be submitted. Your answers are kept.`,
});
/** What whoever had a draft is told when the limit is raised or removed and the call is accepting again. */
export const reopenedDraftText = (entity: string, callName: string): { title: string; body: string } => ({
  title: `«${callName}» is accepting applications again`,
  body: `${entity} raised the maximum number of applications, so your draft can be submitted again while the call is open.`,
});
/** The email Sherlock Deal sends, ON ITS OWN, to who arrived after the call was full (it follows the choice of the account about tips). */
export const fullLateText = (entity: string, callName: string): { title: string; body: string } => ({
  title: `«${callName}» is full`,
  body: `«${callName}» by «${entity}» has reached its maximum number of applications, so your application could not be submitted. You can keep using Sherlock Deal: complete your startup profile to be found by investors that match your stage and sector, and to hear about new opportunities.`,
});
