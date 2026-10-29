// Prompt 924 (Etapa 4, I1) — the results of a call, as the applicant will be told them. Pure: the store gathers the rows, the routes check who may do what, the tests read the words.
//
//   What an administrator decided on the evaluation board (Advance / Reject / Waitlist) is INTERNAL until somebody with "Publish results" publishes it. Here that decision becomes what the applicant is told:
//   Advance -> "Selected" (or "Moves to the next phase" when the call has one more phase), Reject -> "Not selected", Waitlist -> "Waiting list" — the entity may rename each. An application whose eligibility is
//   "Not a fit" and that has no decision counts as "Not selected" (with the eligibility reason, only if the entity wants it). An application with neither is PENDING, and nothing is published while any is.
//   Each result has ONE message, in the call's language, with fields that fill themselves in. The feedback of an application is written by an administrator for that purpose, appended to the message only when it exists, and is
//   NEVER taken from an evaluator's comments or scores: nothing in this file (or in results-store.ts) touches them.
import { sanitizeRichText, richTextToPlain, RICH_MAX_HTML } from '@/lib/rich-text';
import type { Decision } from './eval-board';
import type { Call } from './types';

export const RESULT_KEYS = ['advance', 'reject', 'waitlist'] as const;
export type ResultKey = (typeof RESULT_KEYS)[number];

export interface ResultSettings {
  labels: Partial<Record<ResultKey, string>>;
  messages: Partial<Record<ResultKey, string>>;
  includeEligibilityReason: boolean;
  feedbackEnabled: boolean;
  contestationsEnabled: boolean;
  contestationDays: number;
  retentionMonths: number;
  nextStepsText: string;
  nextStepsDate: string | null;
  /** Nuno, 28/10/2026: an option per call, OFF by default. Only the grade an administrator VALIDATED is ever sent — never the average of the evaluations, never an evaluator's score. */
  shareGrade: boolean;
}

/** The defaults Nuno decided (28/10/2026): no feedback, no contestations (10 calendar days once on), data kept 24 months after the call is completed. */
export const DEFAULT_SETTINGS: ResultSettings = {
  labels: {}, messages: {}, includeEligibilityReason: false, feedbackEnabled: false, contestationsEnabled: false, contestationDays: 10, retentionMonths: 24, nextStepsText: '', nextStepsDate: null, shareGrade: false,
};

export const MAX_LABEL = 60;
export const MAX_FEEDBACK = 2000;
export const MAX_NEXT_STEPS = 2000;

/** The fields a message may use, in the order the editor offers them. */
export const PLACEHOLDERS = [
  { key: 'applicant_name', label: 'Applicant name' },
  { key: 'startup_name', label: 'Startup name' },
  { key: 'call_title', label: 'Call title' },
  { key: 'entity_name', label: 'Entity name' },
  { key: 'next_steps', label: 'Next steps' },
  { key: 'reference', label: 'Reference' },
] as const;
export type PlaceholderKey = (typeof PLACEHOLDERS)[number]['key'];
const PLACEHOLDER_KEYS = new Set<string>(PLACEHOLDERS.map((p) => p.key));

export const DEFAULT_LABELS: Record<ResultKey, string> = { advance: 'Selected', reject: 'Not selected', waitlist: 'Waiting list' };
export const NEXT_PHASE_LABEL = 'Moves to the next phase';

export function labelOf(key: ResultKey, settings: Pick<ResultSettings, 'labels'>, hasNextPhase: boolean): string {
  const own = (settings.labels[key] ?? '').trim();
  if (own) return own;
  return key === 'advance' && hasNextPhase ? NEXT_PHASE_LABEL : DEFAULT_LABELS[key];
}

// --- The words each result starts with, in the language of the call ---------------------------------------------------------------------------------------

type Lang = 'en' | 'pt' | 'es' | 'fr' | 'de' | 'it';
interface Words { dear: string; advance: string; advanceNext: string; reject: string; waitlist: string; regards: string; feedback: string; reason: string; score: string }
const WORDS: Record<Lang, Words> = {
  en: {
    dear: 'Dear {applicant_name},', regards: 'Kind regards,', feedback: 'Feedback', reason: 'Reason', score: 'Score',
    advance: '<p>We are pleased to tell you that {startup_name} has been selected in “{call_title}”.</p><p>{next_steps}</p>',
    advanceNext: '<p>We are pleased to tell you that {startup_name} moves to the next phase of “{call_title}”.</p><p>{next_steps}</p>',
    reject: '<p>Thank you for applying to “{call_title}”. After careful consideration, {startup_name} was not selected this time.</p>',
    waitlist: '<p>Thank you for applying to “{call_title}”. {startup_name} is on the waiting list: if a place becomes available, we will contact you.</p>',
  },
  pt: {
    dear: 'Caro(a) {applicant_name},', regards: 'Com os melhores cumprimentos,', feedback: 'Comentários', reason: 'Motivo', score: 'Pontuação',
    advance: '<p>Temos o prazer de informar que {startup_name} foi selecionada em “{call_title}”.</p><p>{next_steps}</p>',
    advanceNext: '<p>Temos o prazer de informar que {startup_name} passa à fase seguinte de “{call_title}”.</p><p>{next_steps}</p>',
    reject: '<p>Obrigado pela sua candidatura a “{call_title}”. Depois de uma análise cuidada, {startup_name} não foi selecionada desta vez.</p>',
    waitlist: '<p>Obrigado pela sua candidatura a “{call_title}”. {startup_name} está em lista de espera: se surgir uma vaga, entraremos em contacto.</p>',
  },
  es: {
    dear: 'Estimado/a {applicant_name}:', regards: 'Un cordial saludo,', feedback: 'Comentarios', reason: 'Motivo', score: 'Puntuación',
    advance: '<p>Nos complace informarle de que {startup_name} ha sido seleccionada en «{call_title}».</p><p>{next_steps}</p>',
    advanceNext: '<p>Nos complace informarle de que {startup_name} pasa a la siguiente fase de «{call_title}».</p><p>{next_steps}</p>',
    reject: '<p>Gracias por presentarse a «{call_title}». Tras un estudio cuidadoso, {startup_name} no ha sido seleccionada esta vez.</p>',
    waitlist: '<p>Gracias por presentarse a «{call_title}». {startup_name} está en lista de espera: si queda una plaza libre, nos pondremos en contacto.</p>',
  },
  fr: {
    dear: 'Bonjour {applicant_name},', regards: 'Cordialement,', feedback: 'Commentaires', reason: 'Motif', score: 'Note',
    advance: '<p>Nous avons le plaisir de vous informer que {startup_name} a été sélectionnée dans « {call_title} ».</p><p>{next_steps}</p>',
    advanceNext: '<p>Nous avons le plaisir de vous informer que {startup_name} passe à la phase suivante de « {call_title} ».</p><p>{next_steps}</p>',
    reject: '<p>Merci d’avoir candidaté à « {call_title} ». Après un examen attentif, {startup_name} n’a pas été sélectionnée cette fois.</p>',
    waitlist: '<p>Merci d’avoir candidaté à « {call_title} ». {startup_name} est sur liste d’attente : si une place se libère, nous vous contacterons.</p>',
  },
  de: {
    dear: 'Guten Tag {applicant_name},', regards: 'Mit freundlichen Grüßen', feedback: 'Rückmeldung', reason: 'Grund', score: 'Punktzahl',
    advance: '<p>Wir freuen uns, Ihnen mitzuteilen, dass {startup_name} bei „{call_title}“ ausgewählt wurde.</p><p>{next_steps}</p>',
    advanceNext: '<p>Wir freuen uns, Ihnen mitzuteilen, dass {startup_name} in die nächste Phase von „{call_title}“ übergeht.</p><p>{next_steps}</p>',
    reject: '<p>Vielen Dank für Ihre Bewerbung bei „{call_title}“. Nach sorgfältiger Prüfung wurde {startup_name} diesmal nicht ausgewählt.</p>',
    waitlist: '<p>Vielen Dank für Ihre Bewerbung bei „{call_title}“. {startup_name} steht auf der Warteliste: Wenn ein Platz frei wird, melden wir uns.</p>',
  },
  it: {
    dear: 'Gentile {applicant_name},', regards: 'Cordiali saluti,', feedback: 'Commenti', reason: 'Motivo', score: 'Punteggio',
    advance: '<p>Siamo lieti di comunicarle che {startup_name} è stata selezionata in «{call_title}».</p><p>{next_steps}</p>',
    advanceNext: '<p>Siamo lieti di comunicarle che {startup_name} passa alla fase successiva di «{call_title}».</p><p>{next_steps}</p>',
    reject: '<p>Grazie per aver partecipato a «{call_title}». Dopo un attento esame, {startup_name} non è stata selezionata questa volta.</p>',
    waitlist: '<p>Grazie per aver partecipato a «{call_title}». {startup_name} è in lista d’attesa: se si libera un posto, la contatteremo.</p>',
  },
};
const langOf = (code: string | null | undefined): Lang => (code && code in WORDS ? (code as Lang) : 'en');

/** The text a result's message starts with: written in the call's language (English if it is none of ours), ending with the entity's name. */
export function defaultMessage(key: ResultKey, language: string | null | undefined, hasNextPhase: boolean): string {
  const w = WORDS[langOf(language)];
  const body = key === 'advance' ? (hasNextPhase ? w.advanceNext : w.advance) : w[key];
  return `<p>${w.dear}</p>${body}<p>${w.regards}<br>{entity_name}</p>`;
}

/** The message of a result as the editor shows it: the entity's own, or the default text to start from. */
export function messageOf(key: ResultKey, settings: Pick<ResultSettings, 'messages'>, language: string | null | undefined, hasNextPhase: boolean): string {
  const own = settings.messages[key];
  return own && richTextToPlain(own).trim() ? own : defaultMessage(key, language, hasNextPhase);
}

// --- Filling in ------------------------------------------------------------------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The fields a message uses that do not exist (so a typo is caught when it is written, not when 200 people receive it). */
export function unknownPlaceholders(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/\{([a-z_]+)\}/gi)) if (!PLACEHOLDER_KEYS.has(m[1])) found.add(m[1]);
  return [...found];
}

/** Puts the values in. Every value is escaped (an applicant's name is text, never markup); a paragraph left empty by an empty field (no next steps) disappears. */
export function fillPlaceholders(html: string, values: Partial<Record<PlaceholderKey, string>>): string {
  const filled = html.replace(/\{([a-z_]+)\}/gi, (m, key: string) => (PLACEHOLDER_KEYS.has(key) ? esc(values[key as PlaceholderKey] ?? '') : m));
  return filled.replace(/<p>\s*<\/p>/g, '').replace(/<p>\s*<br>\s*<\/p>/g, '');
}

/** "On 14 Nov 2026: join us at …" — the text and the date of what comes next, as one sentence block (empty when there is nothing to say). */
export function nextStepsText(settings: Pick<ResultSettings, 'nextStepsText' | 'nextStepsDate'>, formatDay: (iso: string) => string): string {
  const text = settings.nextStepsText.trim();
  const day = settings.nextStepsDate ? formatDay(settings.nextStepsDate) : '';
  if (!text && !day) return '';
  return day && text ? `${day}: ${text}` : day || text;
}

// --- Who gets which result ---------------------------------------------------------------------------------------------------------------------------

export type EligibilityStatus = 'fit' | 'not_fit' | 'to_validate';
export interface AppFacts {
  applicationId: string; reference: string | null; startupName: string | null; applicantUserId: string;
  decision: Decision | null; eligibility: EligibilityStatus | null; eligibilityReason: string | null;
  feedback: string | null;
  /** The grade an administrator validated for this application (0–100 %), or none. Never computed from the evaluations. */
  grade: number | null;
}
export interface Outcome { result: ResultKey | null; source: 'decision' | 'eligibility' | null }

/** The result of one application, or none yet. A decision always wins; without one, a "Not a fit" is "Not selected". */
export function outcomeOf(a: Pick<AppFacts, 'decision' | 'eligibility'>): Outcome {
  if (a.decision) return { result: a.decision, source: 'decision' };
  if (a.eligibility === 'not_fit') return { result: 'reject', source: 'eligibility' };
  return { result: null, source: null };
}

export interface Summary { total: number; counts: Record<ResultKey, number>; pending: AppFacts[]; byEligibility: number; /** Applications whose result comes from a decision and that have no validated grade (only matters when the grade is shared). */ needGrade: AppFacts[] }

export function summarise(apps: AppFacts[]): Summary {
  const counts: Record<ResultKey, number> = { advance: 0, reject: 0, waitlist: 0 };
  const pending: AppFacts[] = [];
  const needGrade: AppFacts[] = [];
  let byEligibility = 0;
  for (const a of apps) {
    const o = outcomeOf(a);
    if (!o.result) { pending.push(a); continue; }
    counts[o.result]++;
    if (o.source === 'eligibility') byEligibility++;
    else if (a.grade === null || a.grade === undefined) needGrade.push(a);
  }
  return { total: apps.length, counts, pending, byEligibility, needGrade };
}

/**
 * The phase whose results are being prepared: the first phase of the call that has not been published yet (a call with no phase row has one unnamed round, keyed ''). `hasNextPhase` says whether "Selected"
 * means "moves to the next phase". `allPublished` is true when every phase has gone out.
 */
export function roundOf(phases: { id: string }[], publishedPhaseIds: string[]): { phaseId: string | null; hasNextPhase: boolean; allPublished: boolean } {
  if (phases.length === 0) return { phaseId: null, hasNextPhase: false, allPublished: publishedPhaseIds.includes('') };
  const i = phases.findIndex((p) => !publishedPhaseIds.includes(p.id));
  if (i < 0) return { phaseId: phases[phases.length - 1].id, hasNextPhase: false, allPublished: true };
  return { phaseId: phases[i].id, hasNextPhase: i < phases.length - 1, allPublished: false };
}

export type PublishBlocker = { code: 'no_applications' | 'pending' | 'call_not_closed' | 'call_completed' | 'already_published' | 'missing_grade' | 'scheduled'; text: string };

/** Why the results cannot be published yet — every reason, in words. Empty means they can. */
export function blockersOf(input: { summary: Summary; callStatus: string; alreadyPublished: boolean; shareGrade?: boolean }): PublishBlocker[] {
  const out: PublishBlocker[] = [];
  const { summary } = input;
  if (input.callStatus === 'completed') out.push({ code: 'call_completed', text: 'The call is completed: nothing can be published.' });
  else if (input.callStatus !== 'closed' && input.callStatus !== 'evaluating' && input.callStatus !== 'results_published') out.push({ code: 'call_not_closed', text: 'The call is not closed yet. Close it (or wait for its deadline) before publishing the results.' });
  if (input.alreadyPublished) out.push({ code: 'already_published', text: 'The results of this phase were already published.' });
  if (summary.total === 0) out.push({ code: 'no_applications', text: 'There are no submitted applications to publish a result for.' });
  if (summary.pending.length > 0) out.push({ code: 'pending', text: `${summary.pending.length} application${summary.pending.length === 1 ? ' has' : 's have'} no decision yet. Every application needs one before the results can be published.` });
  // The grade is shared only if the entity asked for it, and then every evaluated application needs the one an administrator validated: a score is never left to be guessed.
  if (input.shareGrade && summary.needGrade.length > 0) out.push({ code: 'missing_grade', text: `${summary.needGrade.length} application${summary.needGrade.length === 1 ? ' has' : 's have'} no validated grade yet. The grade is shared with the applicants, so each one needs it before the results can be published.` });
  return out;
}

// --- The message of one application --------------------------------------------------------------------------------------------------------------------

export interface MessageInput {
  settings: ResultSettings;
  call: Pick<Call, 'name' | 'contentLanguage'>;
  entityName: string;
  app: AppFacts;
  applicantName: string;
  hasNextPhase: boolean;
  formatDay: (iso: string) => string;
}
export interface BuiltMessage { result: ResultKey; label: string; subject: string; html: string; text: string; grade: number | null }

/**
 * What one applicant is told: the message of their result with the fields filled in, then — only if the administrator wrote one — the feedback, and — only if the entity wants it and the result comes from the
 * eligibility — the reason. The evaluators' comments and scores are not an input of this function: they cannot be in the message.
 */
export function buildMessage(input: MessageInput): BuiltMessage | null {
  const outcome = outcomeOf(input.app);
  if (!outcome.result) return null;
  const { settings, call, app } = input;
  const key = outcome.result;
  const w = WORDS[langOf(call.contentLanguage)];
  const values: Partial<Record<PlaceholderKey, string>> = {
    applicant_name: input.applicantName, startup_name: app.startupName ?? '', call_title: call.name, entity_name: input.entityName, reference: app.reference ?? '',
    // Next steps are only told to those who move on: a "Not selected" does not hear about a date it is not part of.
    next_steps: key === 'advance' ? nextStepsText(settings, input.formatDay) : '',
  };
  let html = fillPlaceholders(sanitizeRichText(messageOf(key, settings, call.contentLanguage, input.hasNextPhase)), values);
  if (outcome.source === 'eligibility' && settings.includeEligibilityReason && app.eligibilityReason?.trim()) html += `<p><strong>${esc(w.reason)}:</strong> ${esc(app.eligibilityReason.trim())}</p>`;
  // The validated grade, and only that: shared if the call says so, only for a result that comes from a decision (an eligibility "Not a fit" was never evaluated).
  const grade = settings.shareGrade && outcome.source === 'decision' && typeof app.grade === 'number' ? app.grade : null;
  if (grade !== null) html += `<p><strong>${esc(w.score)}:</strong> ${esc(formatGrade(grade))}</p>`;
  const feedback = settings.feedbackEnabled ? (app.feedback ?? '').trim() : '';
  if (feedback) html += `<h3>${esc(w.feedback)}</h3><p>${esc(feedback).replace(/\n/g, '<br>')}</p>`;
  const label = labelOf(key, settings, input.hasNextPhase);
  return { result: key, label, subject: `${call.name}: ${label}`, html, text: richTextToPlain(html), grade };
}

// --- Writing the settings -----------------------------------------------------------------------------------------------------------------------------

export type ParsedSettings = { ok: true; patch: Partial<ResultSettings> } | { ok: false; error: string };
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** What the editor sends: only the parts that are present are changed. Every text is cleaned; a message is rebuilt from the closed list of tags and may use only the fields that exist. */
export function parseSettingsPatch(raw: unknown): ParsedSettings {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Nothing to save.' };
  const b = raw as Record<string, unknown>;
  const patch: Partial<ResultSettings> = {};
  if (b.labels !== undefined) {
    const labels: Partial<Record<ResultKey, string>> = {};
    for (const k of RESULT_KEYS) {
      const v = (b.labels as Record<string, unknown> | null)?.[k];
      if (typeof v !== 'string' || !v.trim()) continue;                       // empty = the default name
      const t = v.trim();
      if (t.length > MAX_LABEL) return { ok: false, error: `A result name can have at most ${MAX_LABEL} characters.` };
      labels[k] = t;
    }
    patch.labels = labels;
  }
  if (b.messages !== undefined) {
    const messages: Partial<Record<ResultKey, string>> = {};
    for (const k of RESULT_KEYS) {
      const v = (b.messages as Record<string, unknown> | null)?.[k];
      if (typeof v !== 'string' || !richTextToPlain(v).trim()) continue;      // empty = the default message
      const html = sanitizeRichText(v);
      if (html.length > RICH_MAX_HTML) return { ok: false, error: 'A message is too long.' };
      const unknown = unknownPlaceholders(html);
      if (unknown.length > 0) return { ok: false, error: `The field ${unknown.map((u) => `{${u}}`).join(', ')} does not exist. Use: ${PLACEHOLDERS.map((p) => `{${p.key}}`).join(', ')}.` };
      messages[k] = html;
    }
    patch.messages = messages;
  }
  for (const k of ['includeEligibilityReason', 'feedbackEnabled', 'contestationsEnabled', 'shareGrade'] as const) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'boolean') return { ok: false, error: 'Invalid setting.' };
    patch[k] = b[k] as boolean;
  }
  if (b.contestationDays !== undefined) {
    const n = Number(b.contestationDays);
    if (!Number.isInteger(n) || n < 1 || n > 90) return { ok: false, error: 'The contestation period is between 1 and 90 days.' };
    patch.contestationDays = n;
  }
  if (b.retentionMonths !== undefined) {
    const n = Number(b.retentionMonths);
    if (!Number.isInteger(n) || n < 1 || n > 120) return { ok: false, error: 'The retention period is between 1 and 120 months.' };
    patch.retentionMonths = n;
  }
  if (b.nextStepsText !== undefined) {
    if (typeof b.nextStepsText !== 'string') return { ok: false, error: 'Invalid next steps.' };
    if (b.nextStepsText.length > MAX_NEXT_STEPS) return { ok: false, error: `The next steps can have at most ${MAX_NEXT_STEPS} characters.` };
    patch.nextStepsText = b.nextStepsText.trim();
  }
  if (b.nextStepsDate !== undefined) {
    if (b.nextStepsDate !== null && b.nextStepsDate !== '' && !isDay(b.nextStepsDate)) return { ok: false, error: 'Invalid date for the next phase.' };
    patch.nextStepsDate = b.nextStepsDate ? (b.nextStepsDate as string) : null;
  }
  return Object.keys(patch).length > 0 ? { ok: true, patch } : { ok: false, error: 'Nothing to save.' };
}

export function cleanFeedback(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (raw !== null && typeof raw !== 'string') return { ok: false, error: 'Invalid feedback.' };
  const text = (raw ?? '').trim();
  if (text.length > MAX_FEEDBACK) return { ok: false, error: `The feedback can have at most ${MAX_FEEDBACK} characters.` };
  return { ok: true, text };
}

// --- What the Results tab reads (the store builds it, the screen draws it) ------------------------------------------------------------------------------

export interface PrepareApplication { applicationId: string; reference: string | null; startupName: string | null; result: ResultKey | null; label: string | null; source: 'decision' | 'eligibility' | null; feedback: string; /** The grade validated for this application (shared only if the call says so). */ grade: number | null }
export interface PrepareView {
  ok: true;
  settings: ResultSettings;
  labels: Record<ResultKey, string>; messages: Record<ResultKey, string>;
  defaults: { labels: Record<ResultKey, string>; messages: Record<ResultKey, string> };
  placeholders: typeof PLACEHOLDERS;
  phase: { id: string | null; name: string | null; hasNext: boolean };
  summary: { total: number; counts: Record<ResultKey, number>; byEligibility: number; pending: { applicationId: string; reference: string | null; startupName: string | null }[] };
  blockers: PublishBlocker[];
  applications: PrepareApplication[];
  callStatus: string; language: string; timezone: string;
  /** The publication of this phase is scheduled, running or done: what was prepared is fixed, and why. */
  locked: boolean; lockedReason: string | null;
}

// --- The validated grade ------------------------------------------------------------------------------------------------------------------------------

/** "82%", "82.5%", "7.25%": up to two decimals, no trailing zeros. */
export const formatGrade = (n: number): string => `${Number(n.toFixed(2))}%`;

/** What an administrator types as the validated grade: 0–100, up to two decimals; empty clears it. */
export function cleanGrade(raw: unknown): { ok: true; grade: number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, grade: null };
  const t = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().replace(',', '.') : '';
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return { ok: false, error: 'The grade is a number from 0 to 100, with up to two decimals.' };
  const n = Number(t);
  if (n < 0 || n > 100) return { ok: false, error: 'The grade is a number from 0 to 100, with up to two decimals.' };
  return { ok: true, grade: n };
}

// --- Publishing: when, how it is confirmed, how an email is retried ------------------------------------------------------------------------------------

export const MIN_SCHEDULE_MINUTES = 2;
export const MAX_SCHEDULE_DAYS = 365;

/** Why a time cannot be scheduled (null when it can): it must be a real moment, a couple of minutes ahead at least, and not more than a year away. */
export function scheduleProblem(atIso: unknown, now: Date): string | null {
  if (typeof atIso !== 'string' || Number.isNaN(Date.parse(atIso))) return 'Choose a date and a time.';
  const at = Date.parse(atIso);
  if (at < now.getTime() + MIN_SCHEDULE_MINUTES * 60_000) return `Choose a time at least ${MIN_SCHEDULE_MINUTES} minutes from now.`;
  if (at > now.getTime() + MAX_SCHEDULE_DAYS * 86_400_000) return 'Choose a date within the next year.';
  return null;
}

/** The confirmation written in the page: the person types the name of the call. Spaces and capitals do not matter; the name itself does. */
export const confirmationMatches = (typed: unknown, callName: string): boolean => {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return typeof typed === 'string' && norm(callName) !== '' && norm(typed) === norm(callName);
};

/** How many times an email is tried, and how long it waits after each failure: 5 minutes, 30 minutes, 2 hours, 6 hours. */
export const MAX_SEND_ATTEMPTS = 5;
const BACKOFF_MINUTES = [5, 30, 120, 360];
export const backoffMs = (attemptsSoFar: number): number => BACKOFF_MINUTES[Math.min(Math.max(attemptsSoFar, 1), BACKOFF_MINUTES.length) - 1] * 60_000;

/** A provider answer that says the ADDRESS is the problem will not get better by waiting: it is "bounced". Anything else (a timeout, a rate limit, a 5xx) is tried again. */
export function classifyEmailFailure(message: string | null | undefined): 'permanent' | 'temporary' {
  return /invalid (email|address|recipient)|not a valid|does not exist|mailbox|no such user|unknown (user|recipient)|undeliverable|rejected|suppress/i.test(message ?? '') ? 'permanent' : 'temporary';
}

export type SendStatus = 'queued' | 'sent' | 'bounced' | 'failed';
export const SEND_LABELS: Record<SendStatus, string> = { queued: 'Waiting', sent: 'Sent', bounced: 'Bounced', failed: 'Failed' };

/** What the Publish screen reads. */
export interface SendRow { sendId: string; applicationId: string; reference: string | null; startupName: string | null; label: string; status: SendStatus; attempts: number; error: string | null; sentAt: string | null }
export interface BatchInfo { id: string; status: 'scheduled' | 'publishing' | 'published' | 'cancelled'; scheduledAt: string | null; publishedAt: string | null; publishedBy: string | null; total: number; counts: Partial<Record<ResultKey, number>> }
export interface PublicationView {
  ok: true;
  phase: { id: string | null; name: string | null; hasNext: boolean };
  summary: { total: number; counts: Record<ResultKey, number>; emails: number };
  blockers: PublishBlocker[];
  labels: Record<ResultKey, string>;
  subjects: Record<ResultKey, string>;
  messages: Record<ResultKey, string>;
  /** The live batch of this round (scheduled, publishing or published), or null. */
  batch: BatchInfo | null;
  /** Every phase published so far, newest first. */
  history: BatchInfo[];
  sends: { counts: Record<SendStatus, number>; rows: SendRow[] };
  timezone: string; callName: string; callStatus: string; locked: boolean;
}
