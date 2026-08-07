// Item 13 — the user replies to their own ticket. Same rate-limit table/
// pattern as /api/support/submit (support_rate_limit, keyed by IP, last
// hour) — not a new anti-spam mechanism.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { supportTicketsAvailable } from '@/lib/support-capability';

const RATE_LIMIT_PER_HOUR = 10;

function getIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  if (!(await supportTicketsAvailable())) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const email = user.email.toLowerCase();

  const { data: ticket, error: ticketErr } = await admin.from('support_tickets')
    .select('id, status, user_id, email').eq('id', params.id).maybeSingle();
  if (ticketErr) return NextResponse.json({ ok: false, error: ticketErr.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
  const owns = ticket.user_id === user.id || (ticket.email as string)?.toLowerCase() === email;
  if (!owns) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });

  const ip = getIp(req);
  await admin.from('support_rate_limit').insert({ ip });
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin.from('support_rate_limit')
    .select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since);
  if ((count ?? 0) > RATE_LIMIT_PER_HOUR) return NextResponse.json({ ok: false, error: 'Too many replies — try again later.' }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const message = (body as { message?: string }).message?.trim();
  if (!message || message.length < 1 || message.length > 5000) {
    return NextResponse.json({ ok: false, error: 'Message must be 1–5000 characters.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error: evErr } = await admin.from('support_ticket_events').insert({
    ticket_id: params.id, author: email, kind: 'reply', body: message,
  });
  if (evErr) return NextResponse.json({ ok: false, error: evErr.message }, { status: 500 });

  // Item 13 — this exact transition is what makes the reply visible to
  // whoever's actually working the queue: 'waiting_user' means the ticket
  // was sitting in the requester's court; the requester just acted on it,
  // so it goes back to 'open' and re-enters the admin's queue. Without
  // this, a user reply is invisible to the backoffice list's default
  // filtering — the ticket data changes but nothing signals "this needs
  // attention again."
  const patch: Record<string, unknown> = { last_activity_at: now };
  if (ticket.status === 'waiting_user') patch.status = 'open';
  const { error: updErr } = await admin.from('support_tickets').update(patch).eq('id', params.id);
  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
