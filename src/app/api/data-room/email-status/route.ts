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
//
// Prompt 904 — but RLS alone answers "every row this session may read", which is
// not "this org's rows" for a developer: email_send_log_platform_admin lets a
// platform admin read EVERY org's log, so in a Developer Viewer session (or for a
// developer using their own workspace) the unfiltered query listed other
// startups' recipients. The org is now explicit (resolveActingOrg: the viewed
// org in a viewer session, the caller's own otherwise) and the query filters on
// it; a viewer session reads through the service role (actingReader), because the
// developer is not a member of the org being viewed.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { actingReader, resolveActingOrg, withActingOrg } from '@/lib/acting-org';

export interface EmailStatusRow {
  recipient: string;
  status: string;
  subject: string | null;
  provider_error: string | null;
  from_address_used: string | null;
  created_at: string;
}

export const GET = withActingOrg(async function GET(req: Request) {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return NextResponse.json({ ok: true, byRecipient: {} });

  // 200 rows is generous for "the last outcome per recipient" on a real
  // org's invite volume, and bounded so a busy org can't turn this into an
  // unbounded scan. Newest first, so the first row seen per recipient IS
  // the latest one.
  const { data, error } = await actingReader(acting, sb).from('email_send_log')
    .select('recipient, status, subject, provider_error, from_address_used, created_at')
    .eq('org_id', acting.orgId)
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
});
