// Prompt 907 (I3, I5) — the notifications of the applicant side (spec §23): every one goes out BY EMAIL (Resend) and as an IN-APP notice (the
// same pattern as investor_seat_notices: a row shown until it is seen), and only once per event and person (the unique dedupe_key — which is
// also what stops a reminder going out twice).
//   - submission received            -> the applicant, right after submitting;
//   - draft not submitted, 48 h left -> the applicant, once per deadline (an extension earns a new reminder before the new deadline);
//   - deadline extended              -> whoever has a draft not yet submitted — the entity never learns who they are;
//   - call cancelled (deleted)       -> whoever has a draft or a submission on it: the call is gone in 30 days and so are their applications (Prompt 918, Adenda 2, C).
// The Reply-To of a call's emails is the call's own "Contact email for applicants" when it has one; otherwise there is none (platform emails
// say "replies are not read" in the footer, src/lib/email-footer.ts).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_URL } from '@/lib/brand';
import { sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { callLink } from '../link';
import { formatDayInZone, formatInZone } from '../tz';
import { rowToCall } from '../mappers';
import { brandingOf } from '../branding';
import { promoterName } from '../store';
import { cancelledNoticeText } from '../deletion';
import type { Call } from '../types';
import type { ApplicationRow } from './store';

/** What an applicant is told. */
export type ApplicantNoticeKind = 'submission_received' | 'draft_reminder' | 'deadline_extended';
/** Every kind of notice in call_notices: the applicant's three, and (Prompt 909, Adenda 2b) the two that tell the team an import has ended. */
export type NoticeKind = ApplicantNoticeKind | 'call_cancelled' | 'import_ready' | 'import_failed';
export const APPLICANT_NOTICE_KINDS: NoticeKind[] = ['submission_received', 'draft_reminder', 'deadline_extended', 'call_cancelled'];
export const IMPORT_NOTICE_KINDS: NoticeKind[] = ['import_ready', 'import_failed'];

export interface NoticeContent { title: string; body: string; ctaLabel: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** The words of each notice, in one place (pure: the tests read them). */
export function noticeContent(kind: ApplicantNoticeKind, call: Pick<Call, 'name' | 'closesAt' | 'timezone'>, app: { reference: string | null }): NoticeContent {
  const deadline = formatInZone(call.closesAt, call.timezone);
  switch (kind) {
    case 'submission_received':
      return {
        title: `Application received — ${call.name}`,
        body: `We received your application${app.reference ? ` (reference ${app.reference})` : ''} to “${call.name}”. It is saved exactly as you submitted it and can no longer be changed. You can read it any time from the call's page.`,
        ctaLabel: 'View your application',
      };
    case 'draft_reminder':
      return {
        title: `Your application is still a draft — ${call.name}`,
        body: `“${call.name}” closes on ${deadline}, less than 48 hours from now, and your application${app.reference ? ` (${app.reference})` : ''} has not been submitted yet. Your answers are saved: open it, complete what is missing and submit.`,
        ctaLabel: 'Continue your application',
      };
    case 'deadline_extended':
      return {
        title: `New deadline — ${call.name}`,
        body: `The deadline of “${call.name}” was extended. Applications now close on ${deadline}. Your draft${app.reference ? ` (${app.reference})` : ''} is saved: you can continue it and submit it until then.`,
        ctaLabel: 'Continue your application',
      };
  }
}

/** One notice per (person, event): returns true when this call created it, false when it already existed. */
export async function createNotice(admin: SupabaseClient, n: {
  userId: string; callId: string; applicationId: string | null; kind: NoticeKind; dedupeKey: string; content: NoticeContent; linkPath: string | null;
}): Promise<{ created: boolean; id: string | null }> {
  const { data, error } = await admin.from('call_notices').insert({
    user_id: n.userId, call_id: n.callId, application_id: n.applicationId, kind: n.kind, title: n.content.title, body: n.content.body, link_path: n.linkPath, dedupe_key: n.dedupeKey,
  }).select('id').single();
  if (error) {
    // 23505: the unique (user, dedupe_key) — this event was already notified. Anything else is a real error for the caller to log.
    if (error.code === '23505') return { created: false, id: null };
    throw new Error(error.message);
  }
  return { created: true, id: (data as { id: string }).id };
}

/**
 * The link an email carries: ALWAYS absolute (an email has no origin to resolve a relative path against), built from the same `APP_URL` the other
 * platform emails use. A base set without its scheme gets `https://`; with no token it is the site's root.
 */
export function emailLinkFor(call: Pick<Call, 'linkToken'>, base: string = APP_URL): string {
  const origin = /^https?:\/\//i.test(base) ? base : `https://${base.replace(/^\/+/, '')}`;
  return call.linkToken ? callLink(origin, call.linkToken) : origin.replace(/\/$/, '');
}

/** Send the email of a notice and record the outcome on its row. Never throws: a failed email must not undo the event it reports. */
export async function emailNotice(admin: SupabaseClient, noticeId: string | null, to: string, call: Pick<Call, 'contactEmail' | 'linkToken'> & Partial<Call>, content: NoticeContent, opts: { url?: string } = {}): Promise<boolean> {
  try {
    const url = opts.url ?? emailLinkFor(call);
    const brandHtml = await brandLine(admin, call);
    const res = await sendTransactionalEmail({
      to, subject: content.title,
      html: transactionalTemplate({ heading: esc(content.title), body: esc(content.body), ctaLabel: content.ctaLabel, ctaUrl: url, ...(brandHtml ? { brandHtml } : {}) }),
      text: `${content.title}\n\n${content.body}\n\n${content.ctaLabel}: ${url}`,
      ...(call.contactEmail ? { replyTo: call.contactEmail } : {}),
      context: { kind: 'other' },
    });
    if (noticeId) {
      await admin.from('call_notices').update(res.sent ? { email_sent_at: new Date().toISOString() } : { email_error: String(res.providerError ?? res.error ?? 'not sent').slice(0, 300) }).eq('id', noticeId);
    }
    return res.sent === true;
  } catch (e) {
    if (noticeId) await admin.from('call_notices').update({ email_error: String((e as Error).message).slice(0, 300) }).eq('id', noticeId);
    return false;
  }
}

/**
 * The entity's logo, small, beside its name — above the heading of the call's emails (Prompt 918, Adenda 1 C). Nothing when the call has no logo (or when it is not known which call it is):
 * an email is never held back for a picture. The address is absolute (an email client has no page to resolve it against).
 */
async function brandLine(admin: SupabaseClient, call: Partial<Call>): Promise<string> {
  try {
    if (!call.id || !call.promoterKind || !call.promoterId) return '';
    const logo = (await brandingOf(admin, [call as Call], 'public')).get(call.id)?.logoUrl;
    if (!logo) return '';
    const origin = emailLinkFor({ linkToken: null });                       // the site's address, normalised the way the platform's emails do
    const src = logo.startsWith('https://') ? logo : `${origin}${logo}`;
    const name = await promoterName(admin, call.promoterKind, call.promoterId);
    return `<img src="${esc(src)}" alt="" width="28" height="28" style="vertical-align: middle; border-radius: 6px; margin-right: 8px;" /><span style="vertical-align: middle; font-size: 13px; color: #4B5563;">${esc(name)}</span>`;
  } catch { return ''; }
}

async function emailOf(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

type Row = Record<string, unknown>;
const HOUR = 3_600_000;
/** How long before the deadline a draft is reminded (spec §23). */
export const REMINDER_HOURS = 48;

/**
 * The deadline was extended FOR EVERYONE: whoever has a draft that is not submitted is told — the organisation that runs the call never learns
 * who they are (it only extended the deadline). Once per person and deadline. Returns how many were notified.
 */
export async function notifyDeadlineExtended(admin: SupabaseClient, call: Call): Promise<number> {
  const { data } = await admin.from('call_applications').select('id, applicant_user_id, reference').eq('call_id', call.id).eq('status', 'draft');
  let n = 0;
  for (const a of (data ?? []) as Row[]) {
    const app = { reference: (a.reference as string | null) ?? null };
    const content = noticeContent('deadline_extended', call, app);
    const { created, id } = await createNotice(admin, {
      userId: a.applicant_user_id as string, callId: call.id, applicationId: a.id as string, kind: 'deadline_extended',
      dedupeKey: `extended:${a.id}:${call.closesAt}`, content, linkPath: call.linkToken ? `/call/${call.linkToken}` : '/',
    });
    if (!created) continue;
    n++;
    const to = await emailOf(admin, a.applicant_user_id as string);
    if (to) await emailNotice(admin, id, to, call, content);
  }
  return n;
}

/**
 * The reminder: an application still a DRAFT when the call is less than 48 hours from closing. Never for a submitted one (only drafts are looked
 * at), once per person and deadline (an extension earns a new reminder before the new deadline). `userId` limits it to one person's drafts (used when
 * they open the app, so the reminder does not wait for the daily cron). The cron runs once a day on this plan, so for someone who does not open the
 * app the reminder leaves between 24 and 48 hours before the deadline. Returns what it did.
 */
export async function sendDraftReminders(admin: SupabaseClient, now: Date = new Date(), opts: { userId?: string } = {}): Promise<{ calls: number; reminded: number }> {
  const from = now.toISOString();
  const to = new Date(now.getTime() + REMINDER_HOURS * HOUR).toISOString();
  const { data: calls } = await admin.from('calls').select('*').eq('status', 'open').is('deleted_at', null).gt('closes_at', from).lte('closes_at', to);
  let reminded = 0;
  const list = (calls ?? []) as Row[];
  for (const r of list) {
    const call = rowToCall(r);
    let q = admin.from('call_applications').select('id, applicant_user_id, reference').eq('call_id', call.id).eq('status', 'draft');
    if (opts.userId) q = q.eq('applicant_user_id', opts.userId);
    const { data } = await q;
    for (const a of (data ?? []) as Row[]) {
      const content = noticeContent('draft_reminder', call, { reference: (a.reference as string | null) ?? null });
      const { created, id } = await createNotice(admin, {
        userId: a.applicant_user_id as string, callId: call.id, applicationId: a.id as string, kind: 'draft_reminder',
        dedupeKey: `reminder_48h:${a.id}:${call.closesAt}`, content, linkPath: call.linkToken ? `/call/${call.linkToken}` : '/',
      });
      if (!created) continue;
      reminded++;
      const email = await emailOf(admin, a.applicant_user_id as string);
      if (email) await emailNotice(admin, id, email, call, content);
    }
  }
  return { calls: list.length, reminded };
}

/** The receipt: an in-app notice and an email, once, to the person who submitted. */
export async function notifySubmissionReceived(admin: SupabaseClient, call: Call, app: ApplicationRow, userId: string): Promise<void> {
  const content = noticeContent('submission_received', call, app);
  const { created, id } = await createNotice(admin, {
    userId, callId: call.id, applicationId: app.id, kind: 'submission_received', dedupeKey: `submitted:${app.id}`, content, linkPath: call.linkToken ? `/call/${call.linkToken}` : '/',
  });
  if (!created) return;
  const to = await emailOf(admin, userId);
  if (to) await emailNotice(admin, id, to, call, content);
}

/**
 * The call was deleted (Prompt 918, Adenda 2, C): whoever has a draft or a submission on it is told — in the app and by email — that «Entity» cancelled «Title» and that their application will be
 * deleted on the day the 30 days end. Until then they can read what they submitted and download their files in Calls → My applications. The entity is never told who they are. Once per person
 * and call (a restored call that is deleted again is a new event: the key carries the day it goes). Returns how many were told.
 */
export async function notifyCallCancelled(admin: SupabaseClient, call: Call, purgeAfter: string, entityName: string): Promise<number> {
  const { data } = await admin.from('call_applications').select('id, applicant_user_id, status').eq('call_id', call.id).in('status', ['draft', 'submitted']);
  const purgeDay = formatDayInZone(purgeAfter, call.timezone);
  const text = cancelledNoticeText(entityName, call.name, purgeDay);
  const content: NoticeContent = { title: text.title, body: text.body, ctaLabel: 'View my applications' };
  const url = `${emailLinkFor({ linkToken: null })}/calls`;
  let n = 0;
  const seen = new Set<string>();
  for (const a of (data ?? []) as Row[]) {
    const userId = a.applicant_user_id as string;
    if (seen.has(userId)) continue;                                   // one notice per person, however many applications they have
    seen.add(userId);
    const { created, id } = await createNotice(admin, { userId, callId: call.id, applicationId: a.id as string, kind: 'call_cancelled', dedupeKey: `cancelled:${call.id}:${purgeAfter}:${userId}`, content, linkPath: '/calls' });
    if (!created) continue;
    n++;
    const to = await emailOf(admin, userId);
    if (to) await emailNotice(admin, id, to, call, content, { url });
  }
  return n;
}
