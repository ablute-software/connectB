// Prompt 905 — duplicate a call: its configuration, phases and form. Never applications; dates are left empty
// because a copy is a new edition (spec §5.3).
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { duplicateCall } from '@/lib/calls/store';
import { copyTeam } from '@/lib/calls/team-store';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const copy = await duplicateCall(auth.admin, auth.call, auth.userId);
  // §5.3: a duplicate copies the team too (never the applications, evaluations or decisions).
  await copyTeam(auth.admin, auth.call.id, copy.id, auth.userId);
  return NextResponse.json({ ok: true, call: copy });
}
