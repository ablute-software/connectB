// IRM_SPEC §8d — send the composer's draft for real, from the founder's
// own paired Gmail mailbox. This is the ONLY route in the app that actually
// dispatches an outbound message — everything else (the /log flow) records
// a message the founder already sent by hand. Still never autonomous: the
// founder clicks "Send" on a reviewed draft each time, exactly like §8c.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { getEmailConnection } from '@/lib/email-connection';
import { sendGmailMessage } from '@/lib/google-oauth';

export async function POST(req: Request) {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { to, subject, body } = await req.json() as { to?: string; subject?: string; body?: string };
  if (!to || !body) return NextResponse.json({ ok: false, error: 'to and body are required.' }, { status: 400 });

  const connection = await getEmailConnection(sb, user.id);
  if (!connection) return NextResponse.json({ ok: false, error: 'Gmail is not connected. Connect it in Settings, or send this yourself and log it.' }, { status: 409 });

  try {
    await sendGmailMessage(connection.accessToken, { fromEmail: connection.emailAddress, to, subject: subject || '(no subject)', body });
    return NextResponse.json({ ok: true, sentFrom: connection.emailAddress });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
