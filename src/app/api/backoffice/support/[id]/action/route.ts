// Contact & Support — the four ticket actions: change status, change
// priority, add an internal note, or reply (optionally also emailed via
// Resend). One route, one action per call — each maps to exactly one button
// in the back-office detail view. Platform admin only.
//
// Bookkeeping rules (spec): any action touches last_activity_at; the first
// status change away from 'new' (or the first reply) sets first_response_at
// if it isn't set yet; moving to 'resolved' sets resolved_at.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { BRAND_NAME } from '@/lib/brand';
import {
  applyStrike, dismissReport, readModerationCase, removeReportedPost, recomputeActorStrikeState,
} from '@/lib/network-moderation-db';
import { notifyStrikeApplied } from '@/lib/network-moderation-notify';
import { networkModerationAvailable } from '@/lib/network-moderation-capability';

const STATUSES = ['new', 'open', 'waiting_user', 'resolved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json().catch(() => ({}));
  const { action } = body as { action?: string };

  const { data: ticket, error: fetchErr } = await admin.from('support_tickets').select('*').eq('id', params.id).maybeSingle();
  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { last_activity_at: now };
  let eventKind: 'note' | 'reply' | 'status_change' | 'email_sent' = 'note';
  let eventBody = '';

  if (action === 'status') {
    const value = (body as { value?: string }).value;
    if (!value || !STATUSES.includes(value)) return NextResponse.json({ ok: false, error: 'Invalid status.' }, { status: 400 });
    patch.status = value;
    if (ticket.status === 'new' && !ticket.first_response_at) patch.first_response_at = now;
    if (value === 'resolved') patch.resolved_at = now;
    eventKind = 'status_change';
    eventBody = `Status: ${ticket.status} → ${value}`;
  } else if (action === 'priority') {
    const value = (body as { value?: string }).value;
    if (!value || !PRIORITIES.includes(value)) return NextResponse.json({ ok: false, error: 'Invalid priority.' }, { status: 400 });
    patch.priority = value;
    eventKind = 'status_change';
    eventBody = `Priority: ${ticket.priority} → ${value}`;
  } else if (action === 'note') {
    const value = (body as { body?: string }).body?.trim();
    if (!value) return NextResponse.json({ ok: false, error: 'Note body is required.' }, { status: 400 });
    eventKind = 'note';
    eventBody = value;
  } else if (action === 'reply') {
    const value = (body as { body?: string }).body?.trim();
    const alsoEmail = !!(body as { alsoEmail?: boolean }).alsoEmail;
    if (!value) return NextResponse.json({ ok: false, error: 'Reply body is required.' }, { status: 400 });
    if (!ticket.first_response_at) patch.first_response_at = now;
    eventKind = 'reply';
    eventBody = value;

    if (alsoEmail) {
      const result = await sendTransactionalEmail({
        to: ticket.email,
        subject: `Re: ${ticket.subject}`,
        html: transactionalTemplate({ heading: `${BRAND_NAME} support`, body: value.replace(/\n/g, '<br>') }),
      });
      if (!result.sent) return NextResponse.json({ ok: false, error: result.error ?? 'Email send failed.' }, { status: 500 });
    }
  } else if (action === 'strike' || action === 'remove_content' || action === 'dismiss_report') {
    // Prompt 531 — the three moderator decisions on a My Network report.
    // Applying a strike and removing the content stay SEPARATE actions
    // (§29) even when a moderator does both in one sitting: each is its own
    // call, its own audit-log row, and its own line in this ticket's
    // timeline, so the history can always say which one happened.
    if (ticket.category !== 'network_content_report') return NextResponse.json({ ok: false, error: 'Only valid for network content reports.' }, { status: 400 });
    if (!(await networkModerationAvailable())) {
      return NextResponse.json({ ok: false, error: 'Moderation tools activate once migration 0291 is applied.' }, { status: 200 });
    }
    const ticketRef = { id: ticket.id as string, category: ticket.category as string, context: (ticket.context as string | null) ?? null };

    if (action === 'dismiss_report') {
      // No violation: close the report, no strike, no ban, no notification
      // to the reported startup (§5). The report itself stays, under the
      // existing ticket retention.
      await dismissReport(admin, { ticketId: ticketRef.id, adminUserId: userId });
      patch.status = 'resolved';
      patch.resolved_at = now;
      if (!ticket.first_response_at) patch.first_response_at = now;
      eventKind = 'status_change';
      eventBody = 'Moderation decision: no violation — report dismissed, no strike applied.';
    } else if (action === 'strike') {
      const result = await applyStrike(admin, { ticket: ticketRef, adminUserId: userId });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

      const moderationCase = await readModerationCase(admin, ticketRef);
      const alsoRemove = !!(body as { removeContent?: boolean }).removeContent;
      let removed = false;
      if (alsoRemove && moderationCase?.postId) {
        const removal = await removeReportedPost(admin, {
          postId: moderationCase.postId, adminUserId: userId, ticketId: ticketRef.id, strikeId: result.strikeId,
        });
        if (!removal.ok) return NextResponse.json({ ok: false, error: removal.error }, { status: 400 });
        removed = true;
      }

      // The affected startup is told what happened, shown the content, and
      // offered the appeal — from the SNAPSHOT, never from the ticket, so
      // the reporter's identity and reason cannot travel with it (§§21-23).
      //
      // Only when the strike was actually CREATED by this call: a retry or a
      // double-click returns the existing strike (created=false) and must
      // not send a second "you received a strike" email for it. Removing the
      // post is still honoured on that path, since the moderator may have
      // ticked the box on the second attempt.
      if (moderationCase?.actorId && result.created) {
        const state = await recomputeActorStrikeState(admin, moderationCase.actorId);
        await notifyStrikeApplied(admin, {
          actorId: moderationCase.actorId, snapshot: moderationCase.snapshot,
          activeStrikeCount: state.activeStrikeCount, banned: state.banned, contentRemoved: removed || !!moderationCase.strike?.contentRemoved,
        });
        eventKind = 'note';
        eventBody = `Strike applied to ${moderationCase.actorName ?? moderationCase.actorId} `
          + `(now ${state.activeStrikeCount} active${state.banned ? ', My Network access suspended' : ''})`
          + `${removed ? '; reported post removed from My Network' : ''}. Startup notified.`;
      } else if (!result.created) {
        eventKind = 'note';
        eventBody = `This report's strike was already applied${removed ? '; reported post removed from My Network' : ''}. No duplicate strike, no second notification.`;
      } else {
        eventKind = 'note';
        eventBody = 'Strike applied.';
      }
    } else {
      // remove_content on its own — a violation worth taking down without a
      // strike, which the previous single "Apply strike" button could not
      // express at all.
      const moderationCase = await readModerationCase(admin, ticketRef);
      if (!moderationCase?.postId) return NextResponse.json({ ok: false, error: 'This report is not about a specific post.' }, { status: 400 });
      const removal = await removeReportedPost(admin, {
        postId: moderationCase.postId, adminUserId: userId, ticketId: ticketRef.id,
        strikeId: moderationCase.strike?.id,
      });
      if (!removal.ok) return NextResponse.json({ ok: false, error: removal.error }, { status: 400 });
      eventKind = 'note';
      eventBody = 'Reported post removed from My Network. The moderation record and its content snapshot are retained.';
    }
  } else {
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }

  const { error: updErr } = await admin.from('support_tickets').update(patch).eq('id', params.id);
  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

  const { error: evErr } = await admin.from('support_ticket_events').insert({
    ticket_id: params.id, author: 'admin', kind: eventKind, body: eventBody,
  });
  if (evErr) return NextResponse.json({ ok: false, error: evErr.message }, { status: 500 });

  // Reply-with-email logs a second event so the timeline shows both what
  // was said (reply) and that it actually went out (email_sent) — the two
  // can diverge (e.g. Resend fails after the reply is already recorded, or
  // a future "email_sent" gets triggered independently of a reply).
  if (action === 'reply' && (body as { alsoEmail?: boolean }).alsoEmail) {
    await admin.from('support_ticket_events').insert({
      ticket_id: params.id, author: 'admin', kind: 'email_sent', body: `Emailed to ${ticket.email}`,
    });
  }

  await logAdminAction(admin, { adminUserId: userId, action: `support_${action}`, subjectType: 'support_ticket', subjectId: params.id, detail: { value: (body as { value?: string }).value } });

  return NextResponse.json({ ok: true });
}
