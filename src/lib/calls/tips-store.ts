import 'server-only';
// Prompt 929 (B) — the tips against the database. For each application whose current result is "not selected" (a published rejection that came from an evaluation) it waits until the entity's own reply has had its
// time (24 hours after publishing; or until the contestation deadline when contestations are offered, so a tip never arrives in the middle of a possible appeal), checks every condition AGAIN at the moment of
// sending — the entity still allows it, the applicant has not opted out, the application was evaluated enough — chooses the tips with the internal engine (tips.ts: no AI, nothing leaves the platform), and sends
// ONE separate email from Sherlock Deal. One row per application in call_tips says what happened; it never holds a score, a position or a comment.
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasOptedOut } from '@/lib/email-preferences';
import { loadCall } from './store';
import { loadSettings } from './results-store';
import { contestDeadline, DAY_MS } from './contestations';
import { gatherInputs, loadRules } from './selection-store';
import { emailOf } from './applicant/notices';
import { buildTipsEmail, sendTipsEmail } from './tips-email';
import { chooseTips, sentenceFor, type TipsInput } from './tips';
import type { TipLanguage } from './tips-templates';
import type { AnswerValue, Call, FormField } from './types';

type Row = Record<string, unknown>;

export const TIPS_DELAY_HOURS = 24;
export const MAX_TIPS_ATTEMPTS = 3;
const SHORT_ANSWER_CHARS = 80;

export const languageOf = (call: Pick<Call, 'contentLanguage'>): TipLanguage => (String(call.contentLanguage).toLowerCase().startsWith('pt') ? 'pt' : 'en');

/** When the tips of a result may go out: never before the entity's reply has had its time. */
export function tipsDueAt(publishedAt: string, settings: { contestationsEnabled: boolean; contestationDays: number }): number {
  const base = Date.parse(publishedAt) + TIPS_DELAY_HOURS * 3_600_000;
  const contest = settings.contestationsEnabled ? Date.parse(contestDeadline(publishedAt, settings.contestationDays)) + DAY_MS : 0;
  return Math.max(base, contest);
}

const emptyAnswer = (v: AnswerValue): boolean => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** What the form itself shows was missing (counts only — never the content of an answer). */
export function formGaps(fields: FormField[], answers: Record<string, AnswerValue>): { missingOptionalDocuments: number; shortAnswers: number } {
  let missingOptionalDocuments = 0; let shortAnswers = 0;
  for (const f of fields) {
    const a = answers[f.id];
    if (f.kind === 'file' && !f.required && emptyAnswer(a)) missingOptionalDocuments++;
    if (f.kind === 'long_text' && typeof a === 'string' && a.trim().length > 0 && a.trim().length < SHORT_ANSWER_CHARS) shortAnswers++;
  }
  return { missingOptionalDocuments, shortAnswers };
}

/** An example for the entity, built ONLY from the model sentences (one each of three categories) — never from a real application. */
export function exampleTipsEmail(call: Pick<Call, 'name' | 'contentLanguage'>) {
  const language = languageOf(call);
  const sentences = (['team', 'market', 'finance'] as const).map((c) => sentenceFor(c, language, 'example'));
  return buildTipsEmail({ callName: call.name, language, sentences, userId: 'example' });
}

export interface TipsPlan { applicationId: string; userId: string; input: TipsInput }

/** For one call: the input of the engine for each not-selected application, from the board (the same numbers the entity sees — and that never leave this module). */
export async function planFor(admin: SupabaseClient, call: Call, applicationIds: string[]): Promise<TipsPlan[]> {
  const stored = await loadRules(admin, call.id);
  const inputs = await gatherInputs(admin, call, stored);
  const rows = inputs.board.rows;
  const selected = rows.filter((r) => r.decision?.decision === 'advance');
  const selectedAvg: Record<string, number> = {};
  for (const c of inputs.board.criteria) {
    const xs = selected.map((r) => r.perCriterion.find((p) => p.criterionId === c.id)?.percent).filter((x): x is number => typeof x === 'number');
    if (xs.length) selectedAvg[c.id] = xs.reduce((a, b) => a + b, 0) / xs.length;
  }
  const { data: apps } = await admin.from('call_applications').select('id, applicant_user_id').eq('call_id', call.id).in('id', applicationIds);
  const userOf = new Map(((apps ?? []) as Row[]).map((a) => [a.id as string, a.applicant_user_id as string]));
  const weighted = inputs.board.scoring.mode === 'weighted';
  const language = languageOf(call);
  const plans: TipsPlan[] = [];
  for (const id of applicationIds) {
    const row = rows.find((r) => r.applicationId === id);
    const cand = inputs.candidates.find((c) => c.applicationId === id);
    const userId = userOf.get(id);
    if (!row || !userId) continue;
    const gaps = formGaps(inputs.fields, (cand?.answers ?? {}) as Record<string, AnswerValue>);
    plans.push({
      applicationId: id, userId,
      input: {
        language, applicationId: id, weighted, selectedCount: selected.length, submittedEvaluations: row.submitted,
        criteria: inputs.board.criteria.map((c) => ({ id: c.id, name: c.name, guidance: c.guidance, weight: c.weight })),
        mine: Object.fromEntries(row.perCriterion.map((p) => [p.criterionId, p.percent])), selected: selectedAvg, ...gaps,
      },
    });
  }
  return plans;
}

export interface TipsRun { considered: number; sent: number; invitationOnly: number; skipped: number; failed: number; waiting: number }

/** The daily step. Independent of the result emails: a failure here never touches them. Never throws for one application. */
export async function processTips(admin: SupabaseClient, opts: { now?: Date; limit?: number; budgetMs?: number; callId?: string } = {}): Promise<TipsRun> {
  const now = opts.now ?? new Date(); const started = Date.now(); const budget = opts.budgetMs ?? 40_000;
  const out: TipsRun = { considered: 0, sent: 0, invitationOnly: 0, skipped: 0, failed: 0, waiting: 0 };
  let q = admin.from('call_results').select('call_id, application_id, published_at').eq('is_current', true).eq('result', 'reject').eq('source', 'decision');
  if (opts.callId) q = q.eq('call_id', opts.callId);
  const { data } = await q;
  const results = ((data ?? []) as Row[]);
  if (results.length === 0) return out;
  const { data: doneRows } = await admin.from('call_tips').select('application_id, status, attempts').in('application_id', results.map((r) => r.application_id as string));
  const done = new Map(((doneRows ?? []) as Row[]).map((d) => [d.application_id as string, d]));
  const todo = results.filter((r) => { const d = done.get(r.application_id as string); return !d || (d.status === 'failed' && Number(d.attempts ?? 1) < MAX_TIPS_ATTEMPTS); });
  const byCall = new Map<string, Row[]>();
  for (const r of todo) byCall.set(r.call_id as string, [...(byCall.get(r.call_id as string) ?? []), r]);

  let handled = 0;
  for (const [callId, list] of byCall) {
    if (Date.now() - started > budget || handled >= (opts.limit ?? 200)) { out.waiting += list.length; continue; }
    const call = await loadCall(admin, callId);
    if (!call) continue;
    const settings = await loadSettings(admin, callId);
    if (settings.tipsEnabled !== true) continue;                                              // the entity does not allow it: nothing is recorded, so allowing it later still works
    const due = list.filter((r) => tipsDueAt(String(r.published_at), settings) <= now.getTime());
    out.waiting += list.length - due.length;
    if (due.length === 0) continue;
    const plans = await planFor(admin, call, due.map((r) => r.application_id as string));
    for (const plan of plans) {
      if (Date.now() - started > budget) { out.waiting++; continue; }
      out.considered++; handled++;
      const prior = done.get(plan.applicationId);
      const attempts = prior ? Number(prior.attempts ?? 1) + 1 : 1;
      const record = async (row: Row) => {
        const base = { call_id: callId, application_id: plan.applicationId, user_id: plan.userId, language: plan.input.language, attempts, ...row };
        if (prior) await admin.from('call_tips').update(base).eq('application_id', plan.applicationId); else await admin.from('call_tips').insert(base);
      };
      if (await hasOptedOut(admin, plan.userId, 'tips_opt_out')) { await record({ status: 'skipped', skip_reason: 'opted_out' }); out.skipped++; continue; }
      const choice = chooseTips(plan.input);
      if (choice.reason === 'not_enough_evaluations' || choice.reason === 'no_comparison') { await record({ status: 'skipped', skip_reason: choice.reason }); out.skipped++; continue; }
      const to = await emailOf(admin, plan.userId).catch(() => null);
      if (!to) { await record({ status: 'skipped', skip_reason: 'no_email' }); out.skipped++; continue; }
      const email = buildTipsEmail({ callName: call.name, language: plan.input.language, sentences: choice.sentences, userId: plan.userId });
      const ok = await sendTipsEmail(to, email);
      const status = !ok ? 'failed' : choice.sentences.length ? 'sent' : 'invitation_only';
      await record({ status, skip_reason: choice.sentences.length ? null : choice.reason, categories: choice.categories, sentences: choice.sentences, sent_at: ok ? now.toISOString() : null });
      if (!ok) out.failed++; else if (status === 'sent') out.sent++; else out.invitationOnly++;
    }
  }
  return out;
}
