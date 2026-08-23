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
  } else if (action === 'strike') {
    // Prompt 321 Pedido C — manual, human moderation only (no AI decides
    // alone on something with social consequence, same posture as the
    // rest of this app). context carries "network_actor:{id}" or
    // "network_post:{id}" (whose author we then strike) from
    // /api/network/report — never guessed from free text.
    if (ticket.category !== 'network_content_report') return NextResponse.json({ ok: false, error: 'Only valid for network content reports.' }, { status: 400 });
    let actorId: string | null = null;
    const actorMatch = (ticket.context as string | null)?.match(/^network_actor:([0-9a-f-]{36})$/);
    const postMatch = (ticket.context as string | null)?.match(/^network_post:([0-9a-f-]{36})$/);
    if (actorMatch) actorId = actorMatch[1];
    else if (postMatch) {
      const { data: post } = await admin.from('network_posts').select('author_actor_id').eq('id', postMatch[1]).maybeSingle();
      actorId = (post?.author_actor_id as string | undefined) ?? null;
    }
    if (!actorId) return NextResponse.json({ ok: false, error: 'Could not resolve the reported actor from this ticket.' }, { status: 400 });

    const { data: actorRow } = await admin.from('network_actors').select('network_strikes_count').eq('id', actorId).maybeSingle();
    if (!actorRow) return NextResponse.json({ ok: false, error: 'Reported actor not found.' }, { status: 404 });
    const newCount = (actorRow.network_strikes_count as number) + 1;
    const actorPatch: Record<string, unknown> = { network_strikes_count: newCount };
    if (newCount >= 3) actorPatch.network_suspended_at = now;
    await admin.from('network_actors').update(actorPatch).eq('id', actorId);

    eventKind = 'note';
    eventBody = `Strike applied to network actor ${actorId} (now ${newCount}/3)${newCount >= 3 ? ' — My Network access suspended' : ''}.`;
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
