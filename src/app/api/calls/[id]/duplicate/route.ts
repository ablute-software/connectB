// Prompt 905 — duplicate a call: its configuration, phases and form. Never applications; dates are left empty
// because a copy is a new edition (spec §5.3).
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { duplicateCall } from '@/lib/calls/store';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const copy = await duplicateCall(auth.admin, auth.call, auth.userId);
  return NextResponse.json({ ok: true, call: copy });
}
