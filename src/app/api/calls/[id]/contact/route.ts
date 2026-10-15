// Prompt 907 (I5) — "Contact email for applicants" (spec §23): when set, it is the Reply-To of the emails of THIS call (the receipt, the reminder,
// the new deadline); when not, those emails have no Reply-To and say "replies are not read". It is not applicant-facing configuration, so it can be
// changed at any time (also once the call is open) and does not move the configuration version. Whoever may "Configure call".
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { logCallEvent } from '@/lib/calls/store';
import { parseContactEmail } from '@/lib/calls/applicant/contact';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { contactEmail?: unknown };
  const parsed = parseContactEmail(body.contactEmail);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const { error } = await auth.admin.from('calls').update({ contact_email: parsed.email }).eq('id', auth.call.id);
  if (error) return NextResponse.json({ ok: false, error: 'We could not save it. Please try again.' }, { status: 500 });
  await logCallEvent(auth.admin, auth.call.id, 'contact_email_changed', auth.userId, { set: parsed.email !== null });
  return NextResponse.json({ ok: true, contactEmail: parsed.email });
}
