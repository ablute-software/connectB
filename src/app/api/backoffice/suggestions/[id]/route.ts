// Prompt 605 §E — moving one suggestion through its own lifecycle:
// received → under review → accepted / not accepted, with the outcome
// recorded when it is accepted.
//
// "uma sugestão aceite tem de poder apontar para o que originou. Sem isso, a
// fila enche-se e ninguém sabe se serviu para alguma coisa — e quem sugeriu
// percebe." So `accepted` REQUIRES an outcome note. That is the one piece of
// validation here that isn't shape-checking: it is the rule that stops the
// queue from becoming a place where things are marked done and nothing
// happened.
//
// Every move also lands in support_ticket_events, so the suggestion keeps one
// timeline with any notes and replies made on it through the ordinary ticket
// screen, and in admin_audit_log like every other back-office mutation.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { supportSuggestionsAvailable } from '@/lib/support-suggestions-capability';

const STATUSES = ['received', 'under_review', 'accepted', 'declined'] as const;
type SuggestionStatus = (typeof STATUSES)[number];

const LABEL: Record<SuggestionStatus, string> = {
  received: 'Received', under_review: 'Under review', accepted: 'Accepted', declined: 'Not accepted',
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  if (!(await supportSuggestionsAvailable())) {
    return NextResponse.json({ ok: false, error: 'Suggestions need migration 0339.' }, { status: 200 });
  }

  const body = await req.json().catch(() => ({}));
  const status = (body as { status?: string }).status;
  const outcome = ((body as { outcome?: string }).outcome ?? '').trim();
  const outcomeUrl = ((body as { outcomeUrl?: string }).outcomeUrl ?? '').trim();

  if (!status || !(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ ok: false, error: 'Invalid status.' }, { status: 400 });
  }
  if (status === 'accepted' && !outcome) {
    return NextResponse.json({ ok: false, error: 'Say what was done — an accepted suggestion with no outcome is a suggestion nobody can follow up.' }, { status: 400 });
  }
  if (outcomeUrl && !/^https?:\/\//i.test(outcomeUrl)) {
    return NextResponse.json({ ok: false, error: 'The link must start with http:// or https://.' }, { status: 400 });
  }

  const { data: ticket, error: readErr } = await admin.from('support_tickets')
    .select('id, category, suggestion_status').eq('id', params.id).maybeSingle();
  if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ ok: false, error: 'Suggestion not found.' }, { status: 404 });
  // Guarding the category, not just the id: this route writes fields that are
  // meaningless on a problem ticket, and a mistyped id should fail loudly
  // rather than quietly give a bug report a suggestion lifecycle.
  if (ticket.category !== 'suggestion') {
    return NextResponse.json({ ok: false, error: 'That ticket is not a suggestion.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const from = (ticket.suggestion_status as string | null) ?? 'received';
  const { error: updErr } = await admin.from('support_tickets').update({
    suggestion_status: status,
    suggestion_outcome: outcome || null,
    suggestion_outcome_url: outcomeUrl || null,
    last_activity_at: now,
    // The problem-shaped `status` is moved in step with the idea-shaped one,
    // so a suggestion never sits in the ordinary ticket screens as a
    // perpetually 'new' item nobody is answering. The two vocabularies stay
    // separate; only this one mapping connects them, in one place.
    status: status === 'received' ? 'new' : status === 'under_review' ? 'open' : 'closed',
    ...(status === 'accepted' || status === 'declined' ? { resolved_at: now } : {}),
  }).eq('id', params.id);
  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

  await admin.from('support_ticket_events').insert({
    ticket_id: params.id,
    author: 'admin',
    kind: 'status_change',
    body: `Suggestion: ${LABEL[from as SuggestionStatus] ?? from} → ${LABEL[status as SuggestionStatus]}`
      + (outcome ? `\n${outcome}` : '') + (outcomeUrl ? `\n${outcomeUrl}` : ''),
  });

  await logAdminAction(admin, {
    adminUserId: userId,
    action: 'suggestion_decision',
    subjectType: 'support_ticket',
    subjectId: params.id,
    detail: { from, to: status, outcome: outcome || null, outcomeUrl: outcomeUrl || null },
  });

  return NextResponse.json({ ok: true });
}
