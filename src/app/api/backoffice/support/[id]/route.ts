// Contact & Support — single ticket + its event timeline. Platform admin only.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: ticket, error } = await admin.from('support_tickets').select('*').eq('id', params.id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });

  const { data: events, error: evErr } = await admin.from('support_ticket_events')
    .select('*').eq('ticket_id', params.id).order('created_at', { ascending: true });
  if (evErr) return NextResponse.json({ ok: false, error: evErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, ticket, events: events ?? [] });
}
