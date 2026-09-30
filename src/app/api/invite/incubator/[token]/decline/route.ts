// Prompt I-01 §A.8 / I-01b §A — decline. Since I-01b the invitee must be
// signed in with the invited address (a forwarded link cannot decline on
// their behalf), so this runs under the caller's own session;
// incubator_decline_invite() checks the address and, if the caller already
// runs an org, that they are an owner/admin of it.
import { NextResponse } from 'next/server';
import { requireProgramManager } from '@/lib/incubator-founder-gate';
import { incubatorErrorText } from '@/lib/incubators';

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const gate = await requireProgramManager(req, { allowNoOrg: true });
  if ('error' in gate) return gate.error;
  const { data, error } = await gate.sb.rpc('incubator_decline_invite', { p_token: params.token });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) {
    return NextResponse.json({
      ok: false, error: data?.error, message: incubatorErrorText(data?.error),
      invitedEmailMasked: data?.invited_email_masked ?? null,
    }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
