// Contact & Support — back-office "Assistência ao Cliente" list. Platform
// admin only. Delay rules are computed at read time, not by a cron —
// cheap enough over a low-volume ticket table, and it means the badges are
// always correct at the moment you look, never stale from a missed run.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { buildSupportTicketList, type SupportTicketRow } from '@/lib/support-ticket-list';

// Prompt 907 §B — every ticket also says which company (or VC firm) it belongs to and the sender's role there, and the
// list can be filtered by that account (?account=<org or firm id>, or ?account=none). The logic lives in
// support-ticket-list.ts so the same code runs in the tests; this is only the gate, the read and the filters from the URL.
export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  // Prompt 605 §E — suggestions live in the same table (§A) but never in this
  // queue. A suggestion has no SLA and is not "overdue"; leaving it here would
  // have made every idea look like an unanswered complaint in the counts, the
  // sort and the nav badge below. /backoffice/suggestions is the other half.
  const { data: tickets, error } = await admin.from('support_tickets').select('*')
    .neq('category', 'suggestion').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const list = await buildSupportTicketList(admin, tickets as SupportTicketRow[], {
    status: searchParams.get('status'), category: searchParams.get('category'),
    source: searchParams.get('source'), account: searchParams.get('account'),
  }, Date.now());

  return NextResponse.json({ ok: true, ...list });
}
