// Prompt 924 (Etapa 4, I2) — publishing the results. Nothing reaches an applicant before somebody with "Publish results" does this, and it is done for ALL the applications of a phase at once (no partial sending in v1).
//
//   publishNow / schedule / cancelSchedule   one batch per call and phase (scheduled → publishing → published). A publication is a series of IDEMPOTENT steps, each safe to repeat: the results (one per application and
//                                            phase), the move of those who advance to the next phase, the in-app notices, and the queue of emails — so a request that dies half way is finished by the next one, never doubled.
//   processSends / resendOne                 the emails leave from a queue: tried again with a growing wait when the failure is temporary (a timeout, a rate limit), "bounced" when the address is the problem,
//                                            "failed" after five tries — and a failed email never keeps the result from showing in the app. The administrator sees each one and can resend it.
//   runDueBatches                            what was scheduled and whose time has come. The plan allows one cron a day, so this runs when the daily job does, and whenever somebody opens the results or their
//                                            applications: a publication scheduled for 15:00 goes out at the first opening after 15:00, or at the next daily run — never earlier, and never twice.
//   sendTestEmails                           one email of each result, with example data, to the administrator who asked (never to an applicant).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDayInZone } from './tz';
import { loadCall, promoterName } from './store';
import { applicantNameOf, liveBatches, loadFacts, loadRoundState, loadSettings, type Move } from './results-store';
import { sendResultEmail } from './results-email';
import { emailOf } from './applicant/notices';
import {
  MAX_SEND_ATTEMPTS, RESULT_KEYS, backoffMs, blockersOf, buildMessage, classifyEmailFailure, confirmationMatches, labelOf, messageOf, outcomeOf, scheduleProblem, summarise, unknownFieldsFor,
  type AppFacts, type BuiltMessage, type PublicationView, type ResultKey, type ResultSettings, type SendRow, type SendStatus,
} from './results';
import type { Call } from './types';

type Row = Record<string, unknown>;
const CHUNK = 100;
const TEST_EMAILS_PER_HOUR = 6;
const chunks = <T,>(list: T[], n: number): T[][] => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

// --- What the Publish screen reads ----------------------------------------------------------------------------------------------------------------------

export async function loadPublication(admin: SupabaseClient, call: Call): Promise<PublicationView> {
  const settings = await loadSettings(admin, call.id);
  const state = await loadRoundState(admin, call);
  const facts = await loadFacts(admin, call, state.phases, state.round.phaseId);
  const summary = summarise(facts);
  const hasNext = state.round.hasNextPhase;
  const batches = await liveBatches(admin, call.id);
  const published = batches.filter((b) => b.status === 'published');
  const labels = Object.fromEntries(RESULT_KEYS.map((k) => [k, labelOf(k, settings, hasNext)])) as Record<ResultKey, string>;
  const batch = state.batch ?? (state.round.allPublished ? published[published.length - 1] ?? null : null);

  // The emails of the calls's results, with who they went to (the entity sees the startup and the reference, never an address).
  const { data: sendRows } = await admin.from('call_result_sends').select('id, result_id, status, attempts, last_error, sent_at').eq('call_id', call.id);
  const { data: resRows } = await admin.from('call_results').select('id, application_id, label').eq('call_id', call.id).eq('is_current', true);
  const results = new Map(((resRows ?? []) as Row[]).map((r) => [r.id as string, r]));
  const appIds = [...new Set(((resRows ?? []) as Row[]).map((r) => r.application_id as string))];
  const apps = new Map<string, { reference: string | null; org: string | null }>();
  for (const part of chunks(appIds, CHUNK)) {
    const { data } = await admin.from('call_applications').select('id, reference, startup_org_id').in('id', part);
    for (const a of (data ?? []) as Row[]) apps.set(a.id as string, { reference: (a.reference as string | null) ?? null, org: (a.startup_org_id as string | null) ?? null });
  }
  const orgIds = [...new Set([...apps.values()].map((a) => a.org).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  for (const part of chunks(orgIds, CHUNK)) { const { data } = await admin.from('orgs').select('id, name').in('id', part); for (const o of (data ?? []) as Row[]) names.set(o.id as string, String(o.name ?? '')); }
  const counts: Record<SendStatus, number> = { queued: 0, sent: 0, bounced: 0, failed: 0 };
  const rows: SendRow[] = [];
  for (const s of (sendRows ?? []) as Row[]) {
    const status = (s.status as SendStatus) ?? 'queued';
    counts[status]++;
    const res = results.get(s.result_id as string);
    const app = res ? apps.get(res.application_id as string) : undefined;
    if (rows.length < 500) rows.push({ sendId: s.id as string, applicationId: String(res?.application_id ?? ''), reference: app?.reference ?? null, startupName: app?.org ? names.get(app.org) ?? null : null, label: String(res?.label ?? ''), status, attempts: Number(s.attempts ?? 0), error: (s.last_error as string | null) ?? null, sentAt: (s.sent_at as string | null) ?? null });
  }
  rows.sort((a, b) => ((a.reference ?? a.applicationId) < (b.reference ?? b.applicationId) ? -1 : 1));

  return {
    ok: true,
    phase: { id: state.round.phaseId, name: state.phase?.name ?? null, hasNext },
    summary: { total: summary.total, counts: summary.counts, emails: summary.total - summary.pending.length },
    blockers: blockersOf({ summary, callStatus: call.status, alreadyPublished: state.round.allPublished, shareGrade: settings.shareGrade, unknownFields: unknownFieldsFor(settings, call.contentLanguage, hasNext) }),
    labels,
    subjects: Object.fromEntries(RESULT_KEYS.map((k) => [k, `${call.name}: ${labels[k]}`])) as Record<ResultKey, string>,
    messages: Object.fromEntries(RESULT_KEYS.map((k) => [k, messageOf(k, settings, call.contentLanguage, hasNext)])) as Record<ResultKey, string>,
    batch: batch ? { id: batch.id, status: batch.status, scheduledAt: batch.scheduledAt, publishedAt: batch.publishedAt, publishedBy: batch.publishedBy, total: batch.total, counts: batch.counts } : null,
    history: published.slice().reverse().map((b) => ({ id: b.id, status: b.status, scheduledAt: b.scheduledAt, publishedAt: b.publishedAt, publishedBy: b.publishedBy, total: b.total, counts: b.counts })),
    sends: { counts, rows },
    timezone: call.timezone, callName: call.name, callStatus: call.status, locked: state.locked,
  };
}

// --- Publishing ---------------------------------------------------------------------------------------------------------------------------------------

/** The things that must hold before anything is published or scheduled, in one place. */
async function readiness(admin: SupabaseClient, call: Call, confirmName: unknown): Promise<Move<{ state: Awaited<ReturnType<typeof loadRoundState>>; settings: ResultSettings }>> {
  if (call.status === 'archived') return { ok: false, status: 409, error: 'An archived call cannot be changed.' };
  if (!confirmationMatches(confirmName, call.name)) return { ok: false, status: 400, error: 'Type the name of the call to confirm.' };
  const settings = await loadSettings(admin, call.id);
  const state = await loadRoundState(admin, call);
  const facts = await loadFacts(admin, call, state.phases, state.round.phaseId);
  const blockers = blockersOf({ summary: summarise(facts), callStatus: call.status, alreadyPublished: state.round.allPublished, shareGrade: settings.shareGrade, unknownFields: unknownFieldsFor(settings, call.contentLanguage, state.round.hasNextPhase) });
  if (blockers.length > 0) return { ok: false, status: 409, error: blockers[0].text };
  return { ok: true, state, settings };
}

export async function publishNow(admin: SupabaseClient, call: Call, actor: string, confirmName: unknown, now: Date = new Date()): Promise<Move<{ published: number }>> {
  const ready = await readiness(admin, call, confirmName);
  if (!ready.ok) return ready;
  if (ready.state.batch?.status === 'scheduled') return { ok: false, status: 409, error: 'A publication is already scheduled. Cancel the schedule first to publish now.' };
  // A batch left half way by a request that died is finished, never started a second time.
  let batchId = ready.state.batch?.status === 'publishing' ? ready.state.batch.id : null;
  if (!batchId) {
    const ins = await admin.from('call_result_batches').insert({ call_id: call.id, phase_id: ready.state.round.phaseId, status: 'publishing', published_by: actor, settings: snapshot(ready.settings) }).select('id').single();
    if (ins.error || !ins.data) return { ok: false, status: 409, error: 'These results are already being published. Reload to see where they are.' };
    batchId = (ins.data as Row).id as string;
  }
  const done = await runBatch(admin, call, batchId, actor, false, now);
  return done.ok ? { ok: true, published: done.published } : done;
}

export async function schedule(admin: SupabaseClient, call: Call, actor: string, atIso: unknown, confirmName: unknown, now: Date = new Date()): Promise<Move<{ scheduledAt: string }>> {
  const problem = scheduleProblem(atIso, now);
  if (problem) return { ok: false, status: 400, error: problem };
  const ready = await readiness(admin, call, confirmName);
  if (!ready.ok) return ready;
  if (ready.state.batch) return { ok: false, status: 409, error: ready.state.batch.status === 'scheduled' ? 'A publication is already scheduled. Cancel it first to schedule another.' : 'These results are being published right now.' };
  const at = new Date(Date.parse(atIso as string)).toISOString();
  const ins = await admin.from('call_result_batches').insert({ call_id: call.id, phase_id: ready.state.round.phaseId, status: 'scheduled', scheduled_at: at, scheduled_by: actor, settings: snapshot(ready.settings) }).select('id').single();
  if (ins.error) return { ok: false, status: 409, error: 'A publication is already scheduled or done for this phase.' };
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'results_scheduled', actor_user_id: actor, detail: { at, phase_id: ready.state.round.phaseId } });
  return { ok: true, scheduledAt: at };
}

export async function cancelSchedule(admin: SupabaseClient, call: Call, actor: string): Promise<Move> {
  const state = await loadRoundState(admin, call);
  if (state.batch?.status !== 'scheduled') return { ok: false, status: 409, error: 'No publication is scheduled.' };
  const upd = await admin.from('call_result_batches').update({ status: 'cancelled' }).eq('id', state.batch.id).eq('status', 'scheduled').select('id');
  if (upd.error || ((upd.data ?? []) as Row[]).length === 0) return { ok: false, status: 409, error: 'It started in the meantime: reload to see where the results are.' };
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'results_schedule_cancelled', actor_user_id: actor, detail: { phase_id: state.round.phaseId } });
  return { ok: true };
}

/** What the batch went out with: the names and messages are FIXED from here on (editing the settings afterwards changes nothing that was sent). */
const snapshot = (s: ResultSettings): Record<string, unknown> => ({ labels: s.labels, messages: s.messages, eligibilityReasonMode: s.eligibilityReasonMode, feedbackEnabled: s.feedbackEnabled, shareGrade: s.shareGrade, nextStepsText: s.nextStepsText, nextStepsDate: s.nextStepsDate });

async function mapLimit<T, R>(list: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => { while (next < list.length) { const i = next++; out[i] = await fn(list[i]); } }));
  return out;
}

/** The body of a publication. Every step can be repeated: a result that exists is not written again, a move is only made from the phase being published, a notice and an email are one per result. */
async function runBatch(admin: SupabaseClient, call: Call, batchId: string, actor: string, scheduled: boolean, now: Date): Promise<Move<{ published: number }>> {
  const settings = await loadSettings(admin, call.id);
  const state = await loadRoundState(admin, call);
  const batchRow = (await admin.from('call_result_batches').select('*').eq('id', batchId).maybeSingle()).data as Row | null;
  if (!batchRow) return { ok: false, status: 404, error: 'That publication does not exist.' };
  const phaseId = (batchRow.phase_id as string | null) ?? null;
  const frozen = { ...settings, ...(batchRow.settings as Partial<ResultSettings>) } as ResultSettings;
  const phaseIndex = state.phases.findIndex((p) => p.id === phaseId);
  const nextPhaseId = phaseIndex >= 0 && phaseIndex < state.phases.length - 1 ? state.phases[phaseIndex + 1].id : null;
  const facts = await loadFacts(admin, call, state.phases, phaseId);
  const entityName = await promoterName(admin, call.promoterKind, call.promoterId);

  const { data: orgRows } = await admin.from('call_applications').select('id, startup_org_id').eq('call_id', call.id).in('id', facts.map((f) => f.applicationId));
  const orgOf = new Map(((orgRows ?? []) as Row[]).map((r) => [r.id as string, (r.startup_org_id as string | null) ?? null]));
  const { data: existing } = await admin.from('call_results').select('id, application_id, phase_id').eq('call_id', call.id).eq('is_current', true);
  const done = new Map(((existing ?? []) as Row[]).filter((r) => ((r.phase_id as string | null) ?? null) === phaseId).map((r) => [r.application_id as string, r.id as string]));

  const built = (await mapLimit(facts.filter((f) => !done.has(f.applicationId)), 8, async (f) => {
    const message = buildMessage({
      settings: frozen, call, entityName, app: f, applicantName: await applicantNameOf(admin, f.applicantUserId, orgOf.get(f.applicationId) ?? null),
      hasNextPhase: nextPhaseId !== null, formatDay: (iso) => formatDayInZone(`${iso}T12:00:00Z`, call.timezone),
    });
    return message ? { f, message } : null;
  })).filter((x): x is { f: AppFacts; message: BuiltMessage } => x !== null);

  // 1. the results
  const rows = built.map(({ f, message }) => ({
    call_id: call.id, application_id: f.applicationId, phase_id: phaseId, batch_id: batchId, result: message.result, label: message.label, source: outcomeOf(f).source, subject: message.subject, body_html: message.html,
    grade: message.grade, moved_to_phase_id: message.result === 'advance' ? nextPhaseId : null, is_current: true, published_at: now.toISOString(),
  }));
  for (const part of chunks(rows, CHUNK)) {
    const ins = await admin.from('call_results').insert(part);
    if (ins.error) return { ok: false, status: 500, error: 'The results could not be saved. Nothing was sent; try again.' };
  }
  const { data: all } = await admin.from('call_results').select('id, application_id, phase_id, result').eq('call_id', call.id).eq('is_current', true);
  const mine = ((all ?? []) as Row[]).filter((r) => ((r.phase_id as string | null) ?? null) === phaseId);
  const userOf = new Map(facts.map((f) => [f.applicationId, f.applicantUserId]));
  const messageOf1 = new Map(built.map((b) => [b.f.applicationId, b.message]));

  // 2. those who advance move to the next phase, and the decision that took them there is kept as history (a decision for the next phase is a new one)
  if (nextPhaseId) {
    const movers = mine.filter((r) => r.result === 'advance').map((r) => r.application_id as string);
    for (const part of chunks(movers, CHUNK)) {
      await admin.from('call_applications').update({ current_phase_id: nextPhaseId }).in('id', part).eq('call_id', call.id);
      await admin.from('call_eval_decisions').update({ is_current: false }).in('application_id', part).eq('is_current', true);
    }
  }

  // 3. the in-app notice, and 4. the queue of emails: one each per result
  const noticeRows = mine.map((r) => {
    const m = messageOf1.get(r.application_id as string);
    return { user_id: userOf.get(r.application_id as string), call_id: call.id, application_id: r.application_id, kind: 'result_published', title: m?.subject ?? `${call.name}: result`, body: `Your result for “${call.name}” is available${m ? `: ${m.label}` : ''}.`, link_path: '/calls', dedupe_key: `result:${r.id as string}` };
  }).filter((n) => !!n.user_id);
  for (const part of chunks(noticeRows, CHUNK)) await admin.from('call_notices').upsert(part, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
  const sendRows = mine.map((r) => ({ call_id: call.id, result_id: r.id, user_id: userOf.get(r.application_id as string) })).filter((s) => !!s.user_id);
  for (const part of chunks(sendRows, CHUNK)) await admin.from('call_result_sends').upsert(part, { onConflict: 'result_id', ignoreDuplicates: true });

  // 5. done: the batch, the counts and the record of who published what
  const counts: Record<ResultKey, number> = { advance: 0, reject: 0, waitlist: 0 };
  for (const r of mine) counts[r.result as ResultKey]++;
  await admin.from('call_result_batches').update({ status: 'published', published_at: now.toISOString(), published_by: actor, total: mine.length, counts }).eq('id', batchId);
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'results_published', actor_user_id: actor, detail: { phase_id: phaseId, total: mine.length, counts, scheduled, moved_to: nextPhaseId } });

  // 6. the first emails leave now; the rest wait in the queue (the administrator sees them, and the daily job takes them)
  // ("now" is when the publication STARTED; the queue rows were created a moment after it, so they are due from the actual present — or from the later time a schedule was run at.)
  await processSends(admin, { callId: call.id, now: new Date(Math.max(now.getTime(), Date.now())), budgetMs: 40_000 }).catch((e) => console.error(JSON.stringify({ event: 'results_send_failed', callId: call.id, reason: (e as Error).message })));
  return { ok: true, published: mine.length };
}

// --- The queue of emails ------------------------------------------------------------------------------------------------------------------------------

export interface SendRun { tried: number; sent: number; bounced: number; failed: number; retrying: number; waiting: number }

/** Sends what is due. Stops when the time budget is spent (what is left stays queued). Never throws for one bad email. */
export async function processSends(admin: SupabaseClient, opts: { callId?: string; sendId?: string; now?: Date; limit?: number; budgetMs?: number } = {}): Promise<SendRun> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budget = opts.budgetMs ?? 40_000;
  let q = admin.from('call_result_sends').select('id, call_id, result_id, user_id, attempts, next_attempt_at').eq('status', 'queued');
  if (opts.callId) q = q.eq('call_id', opts.callId);
  if (opts.sendId) q = q.eq('id', opts.sendId);
  const { data } = await q;
  const due = ((data ?? []) as Row[]).filter((s) => Date.parse(String(s.next_attempt_at)) <= now.getTime()).slice(0, opts.limit ?? 400);
  const out: SendRun = { tried: 0, sent: 0, bounced: 0, failed: 0, retrying: 0, waiting: 0 };
  const calls = new Map<string, Call | null>();
  const callOf = async (id: string) => { if (!calls.has(id)) calls.set(id, await loadCall(admin, id, { includeDeleted: true })); return calls.get(id) ?? null; };

  await mapLimit(due, 4, async (s) => {
    if (Date.now() - started > budget) { out.waiting++; return; }
    const attempts = Number(s.attempts ?? 0) + 1;
    const { data: res } = await admin.from('call_results').select('subject, label, body_html').eq('id', s.result_id as string).maybeSingle();
    const call = await callOf(s.call_id as string);
    const to = await emailOf(admin, s.user_id as string).catch(() => null);
    out.tried++;
    let patch: Row;
    if (!res || !call) patch = { status: 'failed', attempts, last_error: 'The result or the call no longer exists.' };
    else if (!to) patch = { status: 'failed', attempts, last_error: 'The applicant has no email address.' };
    else {
      const r = await sendResultEmail(admin, call, to, { subject: String((res as Row).subject), label: String((res as Row).label), html: String((res as Row).body_html), text: plain(String((res as Row).body_html)) });
      if (r.sent) patch = { status: 'sent', attempts, last_error: null, sent_at: new Date().toISOString() };
      else if (classifyEmailFailure(r.error) === 'permanent') patch = { status: 'bounced', attempts, last_error: r.error };
      else if (attempts >= MAX_SEND_ATTEMPTS) patch = { status: 'failed', attempts, last_error: r.error };
      else patch = { status: 'queued', attempts, last_error: r.error, next_attempt_at: new Date(now.getTime() + backoffMs(attempts)).toISOString() };
    }
    await admin.from('call_result_sends').update(patch).eq('id', s.id as string);
    if (patch.status === 'sent') out.sent++; else if (patch.status === 'bounced') out.bounced++; else if (patch.status === 'failed') out.failed++; else out.retrying++;
  });
  return out;
}

const plain = (html: string): string => html.replace(/<br>/g, '\n').replace(/<\/(p|h2|h3|li)>/g, '\n').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();

/** "Send again" to one applicant: back in the queue with the attempts reset, and tried at once. */
export async function resendOne(admin: SupabaseClient, call: Call, sendId: string, actor: string, now: Date = new Date()): Promise<Move<{ status: SendStatus }>> {
  const { data } = await admin.from('call_result_sends').select('id, status').eq('id', sendId).eq('call_id', call.id).maybeSingle();
  if (!data) return { ok: false, status: 404, error: 'That email does not exist.' };
  await admin.from('call_result_sends').update({ status: 'queued', attempts: 0, last_error: null, next_attempt_at: now.toISOString(), sent_at: null }).eq('id', sendId);
  await processSends(admin, { sendId, now, budgetMs: 15_000 });
  const { data: after } = await admin.from('call_result_sends').select('status').eq('id', sendId).maybeSingle();
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'result_email_resent', actor_user_id: actor, detail: { send_id: sendId } });
  return { ok: true, status: ((after as Row | null)?.status as SendStatus) ?? 'queued' };
}

// --- The test email -----------------------------------------------------------------------------------------------------------------------------------

/** One email of each result, with example data, to the person who asked. Limited per hour so it cannot be used to write to anybody else's inbox in bulk. */
export async function sendTestEmails(admin: SupabaseClient, call: Call, actor: string, now: Date = new Date()): Promise<Move<{ sent: number; to: string }>> {
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const { data: recent } = await admin.from('call_events').select('id, created_at').eq('call_id', call.id).eq('event', 'results_test_sent').eq('actor_user_id', actor);
  if (((recent ?? []) as Row[]).filter((e) => String(e.created_at) >= since).length >= TEST_EMAILS_PER_HOUR) return { ok: false, status: 429, error: 'You have sent several tests in the last hour. Wait a little before sending more.' };
  const to = await emailOf(admin, actor).catch(() => null);
  if (!to) return { ok: false, status: 409, error: 'Your account has no email address to send the test to.' };
  const settings = await loadSettings(admin, call.id);
  const state = await loadRoundState(admin, call);
  const entityName = await promoterName(admin, call.promoterKind, call.promoterId);
  let sent = 0;
  for (const key of RESULT_KEYS) {
    const app: AppFacts = {
      applicationId: 'example', reference: 'EXAMPLE-001', startupName: 'Acme Robotics', applicantUserId: 'example', eligibility: 'fit', failedRules: [],
      decision: key, feedback: settings.feedbackEnabled ? 'This is an example of the feedback you write for an applicant.' : null, grade: settings.shareGrade ? 82 : null,
    };
    const message = buildMessage({ settings, call, entityName, app, applicantName: 'Alex Example', hasNextPhase: state.round.hasNextPhase, formatDay: (iso) => formatDayInZone(`${iso}T12:00:00Z`, call.timezone) });
    if (!message) continue;
    const r = await sendResultEmail(admin, call, to, { subject: `[Test] ${message.subject}`, label: message.label, html: message.html, text: message.text });
    if (r.sent) sent++;
  }
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'results_test_sent', actor_user_id: actor, detail: { sent } });
  if (sent === 0) return { ok: false, status: 502, error: 'The test emails could not be sent. Try again in a minute.' };
  return { ok: true, sent, to: maskEmail(to) };
}

const maskEmail = (e: string): string => { const [l, d] = e.split('@'); return d ? `${l.slice(0, 1)}•••@${d}` : '•••'; };

// --- What was scheduled ------------------------------------------------------------------------------------------------------------------------------

/** Publications whose time has come. Each is claimed (scheduled → publishing) by ONE caller, so two people opening the app at once do not publish twice. */
export async function runDueBatches(admin: SupabaseClient, now: Date = new Date()): Promise<{ due: number; published: number }> {
  const { data } = await admin.from('call_result_batches').select('id, call_id, phase_id, scheduled_by, scheduled_at').eq('status', 'scheduled');
  const due = ((data ?? []) as Row[]).filter((b) => b.scheduled_at && Date.parse(String(b.scheduled_at)) <= now.getTime());
  let published = 0;
  for (const b of due) {
    const claim = await admin.from('call_result_batches').update({ status: 'publishing' }).eq('id', b.id as string).eq('status', 'scheduled').select('id');
    if (claim.error || ((claim.data ?? []) as Row[]).length === 0) continue;
    const call = await loadCall(admin, b.call_id as string);
    if (!call) { await admin.from('call_result_batches').update({ status: 'cancelled' }).eq('id', b.id as string); continue; }
    // The schedule is only honoured if everything still holds (it cannot have changed: decisions and settings are fixed while scheduled — but a call may have been archived, or an application withdrawn).
    const state = await loadRoundState(admin, call);
    const settings = await loadSettings(admin, call.id);
    const facts = await loadFacts(admin, call, state.phases, (b.phase_id as string | null) ?? state.round.phaseId);
    const blockers = blockersOf({ summary: summarise(facts), callStatus: call.status, alreadyPublished: false, shareGrade: settings.shareGrade });
    if (blockers.length > 0 || call.status === 'archived') {
      await admin.from('call_result_batches').update({ status: 'cancelled' }).eq('id', b.id as string);
      await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'results_schedule_failed', actor_user_id: (b.scheduled_by as string | null) ?? null, detail: { reason: blockers[0]?.text ?? 'The call was archived.' } });
      continue;
    }
    const r = await runBatch(admin, call, b.id as string, (b.scheduled_by as string | null) ?? '', true, now);
    if (r.ok) published++;
  }
  return { due: due.length, published };
}

