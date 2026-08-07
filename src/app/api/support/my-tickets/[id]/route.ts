// Item 13 — a single ticket + its thread, for the user who filed it.
//
// ⚠️ Security-critical, not incidental: support_ticket_events.kind is
// 'note' | 'reply' | 'status_change' | 'email_sent'. 'note' is the ADMIN'S
// OWN INTERNAL REASONING about the case — exactly the kind of thing that
// must never reach the person the note is about. This route filters with
// an explicit allow-list (kind IN ('reply','status_change')), never a
// deny-list (kind <> 'note') — a deny-list silently starts leaking the
// day someone adds a new internal-only kind, since anything not
// explicitly excluded would default to visible. An allow-list fails safe:
// a new kind is invisible here until someone deliberately adds it.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { supportTicketsAvailable } from '@/lib/support-capability';

const VISIBLE_EVENT_KINDS = ['reply', 'status_change'] as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  if (!(await supportTicketsAvailable())) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const email = user.email.toLowerCase();

  // Ownership confirmed server-side, from the ticket's own row — never
  // trust the id alone. Same user_id-or-email scoping as the list route.
  const { data: ticket, error: ticketErr } = await admin.from('support_tickets')
    .select('id, created_at, category, subject, message, status, user_id, email')
    .eq('id', params.id).maybeSingle();
  if (ticketErr) return NextResponse.json({ ok: false, error: ticketErr.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
  const owns = ticket.user_id === user.id || (ticket.email as string)?.toLowerCase() === email;
  if (!owns) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });

  const { data: events, error: eventsErr } = await admin.from('support_ticket_events')
    .select('id, created_at, author, kind, body')
    .eq('ticket_id', params.id)
    .in('kind', VISIBLE_EVENT_KINDS as unknown as string[])
    .order('created_at', { ascending: true });
  if (eventsErr) return NextResponse.json({ ok: false, error: eventsErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, ticket, events: events ?? [] });
}
