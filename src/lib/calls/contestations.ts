// Prompt 924 (Etapa 4, I3) — contestations, completing a call, and how long the applicants' data is kept. Pure: the store gathers the rows, the routes check who may do what, the tests read the rules and the words.
//
//   A contestation is for an application whose result is "Not selected" (a reject), while the call lets them (OFF by default; 10 calendar days after the results were published once on — Nuno, 28/10/2026), and ONCE
//   per application and phase. It has a written reason (required) and at most one file. Somebody with "Handle contestations" answers: Upheld (the decision changes to Advance or Waitlist, the applicant is told with a new
//   message, and the new result is a NEW publication — the old one is kept, never overwritten) or Rejected (a written response is required, and is sent). Only they may accept.
//   "Complete call" is possible once every phase was published, the contestation period is over and no contestation is open; from then on everything is read-only. The applicants' data is kept for N months after that
//   (24 by default), the administrator is warned 30 days before and can export or postpone once, with a reason; then the data goes and a summary WITHOUT personal data stays.
import { richTextToPlain } from '@/lib/rich-text';
import type { ResultKey } from './results';

export const MAX_REASON = 2000;
export const MAX_RESPONSE = 2000;
export const MAX_CONTEST_FILE_MB = 10;
export const DAY_MS = 86_400_000;
export const WARN_DAYS = 30;
/** Postponing the deletion once moves it by this many months. */
export const POSTPONE_MONTHS = 6;

// --- Can this applicant contest? --------------------------------------------------------------------------------------------------------------------------

export type ContestState = 'available' | 'not_offered' | 'expired' | 'done' | 'closed';
export interface ContestInfo {
  state: ContestState;
  /** When the period ends (ISO), while it is running or after it ended. */
  deadline: string | null;
  contestation: { status: 'open' | 'upheld' | 'rejected'; reason: string; response: string | null; answeredAt: string | null; hasFile: boolean; fileName: string | null } | null;
}

export const contestDeadline = (publishedAt: string, days: number): string => new Date(Date.parse(publishedAt) + days * DAY_MS).toISOString();

/** What the applicant is offered: the button, the deadline, their own contestation, or nothing. Never for a result other than "Not selected". */
export function contestInfo(input: {
  enabled: boolean; days: number; resultKind: ResultKey; publishedAt: string; callStatus: string; now: Date; existing: ContestInfo['contestation'];
}): ContestInfo {
  const deadline = contestDeadline(input.publishedAt, input.days);
  if (input.existing) return { state: 'done', deadline, contestation: input.existing };
  if (!input.enabled || input.resultKind !== 'reject') return { state: 'not_offered', deadline: null, contestation: null };
  if (input.callStatus === 'completed' || input.callStatus === 'archived') return { state: 'closed', deadline, contestation: null };
  return { state: input.now.getTime() <= Date.parse(deadline) ? 'available' : 'expired', deadline, contestation: null };
}

export function cleanReason(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: false, error: 'Write the reason for your contestation.' };
  if (text.length > MAX_REASON) return { ok: false, error: `The reason can have at most ${MAX_REASON} characters.` };
  return { ok: true, text };
}

// --- The answer ----------------------------------------------------------------------------------------------------------------------------------------

export type Outcome = 'upheld' | 'rejected';
export type Answer = { outcome: 'upheld'; newResult: 'advance' | 'waitlist'; response: string } | { outcome: 'rejected'; response: string };

/** What the person who handles contestations sends. Upheld says what the decision becomes (Advance or Waitlist); Rejected needs a written response, which is sent to the applicant. */
export function parseAnswer(raw: unknown): { ok: true; answer: Answer } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const response = typeof b.response === 'string' ? b.response.trim() : '';
  if (response.length > MAX_RESPONSE) return { ok: false, error: `The response can have at most ${MAX_RESPONSE} characters.` };
  if (b.outcome === 'rejected') return response ? { ok: true, answer: { outcome: 'rejected', response } } : { ok: false, error: 'Write the response to the applicant: a rejection needs one.' };
  if (b.outcome === 'upheld') {
    if (b.newResult !== 'advance' && b.newResult !== 'waitlist') return { ok: false, error: 'Choose what the decision becomes: Advance or Waitlist.' };
    return { ok: true, answer: { outcome: 'upheld', newResult: b.newResult, response } };
  }
  return { ok: false, error: 'Choose Upheld or Rejected.' };
}

type Lang = 'en' | 'pt' | 'es' | 'fr' | 'de' | 'it';
const WORDS: Record<Lang, { upheld: string; rejected: string; response: string; subjectRejected: string }> = {
  en: { upheld: 'We reviewed your contestation of “{call_title}” and accepted it.', rejected: 'We reviewed your contestation of “{call_title}”. The decision stands.', response: 'Response', subjectRejected: 'Response to your contestation' },
  pt: { upheld: 'Analisámos a sua contestação a “{call_title}” e foi aceite.', rejected: 'Analisámos a sua contestação a “{call_title}”. A decisão mantém-se.', response: 'Resposta', subjectRejected: 'Resposta à sua contestação' },
  es: { upheld: 'Hemos revisado su reclamación sobre «{call_title}» y ha sido aceptada.', rejected: 'Hemos revisado su reclamación sobre «{call_title}». La decisión se mantiene.', response: 'Respuesta', subjectRejected: 'Respuesta a su reclamación' },
  fr: { upheld: 'Nous avons examiné votre contestation concernant « {call_title} » et nous l’avons acceptée.', rejected: 'Nous avons examiné votre contestation concernant « {call_title} ». La décision est maintenue.', response: 'Réponse', subjectRejected: 'Réponse à votre contestation' },
  de: { upheld: 'Wir haben Ihren Einspruch zu „{call_title}“ geprüft und ihm stattgegeben.', rejected: 'Wir haben Ihren Einspruch zu „{call_title}“ geprüft. Die Entscheidung bleibt bestehen.', response: 'Antwort', subjectRejected: 'Antwort auf Ihren Einspruch' },
  it: { upheld: 'Abbiamo esaminato la sua contestazione relativa a «{call_title}» e l’abbiamo accolta.', rejected: 'Abbiamo esaminato la sua contestazione relativa a «{call_title}». La decisione è confermata.', response: 'Risposta', subjectRejected: 'Risposta alla sua contestazione' },
};
const langOf = (code: string | null | undefined): Lang => (code && code in WORDS ? (code as Lang) : 'en');
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The words that go BEFORE the new result's message when a contestation is upheld, and the written response after it (if there is one). */
export function upheldIntro(language: string | null | undefined, callName: string): string { return `<p>${esc(WORDS[langOf(language)].upheld.replace('{call_title}', callName))}</p>`; }
export function responseBlock(language: string | null | undefined, response: string): string {
  const t = response.trim();
  return t ? `<h3>${esc(WORDS[langOf(language)].response)}</h3><p>${esc(t).replace(/\n/g, '<br>')}</p>` : '';
}

/** The message sent when a contestation is rejected: that the decision stands, and the written response. */
export function rejectedMessage(language: string | null | undefined, callName: string, response: string): { subject: string; label: string; html: string; text: string } {
  const w = WORDS[langOf(language)];
  const html = `<p>${esc(w.rejected.replace('{call_title}', callName))}</p>${responseBlock(language, response)}`;
  return { subject: `${callName}: ${w.subjectRejected}`, label: w.subjectRejected, html, text: richTextToPlain(html) };
}

// --- Completing the call ---------------------------------------------------------------------------------------------------------------------------------

export type CloseBlocker = { code: 'completed' | 'not_published' | 'contest_period' | 'open_contestations' | 'archived'; text: string };

/** Why the call cannot be completed yet — every reason, in words. Empty means it can. */
export function completeBlockers(input: {
  callStatus: string; allPublished: boolean; contestationsEnabled: boolean; days: number; lastPublishedAt: string | null; openContestations: number; now: Date; timezone?: string;
}): CloseBlocker[] {
  const out: CloseBlocker[] = [];
  if (input.callStatus === 'completed') return [{ code: 'completed', text: 'The call is already completed.' }];
  if (input.callStatus === 'archived') return [{ code: 'archived', text: 'An archived call cannot be completed.' }];
  if (!input.allPublished) out.push({ code: 'not_published', text: 'Publish the results of every phase first.' });
  if (input.contestationsEnabled && input.lastPublishedAt) {
    const end = Date.parse(contestDeadline(input.lastPublishedAt, input.days));
    if (input.now.getTime() <= end) out.push({ code: 'contest_period', text: `The contestation period is still open until ${new Date(end).toISOString().slice(0, 10)}.` });
  }
  if (input.openContestations > 0) out.push({ code: 'open_contestations', text: `${input.openContestations} contestation${input.openContestations === 1 ? ' is' : 's are'} still waiting for an answer.` });
  return out;
}

// --- How long the data is kept -----------------------------------------------------------------------------------------------------------------------

/** completed_at + N calendar months (the same day of the month, or the last day of a shorter one). */
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}

export type RetentionPhase = 'kept' | 'warn' | 'due' | 'purged';
export interface RetentionState { phase: RetentionPhase; purgeAfter: string | null; daysLeft: number | null; canPostpone: boolean; extendedAt: string | null }

export function retentionState(input: { purgeAfter: string | null; extendedAt: string | null; purgedAt: string | null; now: Date }): RetentionState {
  if (input.purgedAt) return { phase: 'purged', purgeAfter: input.purgeAfter, daysLeft: 0, canPostpone: false, extendedAt: input.extendedAt };
  if (!input.purgeAfter) return { phase: 'kept', purgeAfter: null, daysLeft: null, canPostpone: false, extendedAt: input.extendedAt };
  const left = Math.ceil((Date.parse(input.purgeAfter) - input.now.getTime()) / DAY_MS);
  const phase: RetentionPhase = left <= 0 ? 'due' : left <= WARN_DAYS ? 'warn' : 'kept';
  // Once, with a reason; not after the data is due (the daily job removes it) and not twice.
  return { phase, purgeAfter: input.purgeAfter, daysLeft: Math.max(0, left), canPostpone: !input.extendedAt && phase !== 'due', extendedAt: input.extendedAt };
}

export function cleanPostponeReason(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (t.length < 5) return { ok: false, error: 'Say why the deletion is being postponed (a few words).' };
  if (t.length > 500) return { ok: false, error: 'The reason can have at most 500 characters.' };
  return { ok: true, text: t };
}

/** What stays when the data goes: counts and the grid — never a name, an answer, a file, a reason or a comment. */
export interface DataSummary {
  call: { name: string; completedAt: string | null };
  /** How the applications ended (counts only). The database adds `applications`: how many there were. */
  outcome: { total: number; byResult: Partial<Record<ResultKey, number>> };
  contestations: { total: number; upheld: number; rejected: number };
  phases: number;
  criteria: { name: string; weight: number; scaleMin: number; scaleMax: number; minScore: number | null }[];
}
export function buildSummary(input: {
  callName: string; completedAt: string | null; results: { result: ResultKey }[]; contestations: { status: string }[]; phases: number; criteria: DataSummary['criteria'];
}): DataSummary {
  const byResult: Partial<Record<ResultKey, number>> = {};
  for (const r of input.results) byResult[r.result] = (byResult[r.result] ?? 0) + 1;
  return {
    call: { name: input.callName, completedAt: input.completedAt }, outcome: { total: input.results.length, byResult },
    contestations: { total: input.contestations.length, upheld: input.contestations.filter((c) => c.status === 'upheld').length, rejected: input.contestations.filter((c) => c.status === 'rejected').length },
    phases: input.phases, criteria: input.criteria.map((c) => ({ name: c.name, weight: c.weight, scaleMin: c.scaleMin, scaleMax: c.scaleMax, minScore: c.minScore })),
  };
}

// --- What the screens read ------------------------------------------------------------------------------------------------------------------------------

export interface ContestationRow {
  id: string; applicationId: string; reference: string | null; startupName: string | null; status: 'open' | 'upheld' | 'rejected';
  reason: string; fileName: string | null; hasFile: boolean; createdAt: string; answeredAt: string | null; response: string | null;
  result: { label: string; kind: ResultKey; publishedAt: string };
  /** What the evaluations say about it (numbers only — never a comment or a private note), and the decision that was taken. */
  evaluation: { gradePercent: number | null; evaluators: number; criteria: { name: string; average: number | null }[]; decision: ResultKey | null; decisionNote: string | null } | null;
  newLabel: string | null;
}
export interface ContestationsView { ok: true; enabled: boolean; days: number; open: number; rows: ContestationRow[]; labels: Record<ResultKey, string> }
export interface CloseView {
  ok: true; status: string; blockers: CloseBlocker[]; canComplete: boolean; completedAt: string | null;
  summary: { total: number; counts: Record<ResultKey, number> };
  contestations: { enabled: boolean; open: number; total: number };
  retention: RetentionState & { months: number; reason: string | null };
  timezone: string; callName: string;
}
