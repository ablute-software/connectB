// Prompt 924 (Etapa 4, I3) — contestations, completing a call and the end of the retention, against the database. Who may do what is decided by the routes ("Handle contestations", "Publish results", "Final decision"
// and, for the applicant, their own startup); the rules are in contestations.ts. Every change is recorded in the call's events.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDayInZone } from './tz';
import { loadCall, loadPhases, promoterName } from './store';
import { loadCriteria } from './eval-grid-store';
import { loadBoard } from './eval-board-store';
import { loadCallTeam, loadCategories, callOrg } from './team-store';
import { effectivePermissions } from './permissions';
import { applicantNameOf, liveBatches, loadRoundState, loadSettings, type Move } from './results-store';
import { processSends } from './results-publish';
import { sendResultEmail } from './results-email';
import { createNotice, emailOf } from './applicant/notices';
import { formatOfBytes, isZipName } from './applicant/file-format';
import { scanWithVirusTotal, sha256Hex } from '@/lib/upload-security';
import { sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { MEDIA_BUCKET } from './branding';
import { buildMessage, labelOf, RESULT_KEYS, type ResultKey } from './results';
import {
  MAX_CONTEST_FILE_MB, POSTPONE_MONTHS, addMonths, buildSummary, cleanPostponeReason, cleanReason, completeBlockers, contestInfo, parseAnswer, rejectedMessage, responseBlock, retentionState, upheldIntro,
  type Answer, type CloseView, type ContestInfo, type ContestationRow, type ContestationsView,
} from './contestations';
import type { Call } from './types';

type Row = Record<string, unknown>;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const event = (admin: SupabaseClient, callId: string, name: string, actor: string | null, applicationId: string | null, detail: Record<string, unknown>) =>
  admin.from('call_events').insert({ call_id: callId, application_id: applicationId, event: name, actor_user_id: actor, detail });

// --- The applicant's side ------------------------------------------------------------------------------------------------------------------------------

const existingOf = (r: Row | null): ContestInfo['contestation'] => (r ? {
  status: r.status as 'open' | 'upheld' | 'rejected', reason: String(r.reason ?? ''), response: (r.response as string | null) ?? null, answeredAt: (r.answered_at as string | null) ?? null,
  hasFile: !!r.storage_path, fileName: (r.file_name as string | null) ?? null,
} : null);

/** What the applicant is offered for the result they have now: the button, the deadline, or their own contestation and its answer. */
export async function contestInfoFor(admin: SupabaseClient, call: Call, applicationId: string, result: { id: string; kind: ResultKey; publishedAt: string; phaseId: string | null }, now: Date = new Date()): Promise<ContestInfo> {
  const settings = await loadSettings(admin, call.id);
  const { data } = await admin.from('call_contestations').select('*').eq('application_id', applicationId);
  const mine = ((data ?? []) as Row[]).find((c) => ((c.phase_id as string | null) ?? null) === result.phaseId) ?? null;
  return contestInfo({ enabled: settings.contestationsEnabled, days: settings.contestationDays, resultKind: result.kind, publishedAt: result.publishedAt, callStatus: call.status, now, existing: existingOf(mine) });
}

const REFUSALS: Record<string, string> = {
  not_offered: 'This call does not accept contestations for this result.',
  closed: 'This call is completed: contestations are closed.',
};

export async function createContestation(
  admin: SupabaseClient, call: Call, a: { applicationId: string; orgId: string; userId: string }, input: { reason?: unknown; storagePath?: unknown; fileName?: unknown }, now: Date = new Date(),
): Promise<Move<{ contestation: NonNullable<ContestInfo['contestation']> }>> {
  const { data: rows } = await admin.from('call_results').select('id, result, published_at, phase_id').eq('application_id', a.applicationId).eq('is_current', true);
  const result = ((rows ?? []) as Row[]).sort((x, y) => String(y.published_at).localeCompare(String(x.published_at)))[0];
  if (!result) return { ok: false, status: 409, error: 'There is no published result to contest.' };
  const phaseId = (result.phase_id as string | null) ?? null;
  const info = await contestInfoFor(admin, call, a.applicationId, { id: result.id as string, kind: result.result as ResultKey, publishedAt: String(result.published_at), phaseId }, now);
  if (info.state === 'done') return { ok: false, status: 409, error: 'You already contested this decision: each application can contest once.' };
  if (info.state === 'expired') return { ok: false, status: 409, error: `The period to contest ended on ${formatDayInZone(info.deadline, call.timezone)}.` };
  if (info.state !== 'available') return { ok: false, status: 409, error: REFUSALS[info.state] ?? 'You cannot contest this result.' };
  const reason = cleanReason(input.reason);
  if (!reason.ok) return { ok: false, status: 400, error: reason.error };

  // At most one file. It is read back and checked on its BYTES (a PDF, within the limit, not flagged by the scan), and it must be in the startup's own folder: never a path the browser merely names.
  let file: { name: string; path: string; size: number } | null = null;
  if (typeof input.storagePath === 'string' && input.storagePath) {
    const path = input.storagePath; const name = typeof input.fileName === 'string' ? input.fileName.trim().slice(0, 200) : '';
    if (!name || !path.startsWith(`${a.orgId}/`) || path.includes('..')) return { ok: false, status: 403, error: 'That upload does not belong to your startup.' };
    const reject = async (error: string): Promise<Move<never>> => { await admin.storage.from(MEDIA_BUCKET).remove([path]); return { ok: false, status: 400, error }; };
    const { data: blob, error } = await admin.storage.from(MEDIA_BUCKET).download(path);
    if (error || !blob) return { ok: false, status: 400, error: 'We could not read the uploaded file. Please try again.' };
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (isZipName(name)) return reject('ZIP files are not accepted. Attach a PDF.');
    if (formatOfBytes(bytes, name) !== 'pdf') return reject('Only a PDF file can be attached.');
    if (bytes.length > MAX_CONTEST_FILE_MB * 1024 * 1024) return reject(`The file is too large (maximum ${MAX_CONTEST_FILE_MB} MB).`);
    const verdict = await scanWithVirusTotal(bytes);
    if (verdict.status === 'flagged') return reject(`Upload blocked: ${verdict.detail}`);
    void sha256Hex;
    file = { name, path, size: bytes.length };
  }

  const ins = await admin.from('call_contestations').insert({
    call_id: call.id, application_id: a.applicationId, phase_id: phaseId, result_id: result.id, user_id: a.userId, reason: reason.text,
    file_name: file?.name ?? null, storage_path: file?.path ?? null, file_size: file?.size ?? null, status: 'open',
  }).select('*').single();
  if (ins.error || !ins.data) {
    if (file) await admin.storage.from(MEDIA_BUCKET).remove([file.path]);
    return ins.error?.code === '23505' ? { ok: false, status: 409, error: 'You already contested this decision: each application can contest once.' } : { ok: false, status: 500, error: 'We could not save your contestation. Please try again.' };
  }
  await event(admin, call.id, 'contestation_received', a.userId, a.applicationId, { phase_id: phaseId, file: !!file });
  await notifyHandlers(admin, call, a.applicationId).catch((e) => console.error(JSON.stringify({ event: 'contestation_notify_failed', callId: call.id, reason: (e as Error).message })));
  return { ok: true, contestation: existingOf(ins.data as Row)! };
}

/** Whoever has "Handle contestations" on this call is told by email that one arrived (the organisation never sees the applicant's address). */
async function notifyHandlers(admin: SupabaseClient, call: Call, applicationId: string): Promise<void> {
  const [categories, members] = await Promise.all([loadCategories(admin, callOrg(call)), loadCallTeam(admin, call.id)]);
  const handlers = members.filter((m) => { const c = categories.find((x) => x.id === m.categoryId); return !!c && effectivePermissions(c.permissions, m.overrides).handle_contestations; });
  const { data: app } = await admin.from('call_applications').select('reference').eq('id', applicationId).maybeSingle();
  const ref = ((app as Row | null)?.reference as string | null) ?? 'an application';
  for (const h of handlers) {
    const to = await emailOf(admin, h.userId).catch(() => null);
    if (!to) continue;
    await sendTransactionalEmail({
      to, subject: `New contestation — ${call.name}`,
      html: transactionalTemplate({ heading: esc(`New contestation — ${call.name}`), body: esc(`An applicant contested the decision on ${ref}. Open Results → Contestations to read it and answer.`), ctaLabel: 'Open the call', ctaUrl: `https://www.sherlockdeal.com/calls` }),
      text: `An applicant contested the decision on ${ref}. Open Results → Contestations to read it and answer.`, context: { kind: 'other' },
    }).catch(() => null);
  }
}

// --- The queue of whoever handles contestations -----------------------------------------------------------------------------------------------------

export async function listContestations(admin: SupabaseClient, call: Call): Promise<ContestationsView> {
  const settings = await loadSettings(admin, call.id);
  const state = await loadRoundState(admin, call);
  const hasNext = state.round.hasNextPhase;
  const labels = Object.fromEntries(RESULT_KEYS.map((k) => [k, labelOf(k, settings, hasNext)])) as Record<ResultKey, string>;
  const { data } = await admin.from('call_contestations').select('*').eq('call_id', call.id);
  const list = ((data ?? []) as Row[]).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const appIds = list.map((c) => c.application_id as string);
  const apps = new Map<string, { reference: string | null; org: string | null }>();
  if (appIds.length) { const { data: a } = await admin.from('call_applications').select('id, reference, startup_org_id').in('id', appIds); for (const r of (a ?? []) as Row[]) apps.set(r.id as string, { reference: (r.reference as string | null) ?? null, org: (r.startup_org_id as string | null) ?? null }); }
  const names = new Map<string, string>();
  const orgIds = [...new Set([...apps.values()].map((a) => a.org).filter((x): x is string => !!x))];
  if (orgIds.length) { const { data: o } = await admin.from('orgs').select('id, name').in('id', orgIds); for (const r of (o ?? []) as Row[]) names.set(r.id as string, String(r.name ?? '')); }
  const resIds = [...new Set(list.flatMap((c) => [c.result_id, c.new_result_id]).filter((x): x is string => typeof x === 'string'))];
  const results = new Map<string, Row>();
  if (resIds.length) { const { data: r } = await admin.from('call_results').select('id, label, result, published_at').in('id', resIds); for (const x of (r ?? []) as Row[]) results.set(x.id as string, x); }
  // What the evaluations say, as numbers (the average and the average of each criterion), and the decision — for whoever decides about the contestation. Never a comment or a private note.
  let board: Awaited<ReturnType<typeof loadBoard>> | null = null;
  try { board = await loadBoard(admin, call); } catch { board = null; }
  const rows: ContestationRow[] = list.map((c) => {
    const app = apps.get(c.application_id as string); const res = results.get(c.result_id as string); const next = c.new_result_id ? results.get(c.new_result_id as string) : null;
    const b = board?.rows.find((r) => r.applicationId === c.application_id);
    return {
      id: c.id as string, applicationId: c.application_id as string, reference: app?.reference ?? null, startupName: app?.org ? names.get(app.org) ?? null : null, status: c.status as ContestationRow['status'],
      reason: String(c.reason ?? ''), fileName: (c.file_name as string | null) ?? null, hasFile: !!c.storage_path, createdAt: String(c.created_at), answeredAt: (c.answered_at as string | null) ?? null, response: (c.response as string | null) ?? null,
      result: { label: String(res?.label ?? ''), kind: (res?.result as ResultKey) ?? 'reject', publishedAt: String(res?.published_at ?? c.created_at) },
      evaluation: b ? { gradePercent: b.average, evaluators: b.submitted, criteria: b.perCriterion.map((p) => ({ name: p.name, average: p.average })), decision: b.decision?.decision ?? null, decisionNote: b.decision?.note ?? null } : null,
      newLabel: next ? String(next.label) : null,
    };
  });
  return { ok: true, enabled: settings.contestationsEnabled, days: settings.contestationDays, open: rows.filter((r) => r.status === 'open').length, rows, labels };
}

/** The file of a contestation, for the person who handles it: read by the server and streamed — there is no Storage link in the browser. */
export async function contestationFile(admin: SupabaseClient, call: Call, id: string): Promise<{ bytes: Buffer; name: string } | null> {
  const { data } = await admin.from('call_contestations').select('storage_path, file_name').eq('id', id).eq('call_id', call.id).maybeSingle();
  const r = data as Row | null;
  if (!r?.storage_path) return null;
  const { data: blob } = await admin.storage.from(MEDIA_BUCKET).download(r.storage_path as string);
  return blob ? { bytes: Buffer.from(await blob.arrayBuffer()), name: String(r.file_name ?? 'contestation.pdf') } : null;
}

/**
 * Answers a contestation. UPHELD: the decision changes to Advance or Waitlist and the applicant gets a NEW publication — the old result is kept (is_current false, the new one points to it), never overwritten;
 * one that advances moves to the next phase when there is one. REJECTED: a written response is required and is sent. Both are told by email and in the app, and recorded. Only called for somebody with "Handle contestations".
 */
export async function answerContestation(admin: SupabaseClient, call: Call, id: string, raw: unknown, actor: string, now: Date = new Date()): Promise<Move<{ status: 'upheld' | 'rejected' }>> {
  const parsed = parseAnswer(raw);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const answer: Answer = parsed.answer;
  const { data } = await admin.from('call_contestations').select('*').eq('id', id).eq('call_id', call.id).maybeSingle();
  const c = data as Row | null;
  if (!c) return { ok: false, status: 404, error: 'That contestation does not exist.' };
  if (c.status !== 'open') return { ok: false, status: 409, error: 'This contestation was already answered.' };
  const applicationId = c.application_id as string;
  const { data: appRow } = await admin.from('call_applications').select('applicant_user_id, startup_org_id, reference').eq('id', applicationId).maybeSingle();
  const app = appRow as Row | null;
  if (!app) return { ok: false, status: 404, error: 'The application no longer exists.' };
  const userId = app.applicant_user_id as string;
  const settings = await loadSettings(admin, call.id);
  const entityName = await promoterName(admin, call.promoterKind, call.promoterId);
  const name = await applicantNameOf(admin, userId, (app.startup_org_id as string | null) ?? null);
  const answeredAt = now.toISOString();

  if (answer.outcome === 'rejected') {
    const upd = await admin.from('call_contestations').update({ status: 'rejected', response: answer.response, answered_by: actor, answered_at: answeredAt }).eq('id', id).eq('status', 'open').select('id');
    if (upd.error || ((upd.data ?? []) as Row[]).length === 0) return { ok: false, status: 409, error: 'This contestation was already answered.' };
    const mail = rejectedMessage(call.contentLanguage, call.name, answer.response);
    const html = `<p>${esc(name)},</p>${mail.html}`;
    await tellApplicant(admin, call, id, userId, applicationId, { subject: mail.subject, label: mail.label, html, text: mail.text }, 'Your contestation was answered.');
    await event(admin, call.id, 'contestation_rejected', actor, applicationId, { contestation_id: id });
    return { ok: true, status: 'rejected' };
  }

  // Upheld
  const { data: oldRow } = await admin.from('call_results').select('*').eq('id', c.result_id as string).maybeSingle();
  const old = oldRow as Row | null;
  if (!old || old.is_current !== true) return { ok: false, status: 409, error: 'The result being contested is no longer the current one.' };
  const phases = await loadPhases(admin, call.id);
  const phaseId = (old.phase_id as string | null) ?? null;
  const idx = phases.findIndex((p) => p.id === phaseId);
  const nextPhaseId = idx >= 0 && idx < phases.length - 1 ? phases[idx + 1].id : null;
  const hasNext = nextPhaseId !== null;
  const grade = old.grade === null || old.grade === undefined ? null : Number(old.grade);
  const built = buildMessage({
    settings, call, entityName, app: { applicationId, reference: (app.reference as string | null) ?? null, startupName: await startupNameOf(admin, (app.startup_org_id as string | null) ?? null), applicantUserId: userId, decision: answer.newResult, eligibility: 'fit', failedRules: [], feedback: null, grade },
    applicantName: name, hasNextPhase: hasNext, formatDay: (iso) => formatDayInZone(`${iso}T12:00:00Z`, call.timezone),
  });
  if (!built) return { ok: false, status: 500, error: 'The new message could not be built.' };
  const html = upheldIntro(call.contentLanguage, call.name) + built.html + responseBlock(call.contentLanguage, answer.response);

  // The old result stops being the current one (it is KEPT), and the new one is a new publication that points to it.
  await admin.from('call_results').update({ is_current: false }).eq('id', old.id as string);
  const ins = await admin.from('call_results').insert({
    call_id: call.id, application_id: applicationId, phase_id: phaseId, batch_id: (old.batch_id as string | null) ?? null, result: answer.newResult, label: built.label, source: 'contestation', subject: built.subject, body_html: html,
    grade, moved_to_phase_id: answer.newResult === 'advance' ? nextPhaseId : null, is_current: true, supersedes_id: old.id as string, published_at: answeredAt,
  }).select('id').single();
  if (ins.error || !ins.data) {
    await admin.from('call_results').update({ is_current: true }).eq('id', old.id as string);
    return { ok: false, status: 500, error: 'The new result could not be saved. Nothing changed; try again.' };
  }
  const newId = (ins.data as Row).id as string;
  // The decision: the earlier one stays as history, the new one is recorded; one that advances moves on to the next phase (where a decision of its own is needed).
  await admin.from('call_eval_decisions').update({ is_current: false }).eq('application_id', applicationId).eq('is_current', true);
  const moves = answer.newResult === 'advance' && hasNext;
  await admin.from('call_eval_decisions').insert({ call_id: call.id, application_id: applicationId, decision: answer.newResult, note: 'Contestation upheld', decided_by: actor, is_current: !moves });
  if (moves) await admin.from('call_applications').update({ current_phase_id: nextPhaseId }).eq('id', applicationId).eq('call_id', call.id);
  await admin.from('call_contestations').update({ status: 'upheld', response: answer.response || null, answered_by: actor, answered_at: answeredAt, new_result_id: newId }).eq('id', id);
  await admin.from('call_result_sends').upsert({ call_id: call.id, result_id: newId, user_id: userId }, { onConflict: 'result_id', ignoreDuplicates: true });
  await createNotice(admin, { userId, callId: call.id, applicationId, kind: 'contestation_answered', dedupeKey: `contest:${id}`, content: { title: built.subject, body: `Your contestation of “${call.name}” was accepted: ${built.label}.`, ctaLabel: 'View your result' }, linkPath: '/calls' });
  await event(admin, call.id, 'contestation_upheld', actor, applicationId, { contestation_id: id, from: 'reject', to: answer.newResult, old_result_id: old.id, new_result_id: newId });
  await processSends(admin, { callId: call.id, now: new Date(Math.max(now.getTime(), Date.now())), budgetMs: 15_000 }).catch(() => null);
  return { ok: true, status: 'upheld' };
}

const startupNameOf = async (admin: SupabaseClient, orgId: string | null): Promise<string | null> => {
  if (!orgId) return null;
  const { data } = await admin.from('orgs').select('name').eq('id', orgId).maybeSingle();
  return ((data as Row | null)?.name as string | undefined) ?? null;
};

/** A written answer that is not a new result: the in-app notice, and the email — whose outcome is recorded on the contestation (a failure never hides the answer in the app). */
async function tellApplicant(admin: SupabaseClient, call: Call, contestationId: string, userId: string, applicationId: string, mail: { subject: string; label: string; html: string; text: string }, notice: string): Promise<void> {
  await createNotice(admin, { userId, callId: call.id, applicationId, kind: 'contestation_answered', dedupeKey: `contest:${contestationId}`, content: { title: mail.subject, body: notice, ctaLabel: 'View your result' }, linkPath: '/calls' });
  const to = await emailOf(admin, userId).catch(() => null);
  if (!to) { await admin.from('call_contestations').update({ email_error: 'The applicant has no email address.' }).eq('id', contestationId); return; }
  const r = await sendResultEmail(admin, call, to, mail);
  await admin.from('call_contestations').update(r.sent ? { email_sent_at: new Date().toISOString(), email_error: null } : { email_error: r.error }).eq('id', contestationId);
}

// --- Completing the call, and the retention ----------------------------------------------------------------------------------------------------------

export async function loadClose(admin: SupabaseClient, call: Call, now: Date = new Date()): Promise<CloseView> {
  const settings = await loadSettings(admin, call.id);
  const state = await loadRoundState(admin, call);
  const batches = (await liveBatches(admin, call.id)).filter((b) => b.status === 'published');
  const lastPublishedAt = batches.map((b) => b.publishedAt ?? '').sort().pop() || null;
  const { data: cs } = await admin.from('call_contestations').select('status').eq('call_id', call.id);
  const contestations = (cs ?? []) as Row[];
  const open = contestations.filter((c) => c.status === 'open').length;
  const { data: res } = await admin.from('call_results').select('result').eq('call_id', call.id).eq('is_current', true);
  const counts: Record<ResultKey, number> = { advance: 0, reject: 0, waitlist: 0 };
  for (const r of (res ?? []) as Row[]) counts[r.result as ResultKey]++;
  const blockers = completeBlockers({ callStatus: call.status, allPublished: state.round.allPublished && batches.length > 0, contestationsEnabled: settings.contestationsEnabled, days: settings.contestationDays, lastPublishedAt, openContestations: open, now });
  return {
    ok: true, status: call.status, blockers, canComplete: blockers.length === 0, completedAt: call.completedAt ?? null,
    summary: { total: Object.values(counts).reduce((a, b) => a + b, 0), counts }, contestations: { enabled: settings.contestationsEnabled, open, total: contestations.length },
    retention: { ...retentionState({ purgeAfter: call.dataPurgeAfter ?? null, extendedAt: call.dataPurgeExtendedAt ?? null, purgedAt: call.dataPurgedAt ?? null, now }), months: settings.retentionMonths, reason: call.dataPurgeExtendedReason ?? null },
    timezone: call.timezone, callName: call.name,
  };
}

export async function completeCall(admin: SupabaseClient, call: Call, actor: string, confirmName: unknown, now: Date = new Date()): Promise<Move> {
  const view = await loadClose(admin, call, now);
  if (!view.canComplete) return { ok: false, status: 409, error: view.blockers[0]?.text ?? 'The call cannot be completed yet.' };
  const typed = typeof confirmName === 'string' ? confirmName.trim().replace(/\s+/g, ' ').toLowerCase() : '';
  if (!typed || typed !== call.name.trim().replace(/\s+/g, ' ').toLowerCase()) return { ok: false, status: 400, error: 'Type the name of the call to confirm.' };
  const settings = await loadSettings(admin, call.id);
  const purgeAfter = addMonths(now.toISOString(), settings.retentionMonths);
  const upd = await admin.from('calls').update({ status: 'completed', completed_at: now.toISOString(), completed_by: actor, data_purge_after: purgeAfter, data_purge_warned_at: null, updated_at: now.toISOString() }).eq('id', call.id).neq('status', 'completed').select('id');
  if (upd.error || ((upd.data ?? []) as Row[]).length === 0) return { ok: false, status: 409, error: 'The call changed in the meantime. Reload and try again.' };
  await event(admin, call.id, 'call_completed', actor, null, { purge_after: purgeAfter, months: settings.retentionMonths });
  return { ok: true };
}

/** Postpone the deletion of the applicants' data: once, with a reason, before it is due. */
export async function postponeRetention(admin: SupabaseClient, call: Call, rawReason: unknown, actor: string, now: Date = new Date()): Promise<Move<{ purgeAfter: string }>> {
  const reason = cleanPostponeReason(rawReason);
  if (!reason.ok) return { ok: false, status: 400, error: reason.error };
  if (call.status !== 'completed' || !call.dataPurgeAfter) return { ok: false, status: 409, error: 'Only a completed call has data waiting to be deleted.' };
  const st = retentionState({ purgeAfter: call.dataPurgeAfter, extendedAt: call.dataPurgeExtendedAt ?? null, purgedAt: call.dataPurgedAt ?? null, now });
  if (st.phase === 'purged') return { ok: false, status: 409, error: 'The data was already deleted.' };
  if (st.extendedAt) return { ok: false, status: 409, error: 'The deletion was already postponed once; it cannot be postponed again.' };
  if (!st.canPostpone) return { ok: false, status: 409, error: 'The deletion is due: it can no longer be postponed.' };
  const purgeAfter = addMonths(call.dataPurgeAfter, POSTPONE_MONTHS);
  await admin.from('calls').update({ data_purge_after: purgeAfter, data_purge_extended_at: now.toISOString(), data_purge_extended_reason: reason.text, data_purge_warned_at: null, updated_at: now.toISOString() }).eq('id', call.id);
  await event(admin, call.id, 'retention_postponed', actor, null, { from: call.dataPurgeAfter, to: purgeAfter, reason: reason.text });
  return { ok: true, purgeAfter };
}

/** The administrators are warned 30 days before the data goes (once per date), so they can export it or postpone. */
export async function warnRetentions(admin: SupabaseClient, now: Date = new Date()): Promise<{ warned: number }> {
  const { data } = await admin.from('calls').select('id').eq('status', 'completed');
  let warned = 0;
  for (const r of (data ?? []) as Row[]) {
    const call = await loadCall(admin, r.id as string);
    if (!call || call.dataPurgedAt || !call.dataPurgeAfter) continue;
    const row = (await admin.from('calls').select('data_purge_warned_at').eq('id', call.id).maybeSingle()).data as Row | null;
    const st = retentionState({ purgeAfter: call.dataPurgeAfter, extendedAt: call.dataPurgeExtendedAt ?? null, purgedAt: null, now });
    if (st.phase !== 'warn' || row?.data_purge_warned_at) continue;
    const [categories, members] = await Promise.all([loadCategories(admin, callOrg(call)), loadCallTeam(admin, call.id)]);
    const publishers = members.filter((m) => { const c = categories.find((x) => x.id === m.categoryId); return !!c && effectivePermissions(c.permissions, m.overrides).publish_results; });
    for (const p of publishers) {
      const to = await emailOf(admin, p.userId).catch(() => null);
      if (!to) continue;
      const day = formatDayInZone(call.dataPurgeAfter, call.timezone);
      await sendTransactionalEmail({
        to, subject: `The applicants’ data of “${call.name}” will be deleted on ${day}`,
        html: transactionalTemplate({ heading: esc(`Applicants’ data will be deleted on ${day}`), body: esc(`The documents and answers of the applicants of “${call.name}” will be deleted on ${day}; only a summary without personal data stays. Export what you need, or postpone the deletion once, in Results → Close.`), ctaLabel: 'Open the call', ctaUrl: 'https://www.sherlockdeal.com/calls' }),
        text: `The applicants' data of "${call.name}" will be deleted on ${day}. Export what you need, or postpone the deletion once, in Results → Close.`, context: { kind: 'other' },
      }).catch(() => null);
    }
    await admin.from('calls').update({ data_purge_warned_at: now.toISOString() }).eq('id', call.id);
    await event(admin, call.id, 'retention_warned', null, null, { purge_after: call.dataPurgeAfter, to: publishers.length });
    warned++;
  }
  return { warned };
}

export interface RetentionPurge { due: number; purged: number; failed: number; filesRemoved: number }

/**
 * The end of the retention: for each completed call whose date has passed — first the files leave Storage (what applicants uploaded, the frozen copies, the contestation files), and only if that worked the data
 * goes (purge_completed_call_data: one transaction) and a summary without personal data stays. If Storage fails nothing is removed from the database and it is tried again tomorrow.
 */
export async function purgeExpiredCallData(admin: SupabaseClient, now: Date = new Date()): Promise<RetentionPurge> {
  const { data } = await admin.from('calls').select('id, status, data_purge_after, data_purged_at').eq('status', 'completed');
  const due = ((data ?? []) as Row[]).filter((c) => c.data_purge_after && !c.data_purged_at && Date.parse(String(c.data_purge_after)) <= now.getTime());
  const out: RetentionPurge = { due: due.length, purged: 0, failed: 0, filesRemoved: 0 };
  for (const d of due) {
    const call = await loadCall(admin, d.id as string);
    if (!call) continue;
    try {
      const [{ data: files }, { data: contests }, { data: res }, phases, criteria] = await Promise.all([
        admin.from('call_application_files').select('source, storage_path, frozen_path').eq('call_id', call.id),
        admin.from('call_contestations').select('status, storage_path').eq('call_id', call.id),
        admin.from('call_results').select('result').eq('call_id', call.id).eq('is_current', true),
        loadPhases(admin, call.id), loadCriteria(admin, call.id, call.evalGridVersion ?? 1),
      ]);
      const paths = new Set<string>();
      for (const f of (files ?? []) as Row[]) { if (f.source === 'upload' && typeof f.storage_path === 'string') paths.add(f.storage_path); if (typeof f.frozen_path === 'string') paths.add(f.frozen_path); }
      for (const c of (contests ?? []) as Row[]) if (typeof c.storage_path === 'string') paths.add(c.storage_path);
      const list = [...paths];
      let ok = true;
      for (let i = 0; i < list.length; i += 100) {
        const { error } = await admin.storage.from(MEDIA_BUCKET).remove(list.slice(i, i + 100));
        if (error) { ok = false; console.error(JSON.stringify({ event: 'retention_purge_storage_failed', callId: call.id, reason: error.message })); break; }
      }
      if (!ok) { out.failed++; continue; }
      const summary = buildSummary({
        callName: call.name, completedAt: call.completedAt ?? null, results: ((res ?? []) as Row[]).map((r) => ({ result: r.result as ResultKey })), contestations: ((contests ?? []) as Row[]).map((c) => ({ status: String(c.status) })),
        phases: phases.length, criteria: criteria.map((c) => ({ name: c.name, weight: c.weight, scaleMin: c.scaleMin, scaleMax: c.scaleMax, minScore: c.minScore ?? null })),
      });
      const { data: rpc, error } = await admin.rpc('purge_completed_call_data', { p_call: call.id, p_summary: summary });
      if (error || rpc?.ok !== true) { out.failed++; console.error(JSON.stringify({ event: 'retention_purge_failed', callId: call.id, reason: error?.message ?? rpc?.reason ?? 'unknown' })); continue; }
      out.purged++; out.filesRemoved += list.length;
    } catch (e) {
      out.failed++;
      console.error(JSON.stringify({ event: 'retention_purge_failed', callId: call.id, reason: (e as Error).message }));
    }
  }
  return out;
}

// --- The final export ------------------------------------------------------------------------------------------------------------------------------

/** One row per published result (the current one): who, which phase, what they were told, the validated grade if shared, and the contestation and what became of it. No comment, no private note, no evaluation. */
export async function finalRows(admin: SupabaseClient, call: Call): Promise<{ header: string[]; body: (string | number)[][] }> {
  const settings = await loadSettings(admin, call.id);
  const [{ data: res }, { data: cs }, { data: apps }] = await Promise.all([
    admin.from('call_results').select('id, application_id, phase_id, label, result, source, grade, published_at, is_current, supersedes_id').eq('call_id', call.id),
    admin.from('call_contestations').select('application_id, phase_id, status, reason, response, created_at, answered_at').eq('call_id', call.id),
    admin.from('call_applications').select('id, reference, startup_org_id').eq('call_id', call.id),
  ]);
  const phases = await loadPhases(admin, call.id);
  const appMap = new Map(((apps ?? []) as Row[]).map((a) => [a.id as string, a]));
  const orgIds = [...new Set(((apps ?? []) as Row[]).map((a) => a.startup_org_id as string | null).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (orgIds.length) { const { data: o } = await admin.from('orgs').select('id, name').in('id', orgIds); for (const r of (o ?? []) as Row[]) names.set(r.id as string, String(r.name ?? '')); }
  const header = ['Reference', 'Startup', 'Phase', 'Result', 'Published', ...(settings.shareGrade ? ['Validated grade (%)'] : []), 'Result source', 'Contested', 'Contestation outcome', 'Contestation reason', 'Contestation response'];
  const all = (res ?? []) as Row[];
  const body = all.filter((r) => r.is_current === true).map((r) => {
    const a = appMap.get(r.application_id as string);
    const c = ((cs ?? []) as Row[]).find((x) => x.application_id === r.application_id && ((x.phase_id as string | null) ?? null) === ((r.phase_id as string | null) ?? null));
    const phase = phases.find((p) => p.id === r.phase_id)?.name ?? '';
    return [
      String(a?.reference ?? ''), a?.startup_org_id ? names.get(a.startup_org_id as string) ?? '' : '', phase, String(r.label), String(r.published_at).slice(0, 10),
      ...(settings.shareGrade ? [r.grade === null || r.grade === undefined ? '' : Number(r.grade)] : []),
      String(r.source), c ? 'yes' : 'no', c ? String(c.status) : '', c ? String(c.reason ?? '') : '', c ? String(c.response ?? '') : '',
    ];
  }).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  return { header, body };
}
