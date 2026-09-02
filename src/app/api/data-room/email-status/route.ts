// Prompt 537 §1(a) — the founder's own view of what happened to their
// invites, scoped to their org.
//
// Returns the LAST outcome per recipient, not a history: People & Access
// shows one row per relationship (Prompt 530), so it needs one answer per
// recipient. The full history is the back-office's Email delivery tab.
//
// Read through the founder's OWN session, not the service role: the
// email_send_log_org_read policy already says an org's members may read
// their org's rows, so RLS is the access control here and this route adds
// no second, hand-written copy of that rule that could disagree with it.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';

export interface EmailStatusRow {
  recipient: string;
  status: string;
  subject: string | null;
  provider_error: string | null;
  from_address_used: string | null;
  created_at: string;
}

export async function GET() {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  // 200 rows is generous for "the last outcome per recipient" on a real
  // org's invite volume, and bounded so a busy org can't turn this into an
  // unbounded scan. Newest first, so the first row seen per recipient IS
  // the latest one.
  const { data, error } = await sb.from('email_send_log')
    .select('recipient, status, subject, provider_error, from_address_used, created_at')
    .in('kind', ['guest_invite', 'access_notify', 'access_grant'])
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const latestByRecipient: Record<string, EmailStatusRow> = {};
  for (const row of (data ?? []) as EmailStatusRow[]) {
    const key = row.recipient.trim().toLowerCase();
    if (!latestByRecipient[key]) latestByRecipient[key] = row;
  }

  return NextResponse.json({ ok: true, byRecipient: latestByRecipient });
}
