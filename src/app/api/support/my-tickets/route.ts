// Item 13 — the user-visible half of support_tickets. Until now, only
// /api/backoffice/support/* (requirePlatformAdmin) could ever read this
// table (RLS locks it to platform_admins only — see 0036) and no public
// route existed at all. A user who submitted a ticket had no way to see
// its status, see a reply, or reply back — see ContactForm/submit's own
// "Thanks — we'll get back to you" as the entire lifecycle they could
// observe.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { supportTicketsAvailable } from '@/lib/support-capability';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, tickets: [] });
  if (!(await supportTicketsAvailable())) return NextResponse.json({ ok: true, tickets: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const email = user.email.toLowerCase();

  // Scoped to user_id OR email, not user_id alone: submit/route.ts only
  // writes user_id when the submitter had a session at the time — a
  // ticket filed anonymously from /contact before ever logging in is
  // still the same person's, and still has to show up here once they do.
  const { data: tickets, error } = await admin.from('support_tickets')
    .select('id, created_at, category, subject, status, last_activity_at')
    .or(`user_id.eq.${user.id},email.eq.${email}`)
    .order('last_activity_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const ids = (tickets ?? []).map((t) => t.id as string);
  const { data: events } = ids.length
    ? await admin.from('support_ticket_events').select('ticket_id, created_at, author, kind').in('ticket_id', ids)
    : { data: [] as { ticket_id: string; created_at: string; author: string; kind: string }[] };

  // Unread = an admin reply/status_change newer than the requester's own
  // last event on that ticket (or newer than ticket creation, if the
  // requester never posted anything back). Deliberately never counts
  // 'note' — see my-tickets/[id]/route.ts for why that's an allow-list,
  // not a filter, in both places.
  const withUnread = (tickets ?? []).map((t) => {
    const ticketEvents = (events ?? []).filter((e) => e.ticket_id === t.id);
    const myLast = ticketEvents.filter((e) => e.author.toLowerCase() === email).map((e) => e.created_at).sort().pop();
    const sinceIso = myLast ?? (t.created_at as string);
    const hasNewAdminActivity = ticketEvents.some((e) =>
      (e.kind === 'reply' || e.kind === 'status_change') && e.author === 'admin' && e.created_at > sinceIso,
    );
    return { ...t, unread: hasNewAdminActivity };
  });

  return NextResponse.json({ ok: true, tickets: withUnread });
}
